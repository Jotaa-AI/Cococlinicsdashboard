import type { Lead } from "@/lib/types";

interface UpdateLeadOutcomeInput {
  supabase: any;
  clinicId: string;
  leadId: string;
  toStageKey: string;
  actorType: string;
  actorId: string | null;
  source: string;
  convertedValueEur?: number | null;
  convertedServiceName?: string | null;
  outcomeReason?: string | null;
}

interface UpdateLeadOutcomeResult {
  ok: boolean;
  lead?: Lead;
  error?: string;
}

export async function updateLeadOutcome(input: UpdateLeadOutcomeInput): Promise<UpdateLeadOutcomeResult> {
  const {
    supabase,
    clinicId,
    leadId,
    toStageKey,
    actorType,
    actorId,
    source,
    convertedValueEur = null,
    convertedServiceName = null,
    outcomeReason = null,
  } = input;

  const { data, error } = await supabase.rpc("rpc_transition_lead_stage", {
    p_clinic_id: clinicId,
    p_lead_id: leadId,
    p_to_stage_key: toStageKey,
    p_reason: "Actualización post-visita desde equipo",
    p_actor_type: actorType,
    p_actor_id: actorId,
    p_meta: { source },
  });

  const result = Array.isArray(data) ? data[0] : data;
  if (error || !result?.ok) {
    return { ok: false, error: error?.message || result?.error || "No se pudo actualizar la etapa del lead." };
  }

  const isClosed = toStageKey === "client_closed";
  const updatePayload = {
    converted_to_client: isClosed,
    converted_value_eur: isClosed ? convertedValueEur : null,
    converted_service_name: isClosed ? convertedServiceName : null,
    converted_at: isClosed ? new Date().toISOString() : null,
    post_visit_outcome_reason: isClosed ? null : outcomeReason,
    updated_at: new Date().toISOString(),
  };

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .update(updatePayload)
    .eq("clinic_id", clinicId)
    .eq("id", leadId)
    .select("*")
    .single();

  if (leadError || !lead) {
    return { ok: false, error: leadError?.message || "No se pudo guardar el estado comercial del lead." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    entity_type: "lead",
    entity_id: leadId,
    action: isClosed ? "lead_converted_to_client" : "lead_post_visit_status_updated",
    meta: {
      source,
      actor_id: actorId,
      to_stage_key: toStageKey,
      converted_value_eur: isClosed ? convertedValueEur : null,
      converted_service_name: isClosed ? convertedServiceName : null,
      post_visit_outcome_reason: isClosed ? null : outcomeReason,
    },
  });

  return { ok: true, lead: lead as Lead };
}
