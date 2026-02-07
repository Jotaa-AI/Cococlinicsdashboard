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

  const lead = {
    id: payload.id,
    clinic_id: clinicId,
    full_name: payload.full_name || payload.name || null,
    phone: payload.phone || null,
    treatment: payload.treatment || null,
    source: payload.source || "meta",
    status: payload.status || "new",
    created_at: payload.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const conflict = payload.id ? "id" : "clinic_id,phone";
  await supabase.from("leads").upsert(lead, { onConflict: conflict });

  return NextResponse.json({ ok: true });
}
