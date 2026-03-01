export interface StageTone {
  mood: string;
  accent: string;
  badge: "success" | "warning" | "danger" | "default";
  hint: string;
}

export const PIPELINE_LABELS_ES: Record<string, string> = {
  calls_ai: "Agentes de Llamada",
  whatsapp_ai: "Agentes de WhatsApp",
  closed: "Cerrados",
};

export const STAGE_TONE_ES: Record<string, StageTone> = {
  new_lead: {
    mood: "Frio",
    accent: "border-t-slate-300",
    badge: "default",
    hint: "Lead entrante sin contacto",
  },
  first_call_in_progress: {
    mood: "Activo",
    accent: "border-t-blue-500",
    badge: "warning",
    hint: "Primer intento de llamada en curso",
  },
  no_answer_first_call: {
    mood: "Sin respuesta",
    accent: "border-t-zinc-400",
    badge: "danger",
    hint: "No respondió al primer intento",
  },
  second_call_scheduled: {
    mood: "Reintento",
    accent: "border-t-sky-500",
    badge: "warning",
    hint: "Segunda llamada pendiente en otra franja",
  },
  second_call_in_progress: {
    mood: "Activo",
    accent: "border-t-indigo-500",
    badge: "warning",
    hint: "Segundo intento de llamada en curso",
  },
  no_answer_second_call: {
    mood: "Escalado",
    accent: "border-t-orange-500",
    badge: "danger",
    hint: "Pasa a canal WhatsApp",
  },
  contacting_whatsapp: {
    mood: "Templado",
    accent: "border-t-emerald-400",
    badge: "default",
    hint: "Primer mensaje WhatsApp enviado",
  },
  whatsapp_conversation_active: {
    mood: "Caliente",
    accent: "border-t-emerald-500",
    badge: "warning",
    hint: "Conversación activa para cierre",
  },
  whatsapp_followup_pending: {
    mood: "Seguimiento",
    accent: "border-t-teal-500",
    badge: "default",
    hint: "Esperando respuesta del lead",
  },
  whatsapp_failed_team_review: {
    mood: "Manual",
    accent: "border-t-amber-500",
    badge: "danger",
    hint: "Revisión manual por el equipo",
  },
  visit_scheduled: {
    mood: "Muy caliente",
    accent: "border-t-emerald-600",
    badge: "success",
    hint: "Cita cerrada",
  },
  post_visit_pending_decision: {
    mood: "Pendiente",
    accent: "border-t-amber-400",
    badge: "warning",
    hint: "Visitó la clínica y está valorando la propuesta",
  },
  post_visit_follow_up: {
    mood: "Seguimiento",
    accent: "border-t-orange-400",
    badge: "warning",
    hint: "Hace falta seguimiento comercial tras la visita",
  },
  post_visit_not_closed: {
    mood: "No cerró",
    accent: "border-t-rose-300",
    badge: "danger",
    hint: "Tuvo visita, pero no se cerró la venta",
  },
  client_closed: {
    mood: "Cerrado",
    accent: "border-t-emerald-700",
    badge: "success",
    hint: "Cliente convertido con venta cerrada",
  },
  not_interested: {
    mood: "Descartado",
    accent: "border-t-rose-400",
    badge: "danger",
    hint: "Lead no interesado",
  },
  discarded: {
    mood: "Descartado",
    accent: "border-t-rose-500",
    badge: "danger",
    hint: "Cierre interno",
  },
};

export const LEGACY_STATUS_FROM_STAGE: Record<string, string> = {
  new_lead: "new",
  first_call_in_progress: "call_done",
  no_answer_first_call: "no_response",
  second_call_scheduled: "no_response",
  second_call_in_progress: "no_response",
  no_answer_second_call: "no_response",
  contacting_whatsapp: "whatsapp_sent",
  whatsapp_conversation_active: "contacted",
  whatsapp_followup_pending: "whatsapp_sent",
  whatsapp_failed_team_review: "no_response",
  visit_scheduled: "visit_scheduled",
  post_visit_pending_decision: "contacted",
  post_visit_follow_up: "contacted",
  post_visit_not_closed: "not_interested",
  client_closed: "visit_scheduled",
  not_interested: "not_interested",
  discarded: "not_interested",
};
