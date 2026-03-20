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

function extractMissingColumn(message?: string | null) {
  if (!message) return null;
  const quotedMatch = message.match(/'([^']+)' column/);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const relationMatch = message.match(/column \"([^\"]+)\" of relation/);
  if (relationMatch?.[1]) return relationMatch[1];
  const schemaMatch = message.match(/column (?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+) does not exist/);
  if (schemaMatch?.[1]) return schemaMatch[1];
  const simpleMatch = message.match(/column \"?([a-zA-Z0-9_]+)\"? does not exist/);
  if (simpleMatch?.[1]) return simpleMatch[1];
  return null;
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

  let { data: conflictingAppointments, error: appointmentError } = await appointmentQuery;

  if (appointmentError && extractMissingColumn(appointmentError.message) === "entry_type") {
    let fallbackQuery = supabase
      .from("appointments")
      .select("id, start_at, end_at")
      .eq("clinic_id", clinicId)
      .eq("status", "scheduled")
      .lt("start_at", endAt)
      .gt("end_at", startAt);

    if (excludeAppointmentId) {
      fallbackQuery = fallbackQuery.neq("id", excludeAppointmentId);
    }

    const fallbackResult = await fallbackQuery;
    conflictingAppointments = fallbackResult.data;
    appointmentError = fallbackResult.error;
  }

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
