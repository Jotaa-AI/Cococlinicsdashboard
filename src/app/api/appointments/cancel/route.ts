import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { transitionLeadStage } from "@/lib/pipeline/transition";
import { normalizeEsPhone } from "@/lib/leads/resolveLead";

const CANCEL_APPOINTMENT_WEBHOOK_URL =
  process.env.N8N_CANCEL_APPOINTMENT_WEBHOOK_URL ||
  "https://personal-n8n.brtnrr.easypanel.host/webhook/cancelar-cita-app";

function normalizeLeadPhone(rawPhone?: string | null) {
  return normalizeEsPhone(rawPhone) || (typeof rawPhone === "string" && rawPhone.trim() ? rawPhone.trim() : null);
}

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

  if (appointment.status === "canceled") {
    return NextResponse.json({ ok: true, appointment_id: appointment.id });
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "Cancelada desde la agenda de la app";
  let webhookWarning: string | null = null;

  if (appointment.entry_type !== "internal_block") {
    const webhookResponse = await fetch(CANCEL_APPOINTMENT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "cancel_appointment_from_app",
        appointment_id: appointment.id,
        clinic_id: appointment.clinic_id,
        lead_id: appointment.lead_id,
        lead_name: appointment.lead_name,
        lead_phone: appointment.lead_phone,
        title: appointment.title,
        start_at: appointment.start_at,
        end_at: appointment.end_at,
        reason,
        canceled_by_user_id: user.id,
        source_channel: "staff_app",
      }),
    }).catch(() => null);

    if (!webhookResponse?.ok) {
      webhookWarning = "No se pudo notificar la cancelacion al webhook de n8n.";
    }
  }

  const mergedNotes = [appointment.notes, reason].filter(Boolean).join(" | ");
  const { error: updateError } = await admin
    .from("appointments")
    .update({
      status: "canceled",
      notes: mergedNotes || null,
    })
    .eq("clinic_id", profile.clinic_id)
    .eq("id", appointment.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message || "No se pudo cancelar la cita." }, { status: 400 });
  }

  let transitionWarning: string | null = null;

  if (appointment.entry_type !== "internal_block") {
    const normalizedPhone = normalizeLeadPhone(appointment.lead_phone);
    const normalizedName =
      typeof appointment.lead_name === "string" && appointment.lead_name.trim()
        ? appointment.lead_name.trim()
        : null;

    const [leadByIdResult, leadByPhoneResult, leadByNameResult] = await Promise.all([
      appointment.lead_id
        ? admin
            .from("leads")
            .select("id")
            .eq("clinic_id", profile.clinic_id)
            .eq("id", appointment.lead_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      normalizedPhone
        ? admin
            .from("leads")
            .select("id")
            .eq("clinic_id", profile.clinic_id)
            .eq("phone", normalizedPhone)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      normalizedName
        ? admin
            .from("leads")
            .select("id")
            .eq("clinic_id", profile.clinic_id)
            .eq("full_name", normalizedName)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const leadId =
      leadByIdResult.data?.id ||
      leadByPhoneResult.data?.id ||
      leadByNameResult.data?.id ||
      appointment.lead_id ||
      null;

    if (leadId) {
      const transition = await transitionLeadStage({
        supabase: admin,
        clinicId: profile.clinic_id,
        leadId,
        toStageKey: "visit_canceled",
        reason: reason || "Cita cancelada desde la agenda de la app",
        actorType: profile.role || "staff",
        actorId: user.id,
        meta: {
          source: "calendar_cancel_appointment",
          appointment_id: appointment.id,
        },
      });

      if (!transition.ok) {
        transitionWarning = transition.error?.message || transition.error || "No se pudo mover el lead a 'Citas Canceladas'.";
      }
    } else {
      transitionWarning = "La cita se canceló, pero no se pudo vincular con un lead para moverlo a 'Citas Canceladas'.";
    }
  }

  return NextResponse.json({
    ok: true,
    appointment_id: appointment.id,
    warning: [webhookWarning, transitionWarning].filter(Boolean).join(" · ") || null,
  });
}
