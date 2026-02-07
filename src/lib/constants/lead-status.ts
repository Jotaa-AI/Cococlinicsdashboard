export const LEAD_STATUSES = [
  "new",
  "whatsapp_sent",
  "call_done",
  "contacted",
  "visit_scheduled",
  "no_response",
  "not_interested",
] as const;

export const LEAD_STATUS_LABELS: Record<(typeof LEAD_STATUSES)[number], string> = {
  new: "Nuevo lead",
  whatsapp_sent: "WhatsApp enviado",
  call_done: "Llamada realizada",
  contacted: "Contactado",
  visit_scheduled: "Visita agendada",
  no_response: "No responde",
  not_interested: "No interesado",
};

export type LeadStatus = (typeof LEAD_STATUSES)[number];
