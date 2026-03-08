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

export interface OccupiedRange {
  start: Date;
  end: Date;
  source: "appointment" | "busy_block";
  id: string;
}

export async function getOccupiedRanges(input: {
  supabase: any;
  clinicId: string;
  startAt: string;
  endAt: string;
  excludeAppointmentId?: string;
  excludeBusyBlockId?: string;
}): Promise<{ ok: boolean; error?: string; ranges?: OccupiedRange[] }> {
  const { supabase, clinicId, startAt, endAt, excludeAppointmentId, excludeBusyBlockId } = input;

  let appointmentQuery = supabase
    .from("appointments")
    .select("id, start_at, end_at")
    .eq("clinic_id", clinicId)
    .eq("status", "scheduled")
    .lt("start_at", endAt)
    .gt("end_at", startAt);

  if (excludeAppointmentId) {
    appointmentQuery = appointmentQuery.neq("id", excludeAppointmentId);
  }

  const { data: conflictingAppointments, error: appointmentError } = await appointmentQuery;
  if (appointmentError) {
    return { ok: false, error: appointmentError.message };
  }

  let blockQuery = supabase
    .from("busy_blocks")
    .select("id, start_at, end_at")
    .eq("clinic_id", clinicId)
    .lt("start_at", endAt)
    .gt("end_at", startAt);

  if (excludeBusyBlockId) {
    blockQuery = blockQuery.neq("id", excludeBusyBlockId);
  }

  const { data: conflictingBlocks, error: blockError } = await blockQuery;
  if (blockError) {
    return { ok: false, error: blockError.message };
  }

  const appointmentRanges = ((conflictingAppointments || []) as Array<{ id: string; start_at: string; end_at: string }>)
    .map((item) => ({
      id: item.id,
      source: "appointment" as const,
      start: new Date(item.start_at),
      end: new Date(item.end_at),
    }))
    .filter((item) => !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime()));

  const blockRanges = ((conflictingBlocks || []) as Array<{ id: string; start_at: string; end_at: string }>)
    .map((item) => ({
      id: item.id,
      source: "busy_block" as const,
      start: new Date(item.start_at),
      end: new Date(item.end_at),
    }))
    .filter((item) => !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime()));

  return { ok: true, ranges: [...appointmentRanges, ...blockRanges] };
}

export async function checkSlotAvailability(input: CheckAvailabilityInput): Promise<AvailabilityResult> {
  const occupied = await getOccupiedRanges(input);

  if (!occupied.ok) {
    return { ok: false, error: occupied.error };
  }

  const conflictingAppointment = occupied.ranges?.find((item) => item.source === "appointment");
  if (conflictingAppointment) {
    return { ok: false, error: "Ese bloque ya esta ocupado por otra cita." };
  }

  const conflictingBlock = occupied.ranges?.find((item) => item.source === "busy_block");
  if (conflictingBlock) {
    return { ok: false, error: "Ese bloque coincide con un bloqueo interno." };
  }

  return { ok: true };
}
