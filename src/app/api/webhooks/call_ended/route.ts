import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";

function mapOutcomeToLeadStatus(outcome: string | null) {
  switch (outcome) {
    case "appointment_scheduled":
      return "visit_scheduled";
    case "appointment_proposed":
      return "contacted";
    case "contacted":
      return "contacted";
    case "no_response":
      return "no_response";
    case "not_interested":
      return "not_interested";
    default:
      return "call_done";
  }
}

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const supabase = createSupabaseAdminClient();
  const clinicId = payload.clinic_id || process.env.DEFAULT_CLINIC_ID;

  const { data: call } = await supabase
    .from("calls")
    .update({
      status: "ended",
      ended_at: payload.ended_at || new Date().toISOString(),
      duration_sec: payload.duration || payload.duration_sec || null,
      outcome: payload.outcome || null,
      transcript: payload.transcript || null,
      summary: payload.summary || null,
      extracted: payload.extracted_fields || null,
      recording_url: payload.recording_url || null,
    })
    .eq("retell_call_id", payload.call_id)
    .select("*")
    .single();

  if (payload.lead_id || call?.lead_id) {
    const leadId = payload.lead_id || call?.lead_id;
    await supabase
      .from("leads")
      .update({ status: mapOutcomeToLeadStatus(payload.outcome), updated_at: new Date().toISOString() })
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

  return NextResponse.json({ ok: true });
}
