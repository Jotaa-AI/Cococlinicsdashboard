import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";
import { normalizeEsPhone, resolveLeadForAppointment } from "@/lib/leads/resolveLead";
import type { Json } from "@/lib/types";
import {
  normalizeWhatsappMessageText,
  sanitizeIncomingWhatsappString,
  sanitizeWhatsappJson,
  sanitizeWhatsappText,
} from "@/lib/whatsapp/message-normalization";

function pickFirstString(...values: Array<unknown>) {
  for (const value of values) {
    const sanitized = sanitizeIncomingWhatsappString(value);
    if (sanitized) return sanitized;
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

async function getLeadById(supabase: ReturnType<typeof createSupabaseAdminClient>, clinicId: string, leadId: string) {
  const { data } = await supabase
    .from("leads")
    .select("id, full_name, phone")
    .eq("clinic_id", clinicId)
    .eq("id", leadId)
    .maybeSingle();

  return data || null;
}

async function getLeadByPhone(supabase: ReturnType<typeof createSupabaseAdminClient>, clinicId: string, phone: string) {
  const { data } = await supabase
    .from("leads")
    .select("id, full_name, phone")
    .eq("clinic_id", clinicId)
    .eq("phone", phone)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
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
  const bodyRecord = (getNestedValue(payloadRecord, ["body"]) || null) as Record<string, unknown> | null;
  const inboundRecord = (getNestedValue(payloadRecord, ["body", "whatsappInboundMessage"]) || null) as Record<string, unknown> | null;
  const outboundRecord = (getNestedValue(payloadRecord, ["body", "whatsappOutboundMessage"]) || null) as Record<string, unknown> | null;
  const providerRecord = inboundRecord || outboundRecord || bodyRecord;
  const clinicId = pickFirstString(payloadRecord.clinic_id, process.env.DEFAULT_CLINIC_ID);
  if (!clinicId) {
    return NextResponse.json({ error: "clinic_id is required" }, { status: 400 });
  }

  const directionRaw =
    pickFirstString(
      payloadRecord.direction,
      getNestedValue(payloadRecord, ["body", "direction"]),
      inboundRecord ? "inbound" : null,
      outboundRecord ? "outbound" : null
    ) || "outbound";
  const direction = directionRaw === "inbound" ? "inbound" : "outbound";
  const roleRaw = pickFirstString(payloadRecord.role);
  const role = roleRaw === "assistant" || roleRaw === "system" || roleRaw === "human"
    ? roleRaw
    : direction === "inbound"
      ? "human"
      : "assistant";

  const providerMessageId = pickFirstString(
    payloadRecord.provider_message_id,
    payloadRecord.wamid,
    payloadRecord.id,
    getNestedValue(payloadRecord, ["body", "provider_message_id"]),
    getNestedValue(payloadRecord, ["body", "wamid"]),
    getNestedValue(payloadRecord, ["body", "id"]),
    getNestedValue(payloadRecord, ["body", "whatsappInboundMessage", "provider_message_id"]),
    getNestedValue(payloadRecord, ["body", "whatsappInboundMessage", "wamid"]),
    getNestedValue(payloadRecord, ["body", "whatsappInboundMessage", "id"]),
    getNestedValue(payloadRecord, ["body", "whatsappOutboundMessage", "provider_message_id"]),
    getNestedValue(payloadRecord, ["body", "whatsappOutboundMessage", "wamid"]),
    getNestedValue(payloadRecord, ["body", "whatsappOutboundMessage", "id"])
  );

  const supabase = createSupabaseAdminClient();

  const { data: providerLinkedMessage } = providerMessageId
    ? await supabase
        .from("wa_messages")
        .select("id, thread_id, lead_id, direction, role, text, provider_message_id")
        .eq("clinic_id", clinicId)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle()
    : { data: null };

  const { data: providerLinkedThread } =
    providerLinkedMessage?.thread_id
      ? await supabase.from("wa_threads").select("*").eq("id", providerLinkedMessage.thread_id).maybeSingle()
      : { data: null };

  const rawPhone = pickFirstString(
    direction === "inbound" ? payloadRecord.from : payloadRecord.to,
    direction === "inbound" ? payloadRecord.phone_e164 : payloadRecord.to,
    direction === "inbound" ? payloadRecord.phone : payloadRecord.phone,
    direction === "inbound" ? payloadRecord.lead_phone : payloadRecord.lead_phone,
    direction === "inbound" ? getNestedValue(payloadRecord, ["metadata", "from"]) : getNestedValue(payloadRecord, ["metadata", "to"]),
    direction === "inbound" ? getNestedValue(payloadRecord, ["body", "from"]) : getNestedValue(payloadRecord, ["body", "to"]),
    direction === "inbound" ? getNestedValue(payloadRecord, ["body", "whatsappInboundMessage", "from"]) : getNestedValue(payloadRecord, ["body", "whatsappOutboundMessage", "to"]),
    direction === "inbound" ? getNestedValue(providerRecord, ["from"]) : getNestedValue(providerRecord, ["to"]),
    payloadRecord.phone_e164,
    payloadRecord.phone,
    providerLinkedThread?.phone_e164
  );
  const phoneE164 = normalizeEsPhone(rawPhone);
  if (!phoneE164) {
    return NextResponse.json({ error: "phone_e164 is required in +34 format" }, { status: 400 });
  }

  const rawText = pickFirstString(
    payloadRecord.text,
    payloadRecord.message,
    getNestedValue(payloadRecord, ["text", "body"]),
    getNestedValue(payloadRecord, ["message", "body"]),
    getNestedValue(payloadRecord, ["message", "text"]),
    getNestedValue(payloadRecord, ["body", "text", "body"]),
    getNestedValue(payloadRecord, ["body", "message", "body"]),
    getNestedValue(payloadRecord, ["body", "message", "text"]),
    getNestedValue(payloadRecord, ["body", "text"]),
    getNestedValue(payloadRecord, ["body", "whatsappInboundMessage", "text", "body"]),
    getNestedValue(payloadRecord, ["body", "whatsappOutboundMessage", "text", "body"]),
    getNestedValue(providerRecord, ["text", "body"]),
    getNestedValue(providerRecord, ["text"])
  );
  const text = sanitizeWhatsappText(rawText);
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const preferredLeadId = pickFirstString(payloadRecord.lead_id, providerLinkedThread?.lead_id);
  const leadNameHint = pickFirstString(payloadRecord.lead_name, payloadRecord.full_name);

  const resolvedLead =
    direction === "inbound"
      ? await resolveLeadForAppointment({
          supabase,
          clinicId,
          leadId: preferredLeadId,
          leadName: leadNameHint,
          leadPhone: phoneE164,
          treatment: null,
          source: "whatsapp_ai",
        }).catch(async () => {
          const lead = await getLeadByPhone(supabase, clinicId, phoneE164);
          return {
            leadId: lead?.id || null,
            leadName: lead?.full_name || leadNameHint || null,
            leadPhone: lead?.phone || phoneE164,
          };
        })
      : await (async () => {
          const leadById = preferredLeadId ? await getLeadById(supabase, clinicId, preferredLeadId) : null;
          const leadByPhone = !leadById ? await getLeadByPhone(supabase, clinicId, phoneE164) : null;
          const matchedLead = leadById || leadByPhone;

          return {
            leadId: matchedLead?.id || preferredLeadId || null,
            leadName: matchedLead?.full_name || leadNameHint || null,
            leadPhone: matchedLead?.phone || providerLinkedThread?.phone_e164 || phoneE164,
          };
        })();

  const resolvedPhoneE164 =
    normalizeEsPhone(
      direction === "outbound"
        ? pickFirstString(resolvedLead.leadPhone, providerLinkedThread?.phone_e164, phoneE164)
        : pickFirstString(phoneE164, resolvedLead.leadPhone, providerLinkedThread?.phone_e164)
    ) || phoneE164;

  const { data: existingThread } = providerLinkedThread?.id
    ? { data: providerLinkedThread }
    : await supabase
        .from("wa_threads")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("phone_e164", resolvedPhoneE164)
        .maybeSingle();

  const threadPayload = {
    clinic_id: clinicId,
    lead_id: resolvedLead.leadId || providerLinkedThread?.lead_id || existingThread?.lead_id || null,
    phone_e164: resolvedPhoneE164,
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
  const existingMessageConflicts = providerLinkedMessage
    ? providerLinkedMessage.thread_id !== thread.id ||
      providerLinkedMessage.direction !== direction ||
      providerLinkedMessage.role !== role ||
      normalizeWhatsappMessageText(providerLinkedMessage.text) !== normalizeWhatsappMessageText(text)
    : false;

  const metadataBase = payloadRecord.metadata && typeof payloadRecord.metadata === "object" ? sanitizeWhatsappJson(payloadRecord.metadata) : {};
  const metadataRecord = (metadataBase && typeof metadataBase === "object" && !Array.isArray(metadataBase)
    ? (metadataBase as Record<string, Json>)
    : {}) as Record<string, Json>;
  const metadata = sanitizeWhatsappJson({
    ...metadataRecord,
    channel: pickFirstString(metadataRecord.channel, getNestedValue(providerRecord, ["channel"]), "whatsapp"),
    provider: pickFirstString(metadataRecord.provider, getNestedValue(providerRecord, ["provider"])),
    message_type: pickFirstString(
      metadataRecord.message_type,
      payloadRecord.message_type,
      getNestedValue(providerRecord, ["type"])
    ),
    from: pickFirstString(metadataRecord.from, payloadRecord.from, getNestedValue(providerRecord, ["from"])),
    to: pickFirstString(metadataRecord.to, payloadRecord.to, getNestedValue(providerRecord, ["to"])),
    raw_provider_message_id: existingMessageConflicts ? providerMessageId : metadataRecord.raw_provider_message_id,
    provider_message_conflict: existingMessageConflicts || metadataRecord.provider_message_conflict === true,
  });

  const persistedProviderMessageId =
    existingMessageConflicts && providerMessageId
      ? `${providerMessageId}::${direction}::${Date.now()}`
      : providerMessageId;

  const messagePayload = {
    thread_id: thread.id,
    clinic_id: clinicId,
    lead_id: resolvedLead.leadId || thread.lead_id || null,
    provider_message_id: persistedProviderMessageId,
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

  const messageResult = persistedProviderMessageId && !existingMessageConflicts
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
