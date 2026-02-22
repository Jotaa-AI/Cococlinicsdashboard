interface CheckAvailabilityInput {
  supabase: any;
  clinicId: string;
  startAt: string;
  endAt: string;
  excludeAppointmentId?: string;
  excludeBusyBlockId?: string;
}

interface AvailabilityResult {
  ok: boolean;
  error?: string;
}

export async function checkSlotAvailability(input: CheckAvailabilityInput): Promise<AvailabilityResult> {
  const { supabase, clinicId, startAt, endAt, excludeAppointmentId, excludeBusyBlockId } = input;

  let appointmentQuery = supabase
    .from("appointments")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("status", "scheduled")
    .lt("start_at", endAt)
    .gt("end_at", startAt)
    .limit(1);

  if (excludeAppointmentId) {
    appointmentQuery = appointmentQuery.neq("id", excludeAppointmentId);
  }

  const { data: conflictingAppointments, error: appointmentError } = await appointmentQuery;
  if (appointmentError) {
    return { ok: false, error: appointmentError.message };
  }
  if (conflictingAppointments && conflictingAppointments.length > 0) {
    return { ok: false, error: "Ese bloque ya esta ocupado por otra cita." };
  }

  let blockQuery = supabase
    .from("busy_blocks")
    .select("id")
    .eq("clinic_id", clinicId)
    .lt("start_at", endAt)
    .gt("end_at", startAt)
    .limit(1);

  if (excludeBusyBlockId) {
    blockQuery = blockQuery.neq("id", excludeBusyBlockId);
  }

  const { data: conflictingBlocks, error: blockError } = await blockQuery;
  if (blockError) {
    return { ok: false, error: blockError.message };
  }
  if (conflictingBlocks && conflictingBlocks.length > 0) {
    return { ok: false, error: "Ese bloque coincide con un bloqueo interno." };
  }

  const { data: googleEvents, error: googleError } = await supabase
    .from("calendar_events")
    .select("id, status")
    .eq("clinic_id", clinicId)
    .lt("start_at", endAt)
    .gt("end_at", startAt)
    .limit(20);

  if (googleError) {
    return { ok: false, error: googleError.message };
  }

  const conflictingGoogleEvent = (googleEvents || []).find((event: { status: string | null }) => {
    return (event.status || "confirmed").toLowerCase() !== "cancelled";
  });

  if (conflictingGoogleEvent) {
    return { ok: false, error: "Ese horario ya aparece ocupado en Google Calendar." };
  }

  return { ok: true };
}

