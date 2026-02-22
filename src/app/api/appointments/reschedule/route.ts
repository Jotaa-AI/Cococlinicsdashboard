import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { exportAppointmentToGoogle } from "@/lib/google/sync";
import { validateSlotRange } from "@/lib/calendar/slot-rules";
import { checkSlotAvailability } from "@/lib/calendar/availability";

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
  if (!body?.appointment_id || !body?.start_at) {
    return NextResponse.json({ error: "appointment_id y start_at son obligatorios" }, { status: 400 });
  }

  const slot = validateSlotRange({
    startAt: String(body.start_at),
    endAt: body.end_at ? String(body.end_at) : null,
  });

  if (!slot.ok) {
    return NextResponse.json({ error: slot.error }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const availability = await checkSlotAvailability({
    supabase: admin,
    clinicId: profile.clinic_id,
    startAt: slot.startAt,
    endAt: slot.endAt,
    excludeAppointmentId: String(body.appointment_id),
  });

  if (!availability.ok) {
    return NextResponse.json({ error: availability.error }, { status: 409 });
  }

  const updatePayload: Record<string, string | null> = {
    start_at: slot.startAt,
    end_at: slot.endAt,
  };

  if (typeof body.title === "string") {
    updatePayload.title = body.title;
  }

  if ("notes" in body) {
    updatePayload.notes = body.notes ? String(body.notes) : null;
  }

  const { data: appointment, error } = await admin
    .from("appointments")
    .update(updatePayload)
    .eq("id", body.appointment_id)
    .select("*")
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "Update failed" }, { status: 400 });
  }

  const gcalEventId = await exportAppointmentToGoogle(appointment, profile.clinic_id);
  if (gcalEventId && !appointment.gcal_event_id) {
    await admin.from("appointments").update({ gcal_event_id: gcalEventId }).eq("id", appointment.id);
  }

  return NextResponse.json({ ok: true });
}
