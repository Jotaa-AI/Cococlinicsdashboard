import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const CANCEL_APPOINTMENT_WEBHOOK_URL =
  process.env.N8N_CANCEL_APPOINTMENT_WEBHOOK_URL ||
  "https://personal-n8n.brtnrr.easypanel.host/webhook/cancelar-cita-app";

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
    .select("clinic_id")
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
    .select("id, clinic_id, lead_id, lead_name, lead_phone, title, start_at, end_at, status, notes")
    .eq("clinic_id", profile.clinic_id)
    .eq("id", body.appointment_id)
    .single();

  if (appointmentError || !appointment) {
    return NextResponse.json({ error: "No se encontro la cita." }, { status: 404 });
  }

  if (appointment.status === "canceled") {
    return NextResponse.json({ ok: true, appointment_id: appointment.id });
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "Cancelada desde la agenda de la app";

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
    return NextResponse.json(
      { error: "No se pudo notificar la cancelacion al webhook de n8n." },
      { status: 502 }
    );
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

  return NextResponse.json({ ok: true, appointment_id: appointment.id });
}
