import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";
import { transitionLeadStage } from "@/lib/pipeline/transition";

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const supabase = createSupabaseAdminClient();
  const clinicId = payload.clinic_id || process.env.DEFAULT_CLINIC_ID;
  const attemptNo = Math.max(1, Number(payload.attempt_no || payload.attempt || 1));
  const startedAt = payload.started_at || new Date().toISOString();
  const leadId = payload.lead_id || null;

  if (!clinicId) {
    return NextResponse.json({ error: "clinic_id is required" }, { status: 400 });
  }

  await supabase.from("calls").upsert(
    {
      clinic_id: clinicId,
      retell_call_id: payload.call_id,
      lead_id: leadId,
      phone: payload.phone || null,
      status: "in_progress",
      started_at: startedAt,
      attempt_no: attemptNo,
      created_at: new Date().toISOString(),
    },
    { onConflict: "retell_call_id" }
  );

  if (leadId) {
    await supabase.from("lead_contact_attempts").upsert(
      {
        clinic_id: clinicId,
        lead_id: leadId,
        channel: "call_ai",
        attempt_no: attemptNo,
        status: "started",
        retell_call_id: payload.call_id,
        started_at: startedAt,
        meta: {
          source: "retell_webhook",
        },
      },
      { onConflict: "clinic_id,retell_call_id" }
    );

    await transitionLeadStage({
      supabase,
      clinicId,
      leadId,
      toStageKey: attemptNo > 1 ? "second_call_in_progress" : "first_call_in_progress",
      reason: "Llamada outbound iniciada",
      actorType: "retell_ai",
      actorId: payload.call_id || null,
      meta: {
        call_id: payload.call_id,
        attempt_no: attemptNo,
      },
    });

    await supabase
      .from("leads")
      .update({ last_contact_at: new Date().toISOString() })
      .eq("clinic_id", clinicId)
      .eq("id", leadId);
  }

  await supabase.from("system_state").upsert(
    {
      clinic_id: clinicId,
      current_call_retell_id: payload.call_id,
      current_call_lead_id: leadId,
      current_call_started_at: startedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );

  return NextResponse.json({ ok: true });
}
