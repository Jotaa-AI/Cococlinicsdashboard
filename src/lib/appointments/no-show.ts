const NO_SHOW_MARKER = "[NO_SHOW]";

export function isNoShowStatus(status?: string | null) {
  return status === "no_show";
}

export function isNoShowAppointment(notes?: string | null) {
  const normalized = String(notes || "").toLowerCase();
  return normalized.includes(NO_SHOW_MARKER.toLowerCase()) || normalized.includes("no asistió a la cita");
}

export function isNoShowAppointmentRecord(appointment?: { status?: string | null; notes?: string | null } | null) {
  if (!appointment) return false;
  return isNoShowStatus(appointment.status) || isNoShowAppointment(appointment.notes);
}

export function buildNoShowNotes(existingNotes: string | null | undefined, reason: string) {
  const parts = String(existingNotes || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== NO_SHOW_MARKER && part.toLowerCase() !== reason.toLowerCase());

  return [NO_SHOW_MARKER, reason, ...parts].join(" | ");
}
