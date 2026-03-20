import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";
import { normalizeEsPhone, resolveLeadForAppointment } from "@/lib/leads/resolveLead";
import type { Json } from "@/lib/types";

function pickFirstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getNestedValue(source: unknown, path: string[]) {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const payloadRecord = payload as Record<string, unknown>;
  const clinicId = pickFirstString(payloadRecord.clinic_id, process.env.DEFAULT_CLINIC_ID);
  if (!clinicId) {
    return NextResponse.json({ error: "clinic_id is required" }, { status: 400 });
  }

  const directionRaw =
    pickFirstString(payloadRecord.direction, getNestedValue(payloadRecord, ["body", "direction"])) || "outbound";
  const direction = directionRaw === "inbound" ? "inbound" : "outbound";
  const roleRaw = pickFirstString(payloadRecord.role);
  const role = roleRaw === "assistant" || roleRaw === "system" || roleRaw === "human"
    ? roleRaw
    : direction === "inbound"
      ? "human"
      : "assistant";

  const rawPhone = pickFirstString(
    payloadRecord.phone_e164,
    payloadRecord.phone,
    payloadRecord.lead_phone,
    direction === "inbound" ? payloadRecord.from : payloadRecord.to,
    direction === "inbound" ? getNestedValue(payloadRecord, ["body", "from"]) : getNestedValue(payloadRecord, ["body", "to"]),
    payloadRecord.from,
    payloadRecord.to,
    getNestedValue(payloadRecord, ["body", "from"]),
    getNestedValue(payloadRecord, ["body", "to"])
  );
  const phoneE164 = normalizeEsPhone(rawPhone);
  if (!phoneE164) {
    return NextResponse.json({ error: "phone_e164 is required in +34 format" }, { status: 400 });
  }

  const text = pickFirstString(
    payloadRecord.text,
    payloadRecord.message,
    getNestedValue(payloadRecord, ["text", "body"]),
    getNestedValue(payloadRecord, ["message", "body"]),
    getNestedValue(payloadRecord, ["message", "text"]),
    getNestedValue(payloadRecord, ["body", "text", "body"]),
    getNestedValue(payloadRecord, ["body", "message", "body"]),
    getNestedValue(payloadRecord, ["body", "message", "text"]),
    getNestedValue(payloadRecord, ["body", "text"])
  );
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const resolvedLead = await resolveLeadForAppointment({
    supabase,
    clinicId,
    leadId: pickFirstString(payloadRecord.lead_id),
    leadName: pickFirstString(payloadRecord.lead_name, payloadRecord.full_name),
    leadPhone: phoneE164,
    treatment: null,
    source: "whatsapp_ai",
  }).catch(async () => {
    const { data: lead } = await supabase
      .from("leads")
      .select("id, full_name, phone")
      .eq("clinic_id", clinicId)
      .eq("phone", phoneE164)
      .maybeSingle();

    return {
      leadId: lead?.id || null,
      leadName: lead?.full_name || null,
      leadPhone: lead?.phone || phoneE164,
    };
  });

  const { data: existingThread } = await supabase
    .from("wa_threads")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("phone_e164", phoneE164)
    .maybeSingle();

  const threadPayload = {
    clinic_id: clinicId,
    lead_id: resolvedLead.leadId || existingThread?.lead_id || null,
    phone_e164: phoneE164,
    state: pickFirstString(payloadRecord.state) || existingThread?.state || "awaiting_reply",
    hitl_active: typeof payloadRecord.hitl_active === "boolean" ? payloadRecord.hitl_active : existingThread?.hitl_active || false,
    updated_at: pickFirstString(payloadRecord.updated_at, payloadRecord.created_at) || new Date().toISOString(),
  };

  const threadResult = existingThread
    ? await supabase.from("wa_threads").update(threadPayload).eq("id", existingThread.id).select("*").single()
    : await supabase.from("wa_threads").insert(threadPayload).select("*").single();

  if (threadResult.error || !threadResult.data) {
    return NextResponse.json(
      { error: threadResult.error?.message || "No se pudo guardar el hilo de WhatsApp." },
      { status: 500 }
    );
  }

  const thread = threadResult.data;
  const providerMessageId = pickFirstString(
    payloadRecord.provider_message_id,
    payloadRecord.wamid,
    payloadRecord.id,
    getNestedValue(payloadRecord, ["body", "provider_message_id"]),
    getNestedValue(payloadRecord, ["body", "wamid"]),
    getNestedValue(payloadRecord, ["body", "id"])
  );
  const metadata = payloadRecord.metadata && typeof payloadRecord.metadata === "object" ? (payloadRecord.metadata as Json) : {};

  const messagePayload = {
    thread_id: thread.id,
    clinic_id: clinicId,
    lead_id: resolvedLead.leadId || thread.lead_id || null,
    provider_message_id: providerMessageId,
    direction,
    role,
    text,
    intent: pickFirstString(payloadRecord.intent),
    ab_variant: pickFirstString(payloadRecord.ab_variant),
    delivery_status: pickFirstString(payloadRecord.delivery_status),
    metadata,
    created_at:
      pickFirstString(
        payloadRecord.created_at,
        payloadRecord.createTime,
        payloadRecord.timestamp,
        getNestedValue(payloadRecord, ["body", "created_at"]),
        getNestedValue(payloadRecord, ["body", "createTime"]),
        getNestedValue(payloadRecord, ["body", "timestamp"])
      ) || new Date().toISOString(),
  };

  const messageResult = providerMessageId
    ? await supabase
        .from("wa_messages")
        .upsert(messagePayload, { onConflict: "clinic_id,provider_message_id" })
        .select("*")
        .single()
    : await supabase.from("wa_messages").insert(messagePayload).select("*").single();

  if (messageResult.error || !messageResult.data) {
    return NextResponse.json(
      { error: messageResult.error?.message || "No se pudo guardar el mensaje de WhatsApp." },
      { status: 500 }
    );
  }

  if (direction === "outbound") {
    await supabase
      .from("wa_threads")
      .update({
        last_outbound_message_id: messageResult.data.id,
        updated_at: messagePayload.created_at,
      })
      .eq("id", thread.id);
  }

  return NextResponse.json({
    ok: true,
    thread_id: thread.id,
    message_id: messageResult.data.id,
    lead_id: resolvedLead.leadId,
  });
}
