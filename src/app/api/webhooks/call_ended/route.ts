import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";
import { computeRetryDueAt, mapCallOutcomeToStage, transitionLeadStage } from "@/lib/pipeline/transition";

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const supabase = createSupabaseAdminClient();
  const clinicId = payload.clinic_id || process.env.DEFAULT_CLINIC_ID;

  if (!clinicId) {
    return NextResponse.json({ error: "clinic_id is required" }, { status: 400 });
  }

  const endedAt = payload.ended_at || new Date().toISOString();
  const startedAt = payload.started_at || null;
  const durationSec = Number(payload.duration || payload.duration_sec || 0) || null;
  const recordingUrl =
    payload.recording_url ||
    payload.recordingUrl ||
    payload.recording?.url ||
    payload.recording?.recording_url ||
    null;
  const providedCostRaw = payload.call_cost_eur ?? payload.call_cost ?? payload.cost_eur ?? payload.cost ?? null;
  const providedCost = Number(providedCostRaw);
  const costPerMin = Number(process.env.CALL_COST_PER_MIN || process.env.NEXT_PUBLIC_CALL_COST_PER_MIN || 0);
  const estimatedCost =
    durationSec && Number.isFinite(costPerMin) && costPerMin > 0
      ? Number(((durationSec / 60) * costPerMin).toFixed(4))
      : null;
  const callCostEur = Number.isFinite(providedCost) ? Number(providedCost.toFixed(4)) : estimatedCost;

  const updatePayload: Record<string, unknown> = {
    status: "ended",
    ended_at: endedAt,
    duration_sec: durationSec,
    outcome: payload.outcome || null,
    transcript: payload.transcript || null,
    summary: payload.summary || null,
    extracted: payload.extracted_fields || null,
    recording_url: recordingUrl,
  };

  if (callCostEur !== null) {
    updatePayload.call_cost_eur = callCostEur;
  }

  const { data: call } = await supabase
    .from("calls")
    .update(updatePayload)
    .eq("retell_call_id", payload.call_id)
    .select("*")
    .single();

  const leadId = payload.lead_id || call?.lead_id || null;
  const attemptNo = Math.max(1, Number(payload.attempt_no || call?.attempt_no || 1));
  const outcome = payload.outcome || call?.outcome || null;
  const targetStage = mapCallOutcomeToStage(outcome, attemptNo);

  if (leadId) {
    await supabase.from("lead_contact_attempts").upsert(
      {
        clinic_id: clinicId,
        lead_id: leadId,
        channel: "call_ai",
        attempt_no: attemptNo,
        status: "completed",
        retell_call_id: payload.call_id,
        started_at: startedAt || call?.started_at || null,
        ended_at: endedAt,
        outcome,
        summary: payload.summary || null,
        meta: {
          duration_sec: durationSec,
          recording_url: recordingUrl,
          call_cost_eur: callCostEur,
        },
      },
      { onConflict: "clinic_id,retell_call_id" }
    );

    let nextActionAt: string | null = null;

    if (outcome === "no_response" && attemptNo === 1) {
      const retryAt = computeRetryDueAt(call?.started_at || startedAt || endedAt);
      nextActionAt = retryAt;

      await supabase.from("lead_next_actions").upsert(
        {
          clinic_id: clinicId,
          lead_id: leadId,
          action_type: "retry_call",
          due_at: retryAt,
          status: "pending",
          payload: {
            recommended_attempt_no: 2,
            reason: "no_answer_first_call",
          },
          idempotency_key: `retry_call:${leadId}:2`,
        },
        { onConflict: "clinic_id,idempotency_key" }
      );
    }

    if (outcome === "no_response" && attemptNo > 1) {
      nextActionAt = new Date().toISOString();

      await supabase.from("lead_next_actions").upsert(
        {
          clinic_id: clinicId,
          lead_id: leadId,
          action_type: "start_whatsapp_ai",
          due_at: nextActionAt,
          status: "pending",
          payload: {
            reason: "no_answer_second_call",
          },
          idempotency_key: `start_whatsapp_ai:${leadId}`,
        },
        { onConflict: "clinic_id,idempotency_key" }
      );
    }

    await transitionLeadStage({
      supabase,
      clinicId,
      leadId,
      toStageKey: targetStage,
      reason: "Resultado de llamada outbound",
      actorType: "retell_ai",
      actorId: payload.call_id || null,
      meta: {
        outcome,
        attempt_no: attemptNo,
        next_action_at: nextActionAt,
      },
    });

    await supabase
      .from("leads")
      .update({
        last_contact_at: endedAt,
        next_action_at: nextActionAt,
      })
      .eq("clinic_id", clinicId)
      .eq("id", leadId);
  }

  await supabase.from("system_state").upsert(
    {
      clinic_id: clinicId,
      current_call_retell_id: null,
      current_call_lead_id: null,
      current_call_started_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );

  return NextResponse.json({ ok: true, stage: targetStage });
}
