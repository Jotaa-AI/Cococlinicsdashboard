import type { Appointment, Call, Lead } from "@/lib/types";

export function normalizePhone(value?: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9) return `+34${digits}`;
  if (digits.startsWith("34") && digits.length === 11) return `+${digits}`;
  return value.startsWith("+") ? value : `+${digits}`;
}

export function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function getReferenceTimestamp(...dates: Array<string | null | undefined>) {
  for (const value of dates) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

export function inRange(timestamp: number | null, startMs: number, endMs: number) {
  return timestamp !== null && timestamp >= startMs && timestamp < endMs;
}

export function getLeadKeyFromLead(lead: Pick<Lead, "id" | "phone">) {
  if (lead.id) return `lead:${lead.id}`;
  const phone = normalizePhone(lead.phone);
  return phone ? `phone:${phone}` : null;
}

export function getLeadKeyFromCall(call: Pick<Call, "lead_id" | "phone">) {
  if (call.lead_id) return `lead:${call.lead_id}`;
  const phone = normalizePhone(call.phone);
  return phone ? `phone:${phone}` : null;
}

export function getLeadKeyFromAppointment(
  appointment: Pick<Appointment, "lead_id" | "lead_phone"> & { lead_phone?: string | null }
) {
  if (appointment.lead_id) return `lead:${appointment.lead_id}`;
  const phone = normalizePhone(appointment.lead_phone);
  return phone ? `phone:${phone}` : null;
}

export function isInternalBlock(appointment: Partial<Appointment> & { entry_type?: string | null }) {
  return appointment.entry_type === "internal_block";
}

export function isAiAppointment(appointment: Partial<Appointment> & { entry_type?: string | null }) {
  return !isInternalBlock(appointment) && appointment.source_channel === "call_ai";
}

export function isScheduledAiAppointment(appointment: Partial<Appointment> & { entry_type?: string | null }) {
  return isAiAppointment(appointment) && appointment.status === "scheduled";
}

export function getLeadClosedTimestamp(lead: Partial<Lead>) {
  if (lead.converted_to_client && lead.converted_at) return lead.converted_at;
  if (lead.stage_key === "client_closed") return lead.updated_at || lead.converted_at || null;
  return null;
}

export function isLeadClosed(lead: Partial<Lead>) {
  return Boolean(lead.converted_to_client || lead.stage_key === "client_closed");
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
