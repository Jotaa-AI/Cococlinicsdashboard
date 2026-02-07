import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { exportAppointmentToGoogle } from "@/lib/google/sync";

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

  const body = await request.json();
  const admin = createSupabaseAdminClient();

  const { data: appointment, error } = await admin
    .from("appointments")
    .insert({
      clinic_id: profile.clinic_id,
      lead_id: body.lead_id || null,
      title: body.title || "Cita Coco Clinics",
      start_at: body.start_at,
      end_at: body.end_at,
      status: "scheduled",
      notes: body.notes || null,
      created_by: body.created_by || "staff",
      created_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 400 });
  }

  const gcalEventId = await exportAppointmentToGoogle(appointment, profile.clinic_id);
  if (gcalEventId) {
    await admin.from("appointments").update({ gcal_event_id: gcalEventId }).eq("id", appointment.id);
  }

  return NextResponse.json({ ok: true, appointment_id: appointment.id });
}
