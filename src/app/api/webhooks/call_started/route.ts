import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const supabase = createSupabaseAdminClient();
  const clinicId = payload.clinic_id || process.env.DEFAULT_CLINIC_ID;

  await supabase.from("calls").upsert(
    {
      clinic_id: clinicId,
      retell_call_id: payload.call_id,
      lead_id: payload.lead_id || null,
      phone: payload.phone || null,
      status: "in_progress",
      started_at: payload.started_at || new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
    { onConflict: "retell_call_id" }
  );

  await supabase.from("system_state").upsert(
    {
      clinic_id: clinicId,
      current_call_retell_id: payload.call_id,
      current_call_lead_id: payload.lead_id || null,
      current_call_started_at: payload.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );

  return NextResponse.json({ ok: true });
}
