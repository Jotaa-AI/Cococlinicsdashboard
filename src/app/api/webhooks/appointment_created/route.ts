import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";
import { exportAppointmentToGoogle } from "@/lib/google/sync";

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const supabase = createSupabaseAdminClient();
  const clinicId = payload.clinic_id || process.env.DEFAULT_CLINIC_ID;

  const { data: appointment, error } = await supabase
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      lead_id: payload.lead_id || null,
      title: payload.title || "Cita Coco Clinics",
      start_at: payload.start_at,
      end_at: payload.end_at,
      status: payload.status || "scheduled",
      notes: payload.notes || null,
      created_by: payload.created_by || "agent",
      created_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 400 });
  }

  if (payload.export_google) {
    const gcalEventId = await exportAppointmentToGoogle(appointment, clinicId);
    if (gcalEventId) {
      await supabase.from("appointments").update({ gcal_event_id: gcalEventId }).eq("id", appointment.id);
    }
  }

  if (payload.lead_id) {
    await supabase.from("leads").update({ status: "visit_scheduled" }).eq("id", payload.lead_id);
  }

  return NextResponse.json({ ok: true, appointment_id: appointment.id });
}
