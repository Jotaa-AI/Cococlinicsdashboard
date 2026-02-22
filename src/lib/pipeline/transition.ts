import { LEGACY_STATUS_FROM_STAGE } from "@/lib/constants/lead-stage";

interface TransitionInput {
  supabase: any;
  clinicId: string;
  leadId: string;
  toStageKey: string;
  reason: string;
  actorType?: string;
  actorId?: string | null;
  meta?: Record<string, unknown>;
}

export async function transitionLeadStage({
  supabase,
  clinicId,
  leadId,
  toStageKey,
  reason,
  actorType = "system",
  actorId = null,
  meta = {},
}: TransitionInput) {
  const { data, error } = await supabase.rpc("rpc_transition_lead_stage", {
    p_clinic_id: clinicId,
    p_lead_id: leadId,
    p_to_stage_key: toStageKey,
    p_reason: reason,
    p_actor_type: actorType,
    p_actor_id: actorId,
    p_meta: meta,
  });

  if (!error) {
    const result = Array.isArray(data) ? data[0] : null;
    if (result?.ok) return { ok: true };
  }

  const fallbackStatus = LEGACY_STATUS_FROM_STAGE[toStageKey] || "call_done";
  const { error: fallbackError } = await supabase
    .from("leads")
    .update({
      stage_key: toStageKey,
      status: fallbackStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("clinic_id", clinicId);

  return { ok: !fallbackError, error: error || fallbackError };
}

export function computeRetryDueAt(referenceDateIso?: string | null) {
  const reference = referenceDateIso ? new Date(referenceDateIso) : new Date();
  const hour = reference.getHours();
  const addHours = hour < 14 ? 6 : 16;
  return new Date(reference.getTime() + addHours * 60 * 60 * 1000).toISOString();
}

export function mapCallOutcomeToStage(outcome: string | null, attemptNo: number) {
  switch (outcome) {
    case "appointment_scheduled":
      return "visit_scheduled";
    case "not_interested":
      return "not_interested";
    case "no_response":
      return attemptNo > 1 ? "no_answer_second_call" : "no_answer_first_call";
    case "appointment_proposed":
      return "second_call_scheduled";
    case "contacted":
      return "second_call_scheduled";
    default:
      return attemptNo > 1 ? "second_call_scheduled" : "first_call_in_progress";
  }
}
