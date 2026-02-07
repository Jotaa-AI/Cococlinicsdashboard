export const CALL_OUTCOMES = [
  "contacted",
  "no_response",
  "not_interested",
  "appointment_proposed",
  "appointment_scheduled",
] as const;

export const CALL_OUTCOME_LABELS: Record<(typeof CALL_OUTCOMES)[number], string> = {
  contacted: "Contactado",
  no_response: "No responde",
  not_interested: "No interesado",
  appointment_proposed: "Cita propuesta",
  appointment_scheduled: "Cita agendada",
};

export type CallOutcome = (typeof CALL_OUTCOMES)[number];
