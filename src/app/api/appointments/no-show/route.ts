import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { updateLeadOutcome } from "@/lib/leads/update-lead-outcome";
import { buildNoShowNotes } from "@/lib/appointments/no-show";

const NO_SHOW_WEBHOOK_URL =
  process.env.N8N_NO_SHOW_WEBHOOK_URL ||
  "https://personal-n8n.brtnrr.easypanel.host/webhook/no_asiste_cita";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("clinic_id, role")
    .eq("user_id", user.id)
    .single();

  if (!profile?.clinic_id) {
    return NextResponse.json({ error: "No clinic" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.appointment_id) {
    return NextResponse.json({ error: "appointment_id es obligatorio" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: appointment, error: appointmentError } = await admin
    .from("appointments")
    .select("*")
    .eq("clinic_id", profile.clinic_id)
    .eq("id", body.appointment_id)
    .single();

  if (appointmentError) {
    const notFound = appointmentError.code === "PGRST116";
    return NextResponse.json(
      { error: notFound ? "No se encontró la cita." : appointmentError.message || "No se pudo leer la cita." },
      { status: notFound ? 404 : 400 }
    );
  }

  if (!appointment) {
    return NextResponse.json({ error: "No se encontró la cita." }, { status: 404 });
  }

  if ("entry_type" in appointment && appointment.entry_type === "internal_block") {
    return NextResponse.json({ error: "Solo se puede marcar no-show en citas de lead." }, { status: 400 });
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "No asistió a la cita";

  const normalizedPhone =
    typeof appointment.lead_phone === "string" && appointment.lead_phone.trim()
      ? appointment.lead_phone.trim()
      : null;
  const normalizedName =
    typeof appointment.lead_name === "string" && appointment.lead_name.trim()
      ? appointment.lead_name.trim()
      : null;

  const [leadByIdResult, leadByPhoneResult, leadByNameResult] = await Promise.all([
    appointment.lead_id
      ? admin
          .from("leads")
          .select("id, full_name, phone, treatment, stage_key")
          .eq("clinic_id", profile.clinic_id)
          .eq("id", appointment.lead_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    normalizedPhone
      ? admin
          .from("leads")
          .select("id, full_name, phone, treatment, stage_key")
          .eq("clinic_id", profile.clinic_id)
          .eq("phone", normalizedPhone)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    normalizedName
      ? admin
          .from("leads")
          .select("id, full_name, phone, treatment, stage_key")
          .eq("clinic_id", profile.clinic_id)
          .eq("full_name", normalizedName)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const lead = leadByIdResult.data || leadByPhoneResult.data || leadByNameResult.data || null;

  const webhookResponse = await fetch(NO_SHOW_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "appointment_no_show",
      clinic_id: appointment.clinic_id,
      appointment_id: appointment.id,
      appointment_title: appointment.title,
      appointment_start_at: appointment.start_at,
      appointment_end_at: appointment.end_at,
      appointment_status: appointment.status,
      appointment_source_channel:
        "source_channel" in appointment && typeof appointment.source_channel === "string"
          ? appointment.source_channel
          : "staff",
      lead_id: lead?.id || appointment.lead_id,
      lead_name: lead?.full_name || appointment.lead_name,
      lead_phone: lead?.phone || appointment.lead_phone,
      lead_treatment: lead?.treatment || null,
      lead_stage_key: lead?.stage_key || null,
      reason,
      reported_by_user_id: user.id,
      reported_by_role: profile.role || "staff",
      source_channel: "staff_app",
    }),
  }).catch(() => null);

  if (!webhookResponse?.ok) {
    return NextResponse.json({ error: "No se pudo notificar el no-show al webhook de n8n." }, { status: 502 });
  }

  let outcomeError: string | null = null;
  if (lead?.id) {
    const result = await updateLeadOutcome({
      supabase: admin,
      clinicId: profile.clinic_id,
      leadId: lead.id,
      toStageKey: "visit_no_show",
      actorType: profile.role || "staff",
      actorId: user.id,
      source: "dashboard_no_show",
      outcomeReason: reason,
    });

    if (!result.ok) {
      outcomeError = result.error || "No se pudo actualizar el lead tras marcar el no-show.";
    }
  } else {
    outcomeError = "No se pudo vincular la cita con un lead para moverlo a 'No asistió a cita'.";
  }

  const mergedNotes = buildNoShowNotes(appointment.notes, reason);
  await admin
    .from("appointments")
    .update({ notes: mergedNotes || null })
    .eq("clinic_id", profile.clinic_id)
    .eq("id", appointment.id);

  return NextResponse.json({
    ok: true,
    appointment_id: appointment.id,
    warning: outcomeError,
  });
}
