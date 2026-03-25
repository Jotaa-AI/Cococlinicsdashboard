import type { Json, WaMessage } from "@/lib/types";

function stripN8nExpressionPrefix(value: string) {
  if (!value.startsWith("=") || value.startsWith("==")) return value;
  return value.slice(1).trimStart();
}

export function sanitizeIncomingWhatsappString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const sanitized = stripN8nExpressionPrefix(trimmed).trim();
  return sanitized || null;
}

export function sanitizeWhatsappText(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return stripN8nExpressionPrefix(trimmed);
}

export function sanitizeWhatsappJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return sanitizeIncomingWhatsappString(value) || "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeWhatsappJson(entry));
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      sanitizeWhatsappJson(entryValue),
    ]);
    return Object.fromEntries(entries) as Json;
  }
  return null;
}

export function normalizeWhatsappMessageText(text?: string | null) {
  return sanitizeWhatsappText(text).replace(/\s+/g, " ").trim().toLowerCase();
}

export function sanitizeWaMessageForDisplay(message: WaMessage): WaMessage {
  return {
    ...message,
    text: sanitizeWhatsappText(message.text),
    provider_message_id: sanitizeIncomingWhatsappString(message.provider_message_id),
    metadata: sanitizeWhatsappJson(message.metadata),
  };
}

export function sanitizeWhatsappPreviewText(text?: string | null) {
  return sanitizeWhatsappText(text);
}
