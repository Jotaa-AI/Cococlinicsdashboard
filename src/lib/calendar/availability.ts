interface CheckAvailabilityInput {
  supabase: any;
  clinicId: string;
  startAt: string;
  endAt: string;
  excludeAppointmentId?: string;
}

interface AvailabilityResult {
  ok: boolean;
  error?: string;
}

export interface OccupiedRange {
  start: Date;
  end: Date;
  source: "lead_visit" | "internal_block";
  id: string;
}

export async function getOccupiedRanges(input: {
  supabase: any;
  clinicId: string;
  startAt: string;
  endAt: string;
  excludeAppointmentId?: string;
}): Promise<{ ok: boolean; error?: string; ranges?: OccupiedRange[] }> {
  const { supabase, clinicId, startAt, endAt, excludeAppointmentId } = input;

  let appointmentQuery = supabase
    .from("appointments")
    .select("id, start_at, end_at, entry_type")
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

  const appointmentRanges = ((
    conflictingAppointments || []
  ) as Array<{ id: string; start_at: string; end_at: string; entry_type: "lead_visit" | "internal_block" | null }>)
    .map((item) => ({
      id: item.id,
      source: (item.entry_type === "internal_block" ? "internal_block" : "lead_visit") as "lead_visit" | "internal_block",
      start: new Date(item.start_at),
      end: new Date(item.end_at),
    }))
    .filter((item) => !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime()));

  return { ok: true, ranges: appointmentRanges };
}

export async function checkSlotAvailability(input: CheckAvailabilityInput): Promise<AvailabilityResult> {
  const occupied = await getOccupiedRanges(input);

  if (!occupied.ok) {
    return { ok: false, error: occupied.error };
  }

  const conflictingLeadVisit = occupied.ranges?.find((item) => item.source === "lead_visit");
  if (conflictingLeadVisit) {
    return { ok: false, error: "Ese bloque ya esta ocupado por otra cita." };
  }

  const conflictingInternalBlock = occupied.ranges?.find((item) => item.source === "internal_block");
  if (conflictingInternalBlock) {
    return { ok: false, error: "Ese bloque coincide con un bloqueo interno." };
  }

  return { ok: true };
}
