"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Building2,
  CalendarDays,
  LayoutList,
  Link as LinkIcon,
  MessageSquareText,
  NotebookPen,
  Phone,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Appointment, Call, Json, Lead, LeadNextAction, LeadNote, WaMessage, WaThread } from "@/lib/types";
import { CLINIC_TIMEZONE, formatClinicDate, formatClinicDateTime, formatClinicTime } from "@/lib/datetime/clinicTime";
import { normalizeEsPhone } from "@/lib/leads/resolveLead";
import { cn } from "@/lib/utils/cn";

type ManagedByFilter = "all" | "humano" | "IA" | "unassigned";
type NextActionType = LeadNextAction["action_type"];

interface StageOption {
  stage_key: string;
  label_es: string;
  pipeline_label_es: string | null;
  pipeline_order: number;
  order_index: number;
  is_active: boolean;
}

interface TimelineItem {
  id: string;
  type: "note" | "appointment" | "call" | "next_action";
  title: string;
  body: string;
  meta: string;
  created_at: string;
}

interface DaySeparatorItem {
  kind: "separator";
  key: string;
  label: string;
}

interface ChatMessageItem {
  kind: "message";
  message: WaMessage;
}

type ChatItem = DaySeparatorItem | ChatMessageItem;

const REQUIRED_LEAD_FIELDS = [
  "id",
  "clinic_id",
  "full_name",
  "phone",
  "treatment",
  "source",
  "status",
  "created_at",
  "updated_at",
] as const;

const OPTIONAL_LEAD_FIELDS = [
  "managed_by",
  "owner_user_id",
  "intents",
  "converted_to_client",
  "converted_value_eur",
  "converted_service_name",
  "converted_at",
  "post_visit_outcome_reason",
  "contacto_futuro",
  "whatsapp_blocked",
  "whatsapp_blocked_reason",
  "whatsapp_blocked_at",
  "whatsapp_blocked_by_user_id",
  "first_call_answered",
  "second_call_answered",
  "whatsapp_handoff_needed",
  "has_scheduled_appointment",
  "stage_key",
  "ab_variant",
  "last_contact_at",
  "next_action_at",
] as const;

const FULL_LEAD_SELECT_FIELDS = [...REQUIRED_LEAD_FIELDS, ...OPTIONAL_LEAD_FIELDS];

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return formatClinicDateTime(value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(seconds?: number | null) {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)} min`;
}

function formatListTimestamp(value?: string | null) {
  if (!value) return "Sin actividad";
  return formatClinicDateTime(value, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function managedByLabel(value?: Lead["managed_by"] | null) {
  if (value === "humano") return "Clínica";
  if (value === "IA") return "IA";
  return "Sin asignar";
}

function stageBadgeVariant(stageKey?: string | null) {
  if (!stageKey) return "default" as const;
  if (stageKey === "client_closed") return "success" as const;
  if (stageKey === "visit_no_show" || stageKey === "post_visit_not_closed") return "danger" as const;
  if (stageKey === "visit_scheduled" || stageKey === "post_visit_follow_up") return "warning" as const;
  return "soft" as const;
}

function managedByBadgeVariant(value?: Lead["managed_by"] | null) {
  if (value === "humano") return "warning" as const;
  if (value === "IA") return "success" as const;
  return "default" as const;
}

function appointmentStatusLabel(status: Appointment["status"]) {
  if (status === "scheduled") return "programada";
  if (status === "done") return "realizada";
  if (status === "no_show") return "no-show";
  return "cancelada";
}

function extractMissingColumn(message?: string | null) {
  if (!message) return null;
  const quotedMatch = message.match(/'([^']+)' column/);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const relationMatch = message.match(/column \"([^\"]+)\" of relation/);
  if (relationMatch?.[1]) return relationMatch[1];
  const schemaMatch = message.match(/column (?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+) does not exist/);
  if (schemaMatch?.[1]) return schemaMatch[1];
  const simpleMatch = message.match(/column \"?([a-zA-Z0-9_]+)\"? does not exist/);
  if (simpleMatch?.[1]) return simpleMatch[1];
  return null;
}

function isMissingSchemaResource(message?: string | null) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("schema cache") ||
    normalized.includes("does not exist") ||
    normalized.includes("could not find the table")
  );
}

function ensureLeadShape(record: Partial<Lead>): Lead {
  const createdAt =
    typeof record.created_at === "string" && record.created_at
      ? record.created_at
      : new Date().toISOString();

  return {
    id: typeof record.id === "string" ? record.id : "",
    clinic_id: typeof record.clinic_id === "string" ? record.clinic_id : "",
    full_name: typeof record.full_name === "string" ? record.full_name : null,
    phone: typeof record.phone === "string" ? record.phone : null,
    treatment: typeof record.treatment === "string" ? record.treatment : null,
    source: typeof record.source === "string" ? record.source : null,
    managed_by: record.managed_by === "humano" || record.managed_by === "IA" ? record.managed_by : null,
    owner_user_id: typeof record.owner_user_id === "string" ? record.owner_user_id : null,
    status: typeof record.status === "string" && record.status ? record.status : "new",
    intents: record.intents === "1" || record.intents === "2" ? record.intents : null,
    converted_to_client: Boolean(record.converted_to_client),
    converted_value_eur: record.converted_value_eur ?? null,
    converted_service_name:
      typeof record.converted_service_name === "string" ? record.converted_service_name : null,
    converted_at: typeof record.converted_at === "string" ? record.converted_at : null,
    post_visit_outcome_reason:
      typeof record.post_visit_outcome_reason === "string" ? record.post_visit_outcome_reason : null,
    contacto_futuro: typeof record.contacto_futuro === "string" ? record.contacto_futuro : null,
    whatsapp_blocked: Boolean(record.whatsapp_blocked),
    whatsapp_blocked_reason:
      typeof record.whatsapp_blocked_reason === "string" ? record.whatsapp_blocked_reason : null,
    whatsapp_blocked_at: typeof record.whatsapp_blocked_at === "string" ? record.whatsapp_blocked_at : null,
    whatsapp_blocked_by_user_id:
      typeof record.whatsapp_blocked_by_user_id === "string" ? record.whatsapp_blocked_by_user_id : null,
    first_call_answered:
      typeof record.first_call_answered === "boolean" ? record.first_call_answered : null,
    second_call_answered:
      typeof record.second_call_answered === "boolean" ? record.second_call_answered : null,
    whatsapp_handoff_needed: Boolean(record.whatsapp_handoff_needed),
    has_scheduled_appointment: Boolean(record.has_scheduled_appointment),
    stage_key: typeof record.stage_key === "string" ? record.stage_key : null,
    ab_variant: record.ab_variant === "A" || record.ab_variant === "B" ? record.ab_variant : null,
    last_contact_at: typeof record.last_contact_at === "string" ? record.last_contact_at : null,
    next_action_at: typeof record.next_action_at === "string" ? record.next_action_at : null,
    created_at: createdAt,
    updated_at:
      typeof record.updated_at === "string" && record.updated_at ? record.updated_at : createdAt,
  };
}

function inferManagedByFromConversation(lead: Lead, threads: WaThread[]) {
  const normalizedLeadPhone = normalizeEsPhone(lead.phone) || lead.phone || null;
  const relatedThreads = threads.filter((thread) => {
    if (thread.lead_id && thread.lead_id === lead.id) return true;
    if (!normalizedLeadPhone) return false;
    return thread.phone_e164 === normalizedLeadPhone;
  });

  if (lead.whatsapp_blocked || relatedThreads.some((thread) => thread.hitl_active)) {
    return "humano" as const;
  }

  if (relatedThreads.length > 0) {
    return "IA" as const;
  }

  return lead.managed_by;
}

function getRelatedThreadsForLead(lead: Pick<Lead, "id" | "phone">, threads: WaThread[]) {
  const normalizedLeadPhone = normalizeEsPhone(lead.phone) || lead.phone || null;
  return threads.filter((thread) => {
    if (thread.lead_id && thread.lead_id === lead.id) return true;
    if (!normalizedLeadPhone) return false;
    return thread.phone_e164 === normalizedLeadPhone;
  });
}

function getLastWhatsappActivityForLead(lead: Pick<Lead, "id" | "phone">, threads: WaThread[]) {
  const relatedThreads = getRelatedThreadsForLead(lead, threads);
  const timestamps = relatedThreads
    .map((thread) => thread.updated_at || thread.created_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return timestamps[0] || null;
}

async function updateLeadWithCompat(supabase: ReturnType<typeof createSupabaseBrowserClient>, leadId: string, payload: Record<string, unknown>) {
  const sanitizedPayload = { ...payload };

  for (let attempt = 0; attempt < OPTIONAL_LEAD_FIELDS.length + 2; attempt++) {
    const { data, error } = await supabase
      .from("leads")
      .update(sanitizedPayload)
      .eq("id", leadId)
      .select("*")
      .single();

    if (!error && data) {
      return { data: ensureLeadShape(data as Partial<Lead>), error: null };
    }

    const missingColumn = extractMissingColumn(error?.message);
    if (!missingColumn || !(missingColumn in sanitizedPayload)) {
      return { data: null, error };
    }

    delete sanitizedPayload[missingColumn as keyof typeof sanitizedPayload];
  }

  return {
    data: null,
    error: { message: "No se pudieron guardar los cambios del lead por incompatibilidad de esquema." },
  };
}

function nextActionLabel(actionType?: NextActionType | null) {
  switch (actionType) {
    case "retry_call":
      return "Reintentar llamada";
    case "start_whatsapp_ai":
      return "Activar WhatsApp IA";
    case "notify_team":
      return "Seguimiento del equipo";
    default:
      return "Sin acción";
  }
}

function nextActionVariant(actionType?: NextActionType | null) {
  switch (actionType) {
    case "retry_call":
      return "warning" as const;
    case "start_whatsapp_ai":
      return "success" as const;
    case "notify_team":
      return "soft" as const;
    default:
      return "default" as const;
  }
}

function getPayloadNote(payload: Json | null | undefined) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const value = payload.note;
  return typeof value === "string" ? value : "";
}

function getMessageChronologyRank(message: WaMessage) {
  if (message.direction === "inbound" && message.role === "human") return 0;
  if (message.direction === "outbound" && message.role === "human") return 1;
  if (message.direction === "outbound" && message.role === "assistant") return 2;
  if (message.role === "system") return 3;
  return 4;
}

function normalizeMessageText(text?: string | null) {
  return text?.replace(/\s+/g, " ").trim().toLowerCase() || "";
}

function sortConversationMessages(messages: WaMessage[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aTs = new Date(a.message.created_at).getTime();
      const bTs = new Date(b.message.created_at).getTime();
      if (aTs !== bTs) return aTs - bTs;

      const aRank = getMessageChronologyRank(a.message);
      const bRank = getMessageChronologyRank(b.message);
      if (aRank !== bRank) return aRank - bRank;

      return a.index - b.index;
    })
    .map(({ message }) => message);
}

function sanitizeConversationMessages(messages: WaMessage[]) {
  const ordered = sortConversationMessages(messages);
  const kept: WaMessage[] = [];

  for (const message of ordered) {
    const messageTs = new Date(message.created_at).getTime();
    const normalizedText = normalizeMessageText(message.text);

    const isEchoOfInbound =
      message.direction === "outbound" &&
      message.role === "assistant" &&
      normalizedText &&
      kept.some((previous) => {
        if (previous.direction !== "inbound" || previous.role !== "human") return false;
        if (normalizeMessageText(previous.text) !== normalizedText) return false;
        const previousTs = new Date(previous.created_at).getTime();
        return Math.abs(messageTs - previousTs) <= 2000;
      });

    if (isEchoOfInbound) continue;
    kept.push(message);
  }

  return kept;
}

function getDayKey(value?: string | null) {
  if (!value) return "sin-fecha";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}

function formatDayLabel(value?: string | null) {
  if (!value) return "Sin fecha";
  return formatClinicDate(value, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function buildChatItems(messages: WaMessage[]) {
  const items: ChatItem[] = [];
  let currentDayKey: string | null = null;

  for (const message of messages) {
    const dayKey = getDayKey(message.created_at);
    if (dayKey !== currentDayKey) {
      currentDayKey = dayKey;
      items.push({
        kind: "separator",
        key: `${dayKey}-${message.id}`,
        label: formatDayLabel(message.created_at),
      });
    }

    items.push({ kind: "message", message });
  }

  return items;
}

function getParticipantLabel(message: WaMessage) {
  if (message.role === "assistant") return "Agente IA";
  if (message.role === "system") return "Sistema";
  return message.direction === "inbound" ? "Lead" : "Equipo";
}

function toDatetimeLocalInput(value?: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function parseDatetimeLocalInput(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white px-4 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/70 py-3 last:border-b-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="max-w-[60%] text-right text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

export function CrmWorkspace() {
  const supabase = createSupabaseBrowserClient();
  const { profile, loading: profileLoading } = useProfile();
  const clinicId = profile?.clinic_id;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [stageOptions, setStageOptions] = useState<StageOption[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [nextActions, setNextActions] = useState<LeadNextAction[]>([]);
  const [waThreads, setWaThreads] = useState<WaThread[]>([]);
  const [waMessages, setWaMessages] = useState<WaMessage[]>([]);
  const [search, setSearch] = useState("");
  const [managedByFilter, setManagedByFilter] = useState<ManagedByFilter>("all");
  const [stageDraft, setStageDraft] = useState<string>("");
  const [noteDraft, setNoteDraft] = useState("");
  const [nextActionTypeDraft, setNextActionTypeDraft] = useState<NextActionType>("notify_team");
  const [nextActionDueDraft, setNextActionDueDraft] = useState("");
  const [nextActionNoteDraft, setNextActionNoteDraft] = useState("");
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [savingLead, setSavingLead] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingNextAction, setSavingNextAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notesAvailable, setNotesAvailable] = useState(true);
  const [nextActionsAvailable, setNextActionsAvailable] = useState(true);

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  const primaryNextAction = useMemo(
    () =>
      [...nextActions]
        .filter((action) => action.status === "pending" || action.status === "running")
        .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0] || null,
    [nextActions]
  );

  const stageLabelMap = useMemo(
    () => new Map(stageOptions.map((stage) => [stage.stage_key, stage.label_es])),
    [stageOptions]
  );

  const selectedManagedByLabel = useMemo(
    () => (selectedLead ? managedByLabel(selectedLead.managed_by) : "Sin asignar"),
    [selectedLead]
  );

  const selectedLastWhatsappMessageAt = useMemo(
    () => waMessages[waMessages.length - 1]?.created_at || null,
    [waMessages]
  );

  const loadLeads = useCallback(async () => {
    if (!clinicId) return;
    setLoadingLeads(true);
    setError(null);

    const fetchAllLeads = async () => {
      const pageSize = 1000;
      let selectFields: string[] = [...FULL_LEAD_SELECT_FIELDS];

      for (let attempt = 0; attempt < OPTIONAL_LEAD_FIELDS.length + 2; attempt++) {
        let from = 0;
        let hasMore = true;
        let retryWithFewerFields = false;
        const collected: Lead[] = [];

        while (hasMore) {
          const { data, error } = await supabase
            .from("leads")
            .select(selectFields.join(", "))
            .eq("clinic_id", clinicId)
            .order("updated_at", { ascending: false })
            .range(from, from + pageSize - 1);

          if (error) {
            const missingColumn = extractMissingColumn(error.message);
            if (missingColumn && selectFields.includes(missingColumn)) {
              selectFields = selectFields.filter((field) => field !== missingColumn);
              retryWithFewerFields = true;
              break;
            }

            return { data: null as Lead[] | null, error };
          }

          const chunk = ((data || []) as Partial<Lead>[]).map(ensureLeadShape);
          collected.push(...chunk);

          if (chunk.length < pageSize) {
            hasMore = false;
          } else {
            from += pageSize;
          }
        }

        if (!retryWithFewerFields) {
          const removedAnyOptional = FULL_LEAD_SELECT_FIELDS.length !== selectFields.length;
          return { data: collected, error: null, removedAnyOptional };
        }
      }

      return {
        data: null as Lead[] | null,
        error: { message: "No se pudieron cargar los leads por incompatibilidad de esquema." },
      };
    };

    const [leadsResult, stagesResult, threadsResult] = await Promise.all([
      fetchAllLeads(),
      supabase
        .from("lead_stage_catalog")
        .select("stage_key, label_es, pipeline_label_es, pipeline_order, order_index, is_active")
        .eq("is_active", true)
        .order("pipeline_order", { ascending: true })
        .order("order_index", { ascending: true }),
      supabase
        .from("wa_threads")
        .select("id, clinic_id, lead_id, phone_e164, state, last_outbound_message_id, hitl_active, updated_at, created_at")
        .eq("clinic_id", clinicId),
    ]);

    if (leadsResult.error || stagesResult.error) {
      setError(
        leadsResult.error?.message ||
          stagesResult.error?.message ||
          "No se pudieron cargar los datos del apartado de Clientes."
      );
      setLoadingLeads(false);
      return;
    }

    const threadList = threadsResult.error ? [] : ((threadsResult.data || []) as WaThread[]);
    const nextLeads = ((leadsResult.data || []) as Lead[]).map((lead) => ({
      ...lead,
      managed_by: inferManagedByFromConversation(lead, threadList),
      last_contact_at: getLastWhatsappActivityForLead(lead, threadList) || lead.last_contact_at,
    }));

    setLeads(nextLeads);
    setStageOptions((stagesResult.data || []) as StageOption[]);
    setSelectedLeadId((current) => current || nextLeads[0]?.id || null);
    setLoadingLeads(false);
  }, [clinicId, supabase]);

  const loadLeadDetails = useCallback(
    async (lead: Lead | null) => {
      if (!clinicId || !lead) {
        setAppointments([]);
        setCalls([]);
        setNotes([]);
        setNextActions([]);
        setWaThreads([]);
        setWaMessages([]);
        return;
      }

      setLoadingDetails(true);
      setError(null);

      const [appointmentsResult, callsResult, notesResult, nextActionsResult, threadsByLeadResult, threadsByPhoneResult] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .eq("clinic_id", clinicId)
          .eq("lead_id", lead.id)
          .order("start_at", { ascending: false })
          .limit(20),
        supabase
          .from("calls")
          .select("*")
          .eq("clinic_id", clinicId)
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("lead_notes")
          .select("*")
          .eq("clinic_id", clinicId)
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("lead_next_actions")
          .select("*")
          .eq("clinic_id", clinicId)
          .eq("lead_id", lead.id)
          .order("due_at", { ascending: true })
          .limit(20),
        supabase
          .from("wa_threads")
          .select("*")
          .eq("clinic_id", clinicId)
          .eq("lead_id", lead.id)
          .order("updated_at", { ascending: false }),
        lead.phone
          ? supabase
              .from("wa_threads")
              .select("*")
              .eq("clinic_id", clinicId)
              .eq("phone_e164", normalizeEsPhone(lead.phone) || lead.phone)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [] as WaThread[], error: null }),
      ]);

      if (
        appointmentsResult.error ||
        callsResult.error ||
        threadsByLeadResult.error ||
        threadsByPhoneResult.error
      ) {
        setError(
          appointmentsResult.error?.message ||
            callsResult.error?.message ||
            threadsByLeadResult.error?.message ||
            threadsByPhoneResult.error?.message ||
            "No se pudieron cargar los detalles del lead."
        );
        setLoadingDetails(false);
        return;
      }

      const notesTableMissing = Boolean(notesResult.error && isMissingSchemaResource(notesResult.error.message));
      const nextActionsTableMissing = Boolean(
        nextActionsResult.error && isMissingSchemaResource(nextActionsResult.error.message)
      );

      if (notesResult.error && !notesTableMissing) {
        setError(notesResult.error.message || "No se pudieron cargar las notas del lead.");
        setLoadingDetails(false);
        return;
      }

      if (nextActionsResult.error && !nextActionsTableMissing) {
        setError(nextActionsResult.error.message || "No se pudo cargar la próxima acción del lead.");
        setLoadingDetails(false);
        return;
      }

      const mergedThreads = new Map<string, WaThread>();
      for (const thread of [...((threadsByLeadResult.data || []) as WaThread[]), ...((threadsByPhoneResult.data || []) as WaThread[])]) {
        mergedThreads.set(thread.id, thread);
      }
      const nextThreads = [...mergedThreads.values()].sort(
        (a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
      );

      let messagesResultData: WaMessage[] = [];
      if (nextThreads.length) {
        const { data: waMessagesResult, error: waMessagesError } = await supabase
          .from("wa_messages")
          .select("*")
          .eq("clinic_id", clinicId)
          .in("thread_id", nextThreads.map((thread) => thread.id))
          .order("created_at", { ascending: true })
          .limit(250);

        if (waMessagesError) {
          setError(waMessagesError.message || "No se pudieron cargar los mensajes de WhatsApp.");
          setLoadingDetails(false);
          return;
        }

        messagesResultData = sanitizeConversationMessages((waMessagesResult || []) as WaMessage[]);
      }

      setAppointments((appointmentsResult.data || []) as Appointment[]);
      setCalls((callsResult.data || []) as Call[]);
      setNotes(notesTableMissing ? [] : ((notesResult.data || []) as LeadNote[]));
      setNextActions(nextActionsTableMissing ? [] : ((nextActionsResult.data || []) as LeadNextAction[]));
      setWaThreads(nextThreads);
      setWaMessages(messagesResultData);
      setNotesAvailable(!notesTableMissing);
      setNextActionsAvailable(!nextActionsTableMissing);

      if (notesTableMissing || nextActionsTableMissing) {
        setError(null);
      }
      setLoadingDetails(false);
    },
    [clinicId, supabase]
  );

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    if (!selectedLead) return;
    setStageDraft(selectedLead.stage_key || "");
    loadLeadDetails(selectedLead);
  }, [loadLeadDetails, selectedLead]);

  useEffect(() => {
    if (primaryNextAction) {
      setNextActionTypeDraft(primaryNextAction.action_type);
      setNextActionDueDraft(toDatetimeLocalInput(primaryNextAction.due_at));
      setNextActionNoteDraft(getPayloadNote(primaryNextAction.payload));
      return;
    }

    if (selectedLead) {
      setNextActionTypeDraft("notify_team");
      setNextActionDueDraft(toDatetimeLocalInput(selectedLead.next_action_at));
      setNextActionNoteDraft("");
    }
  }, [primaryNextAction, selectedLead]);

  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase();

    return leads.filter((lead) => {
      if (managedByFilter === "humano" && lead.managed_by !== "humano") return false;
      if (managedByFilter === "IA" && lead.managed_by !== "IA") return false;
      if (managedByFilter === "unassigned" && lead.managed_by) return false;

      if (!query) return true;

      const haystack = [
        lead.full_name,
        lead.phone,
        lead.treatment,
        stageLabelMap.get(lead.stage_key || ""),
        lead.source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [leads, managedByFilter, search, stageLabelMap]);

  useEffect(() => {
    if (!filteredLeads.length) {
      setSelectedLeadId(null);
      return;
    }

    if (!selectedLeadId || !filteredLeads.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(filteredLeads[0].id);
    }
  }, [filteredLeads, selectedLeadId]);

  const saveLead = async () => {
    if (!selectedLead) return;
    setSavingLead(true);
    setError(null);
    setSuccess(null);

    const payload = {
      stage_key: stageDraft || selectedLead.stage_key,
      updated_at: new Date().toISOString(),
    };

    const { data, error: updateError } = await updateLeadWithCompat(supabase, selectedLead.id, payload);

    if (updateError || !data) {
      setError(updateError?.message || "No se pudieron guardar los cambios del lead.");
      setSavingLead(false);
      return;
    }

    const enrichedLead = {
      ...data,
      managed_by: inferManagedByFromConversation(data, waThreads),
    };

    setLeads((current) => current.map((lead) => (lead.id === selectedLead.id ? enrichedLead : lead)));
    setSuccess("Lead actualizado correctamente.");
    setSavingLead(false);
  };

  const addNote = async () => {
    if (!selectedLead || !clinicId) return;
    if (!notesAvailable) {
      setError("Las notas internas aún no están disponibles en producción. Falta crear la tabla lead_notes en Supabase.");
      return;
    }
    const trimmed = noteDraft.trim();
    if (!trimmed) return;

    setSavingNote(true);
    setError(null);
    setSuccess(null);

    const { data, error: insertError } = await supabase
      .from("lead_notes")
      .insert({
        clinic_id: clinicId,
        lead_id: selectedLead.id,
        body: trimmed,
        created_by_user_id: profile?.user_id || null,
        created_by_name: profile?.full_name || "Equipo clínica",
      })
      .select("*")
      .single();

    if (insertError || !data) {
      setError(insertError?.message || "No se pudo guardar la nota.");
      setSavingNote(false);
      return;
    }

    setNotes((current) => [data as LeadNote, ...current]);
    setNoteDraft("");
    setSuccess("Nota guardada.");
    setSavingNote(false);
  };

  const saveNextAction = async () => {
    if (!selectedLead || !clinicId) return;
    if (!nextActionsAvailable) {
      setError("La próxima acción aún no está disponible en producción. Falta crear la tabla lead_next_actions en Supabase.");
      return;
    }
    const dueAtIso = parseDatetimeLocalInput(nextActionDueDraft);
    if (!dueAtIso) {
      setError("Necesitas indicar fecha y hora para la próxima acción.");
      return;
    }

    setSavingNextAction(true);
    setError(null);
    setSuccess(null);

    const payload = {
      note: nextActionNoteDraft.trim() || null,
      source: "crm_manual",
    };

    const existingAction = primaryNextAction;
    const query = existingAction
      ? supabase
          .from("lead_next_actions")
          .update({
            action_type: nextActionTypeDraft,
            due_at: dueAtIso,
            status: "pending",
            payload,
            processed_at: null,
          })
          .eq("id", existingAction.id)
          .select("*")
          .single()
      : supabase
          .from("lead_next_actions")
          .insert({
            clinic_id: clinicId,
            lead_id: selectedLead.id,
            action_type: nextActionTypeDraft,
            due_at: dueAtIso,
            status: "pending",
            payload,
            idempotency_key: `crm-${selectedLead.id}-${Date.now()}`,
          })
          .select("*")
          .single();

    const [actionResult, leadResult] = await Promise.all([
      query,
      supabase
        .from("leads")
        .update({ next_action_at: dueAtIso, updated_at: new Date().toISOString() })
        .eq("id", selectedLead.id)
        .select("*")
        .single(),
    ]);

    if (actionResult.error || !actionResult.data || leadResult.error || !leadResult.data) {
      setError(actionResult.error?.message || leadResult.error?.message || "No se pudo guardar la próxima acción.");
      setSavingNextAction(false);
      return;
    }

    setNextActions((current) => {
      const updated = current.filter((action) => action.id !== actionResult.data.id);
      return [actionResult.data as LeadNextAction, ...updated].sort(
        (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
      );
    });
    const refreshedLead = {
      ...ensureLeadShape(leadResult.data as Partial<Lead>),
      managed_by: inferManagedByFromConversation(ensureLeadShape(leadResult.data as Partial<Lead>), waThreads),
    };
    setLeads((current) => current.map((lead) => (lead.id === selectedLead.id ? refreshedLead : lead)));
    setSuccess("Próxima acción guardada.");
    setSavingNextAction(false);
  };

  const clearNextAction = async () => {
    if (!selectedLead || !clinicId) return;
    if (!nextActionsAvailable) {
      setError("La próxima acción aún no está disponible en producción. Falta crear la tabla lead_next_actions en Supabase.");
      return;
    }
    setSavingNextAction(true);
    setError(null);
    setSuccess(null);

    const [actionsResult, leadResult] = await Promise.all([
      supabase
        .from("lead_next_actions")
        .update({ status: "canceled", processed_at: new Date().toISOString() })
        .eq("clinic_id", clinicId)
        .eq("lead_id", selectedLead.id)
        .in("status", ["pending", "running"]),
      supabase
        .from("leads")
        .update({ next_action_at: null, updated_at: new Date().toISOString() })
        .eq("id", selectedLead.id)
        .select("*")
        .single(),
    ]);

    if (actionsResult.error || leadResult.error || !leadResult.data) {
      setError(actionsResult.error?.message || leadResult.error?.message || "No se pudo limpiar la próxima acción.");
      setSavingNextAction(false);
      return;
    }

    setNextActions([]);
    setNextActionDueDraft("");
    setNextActionNoteDraft("");
    const refreshedLead = {
      ...ensureLeadShape(leadResult.data as Partial<Lead>),
      managed_by: inferManagedByFromConversation(ensureLeadShape(leadResult.data as Partial<Lead>), waThreads),
    };
    setLeads((current) => current.map((lead) => (lead.id === selectedLead.id ? refreshedLead : lead)));
    setSuccess("Próxima acción eliminada.");
    setSavingNextAction(false);
  };

  const timeline = useMemo<TimelineItem[]>(() => {
    const noteItems: TimelineItem[] = notes.map((note) => ({
      id: `note-${note.id}`,
      type: "note",
      title: note.created_by_name ? `Nota de ${note.created_by_name}` : "Nota manual",
      body: note.body,
      meta: formatDateTime(note.created_at),
      created_at: note.created_at,
    }));

  const appointmentItems: TimelineItem[] = appointments.map((appointment) => ({
      id: `appointment-${appointment.id}`,
      type: "appointment",
      title: appointment.title || "Cita",
      body: `${
        appointment.status === "scheduled"
          ? "Cita programada"
          : appointment.status === "done"
            ? "Cita realizada"
            : appointment.status === "no_show"
              ? "Lead no asistió a la cita"
              : "Cita cancelada"
      } · ${formatDateTime(appointment.start_at)}`,
      meta: `${appointment.source_channel || "sin canal"} · ${appointmentStatusLabel(appointment.status)}`,
      created_at: appointment.created_at || appointment.start_at,
    }));

    const callItems: TimelineItem[] = calls.map((call) => ({
      id: `call-${call.id}`,
      type: "call",
      title: "Llamada",
      body: `${call.outcome || "Sin outcome"} · Duración ${formatDuration(call.duration_sec)}`,
      meta: formatDateTime(call.ended_at || call.started_at || call.created_at),
      created_at: call.ended_at || call.started_at || call.created_at,
    }));

    const actionItems: TimelineItem[] = nextActions.map((action) => ({
      id: `action-${action.id}`,
      type: "next_action",
      title: `Próxima acción · ${nextActionLabel(action.action_type)}`,
      body: getPayloadNote(action.payload) || "Sin nota adicional.",
      meta: `${action.status} · ${formatDateTime(action.due_at)}`,
      created_at: action.created_at,
    }));

    return [...noteItems, ...appointmentItems, ...callItems, ...actionItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [appointments, calls, nextActions, notes]);

  const chatItems = useMemo(() => buildChatItems(waMessages), [waMessages]);

  const activeStageOptions = useMemo(() => {
    if (!selectedLead?.stage_key) return stageOptions;
    if (stageOptions.some((stage) => stage.stage_key === selectedLead.stage_key)) return stageOptions;
    return [
      ...stageOptions,
      {
        stage_key: selectedLead.stage_key,
        label_es: selectedLead.stage_key,
        pipeline_label_es: "Legacy",
        pipeline_order: 999,
        order_index: 999,
        is_active: true,
      },
    ];
  }, [selectedLead?.stage_key, stageOptions]);

  const availabilityNotices = useMemo(() => {
    const notices: string[] = [];
    if (!notesAvailable) {
      notices.push("Las notas internas todavía no están habilitadas en esta base de datos. Falta la tabla lead_notes.");
    }
    if (!nextActionsAvailable) {
      notices.push("La próxima acción todavía no está habilitada en esta base de datos. Falta la tabla lead_next_actions.");
    }
    return notices;
  }, [nextActionsAvailable, notesAvailable]);

  const leadCounts = useMemo(
    () => ({
      all: leads.length,
      humano: leads.filter((lead) => lead.managed_by === "humano").length,
      IA: leads.filter((lead) => lead.managed_by === "IA").length,
      unassigned: leads.filter((lead) => !lead.managed_by).length,
    }),
    [leads]
  );

  if (profileLoading) {
    return <div className="rounded-xl border border-border bg-white p-6 text-sm text-muted-foreground">Cargando Clientes...</div>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="space-y-4 border-b border-border bg-[linear-gradient(180deg,rgba(244,240,230,0.96),rgba(255,255,255,0.98))] px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">Vista de lista</p>
              <CardTitle className="text-2xl">Clientes activos</CardTitle>
              <p className="text-sm text-muted-foreground">
                Filtra, abre fichas y sigue cada lead como en una lista comercial de CRM.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-10 w-10 px-0" onClick={loadLeads} disabled={loadingLeads}>
              <RefreshCw className={cn("h-4 w-4", loadingLeads && "animate-spin")} />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Total</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{leadCounts.all}</p>
            </div>
            <div className="rounded-2xl border border-border bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500">
                <Building2 className="h-4 w-4" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">Clínica</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{leadCounts.humano}</p>
            </div>
            <div className="rounded-2xl border border-border bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500">
                <Bot className="h-4 w-4" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">IA</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{leadCounts.IA}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre, teléfono o tratamiento..."
                className="h-11 border-transparent bg-muted/40 pl-9 shadow-none focus-visible:border-border focus-visible:bg-white"
              />
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filtros de gestión
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  ["all", "Todos", leadCounts.all],
                  ["humano", "Clínica", leadCounts.humano],
                  ["IA", "IA", leadCounts.IA],
                  ["unassigned", "Sin asignar", leadCounts.unassigned],
                ] as const).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setManagedByFilter(value)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition",
                      managedByFilter === value
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-white text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    )}
                  >
                    <span>{label}</span>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      managedByFilter === value ? "bg-white/20 text-primary-foreground" : "bg-muted text-foreground"
                    )}>
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <LayoutList className="h-3.5 w-3.5" />
              <span>{filteredLeads.length} visibles</span>
            </div>
            <span>{leads.length} registros en base de datos</span>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          ) : null}
        </CardHeader>
        <CardContent className="max-h-[calc(100vh-14rem)] overflow-y-auto bg-[#fcfcfd] p-0">
          {filteredLeads.length ? (
            <div className="divide-y divide-border/80">
              {filteredLeads.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => setSelectedLeadId(lead.id)}
                  className={cn(
                    "group relative w-full px-4 py-4 text-left transition hover:bg-white",
                    selectedLeadId === lead.id && "border-l-4 border-l-primary bg-white pl-3"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border text-sm font-semibold shadow-sm",
                        selectedLeadId === lead.id
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-white text-slate-500"
                      )}
                    >
                      {(lead.full_name || lead.phone || "L").trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{lead.full_name || lead.phone || "Lead sin nombre"}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{lead.phone || "Sin teléfono"}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Últ. act.</p>
                          <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                            {formatListTimestamp(lead.last_contact_at || lead.updated_at || lead.created_at)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={stageBadgeVariant(lead.stage_key)}>
                          {stageLabelMap.get(lead.stage_key || "") || lead.stage_key || "Sin etapa"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{lead.source || "Sin origen"}</span>
                      </div>

                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {lead.treatment || "Sin tratamiento registrado"}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant={managedByBadgeVariant(lead.managed_by)}>{managedByLabel(lead.managed_by)}</Badge>
                        {lead.has_scheduled_appointment ? <Badge variant="warning">Cita activa</Badge> : null}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">No hay leads que coincidan con ese filtro.</div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {selectedLead ? (
          <>
            <Card className="overflow-hidden border-border/80 shadow-sm">
              <CardHeader className="border-b border-border bg-[linear-gradient(180deg,rgba(244,240,230,0.95),rgba(255,255,255,0.98))] px-6 py-5">
                <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">Ficha del lead</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-white text-muted-foreground shadow-sm">
                        <UserRound className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-semibold text-foreground">{selectedLead.full_name || "Lead sin nombre"}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {selectedLead.phone || "Sin teléfono"} · {selectedLead.treatment || "Sin tratamiento"} · {selectedLead.source || "Sin origen"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={managedByBadgeVariant(selectedLead.managed_by)}>{managedByLabel(selectedLead.managed_by)}</Badge>
                      <Badge variant={stageBadgeVariant(selectedLead.stage_key)}>
                        {stageLabelMap.get(selectedLead.stage_key || "") || selectedLead.stage_key || "Sin etapa"}
                      </Badge>
                      {selectedLead.whatsapp_blocked ? <Badge variant="danger">WhatsApp bloqueado</Badge> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => loadLeadDetails(selectedLead)} disabled={loadingDetails}>
                      <RefreshCw className={cn("mr-2 h-4 w-4", loadingDetails && "animate-spin")} />
                      Refrescar
                    </Button>
                    <Button type="button" onClick={saveLead} disabled={savingLead}>
                      <Save className="mr-2 h-4 w-4" />
                      {savingLead ? "Guardando..." : "Guardar cambios"}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-5 bg-[#fbfcfd] p-6">
                {(error || success || availabilityNotices.length) ? (
                  <div className="space-y-2">
                    {error ? (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                      </div>
                    ) : null}
                    {success ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {success}
                      </div>
                    ) : null}
                    {availabilityNotices.map((notice) => (
                      <div key={notice} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        {notice}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-5">
                  <MetricTile label="Creado" value={formatDateTime(selectedLead.created_at)} />
                  <MetricTile
                    label="Último contacto"
                    value={formatDateTime(selectedLastWhatsappMessageAt || selectedLead.last_contact_at)}
                  />
                  <MetricTile label="Próxima acción" value={formatDateTime(selectedLead.next_action_at)} />
                  <MetricTile label="Cita agendada" value={selectedLead.has_scheduled_appointment ? "Sí" : "No"} />
                  <MetricTile label="Gestión actual" value={selectedManagedByLabel} />
                </div>

                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_360px]">
                  <div className="space-y-4">
                    <Card className="border-border/80 shadow-none">
                      <CardHeader className="border-b border-border/80">
                        <CardTitle className="text-base">Resumen del lead</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                        <div className="rounded-2xl border border-border bg-white px-5 py-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Datos clave</p>
                          <div className="mt-3">
                            <InfoRow label="Teléfono" value={selectedLead.phone || "Sin teléfono"} />
                            <InfoRow label="Tratamiento" value={selectedLead.treatment || "Sin tratamiento"} />
                            <InfoRow label="Origen" value={selectedLead.source || "Sin origen"} />
                            <InfoRow
                              label="Estado comercial"
                              value={stageLabelMap.get(selectedLead.stage_key || "") || selectedLead.stage_key || "Sin etapa"}
                            />
                            <InfoRow
                              label="Cierre registrado"
                              value={
                                selectedLead.converted_to_client
                                  ? `${selectedLead.converted_service_name || "Servicio"} · ${selectedLead.converted_value_eur ?? 0} €`
                                  : selectedLead.post_visit_outcome_reason || "Aún no hay cierre registrado"
                              }
                            />
                          </div>
                        </div>

                        <div className="space-y-4 rounded-2xl border border-border bg-white px-5 py-4">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Gestión comercial</p>
                            <p className="mt-2 text-sm text-muted-foreground">
                              Aquí vemos quién está llevando la conversación y en qué etapa comercial está el lead.
                            </p>
                          </div>
                          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                            <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
                              <p className="text-sm font-medium text-foreground">Gestión actual</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Badge variant={managedByBadgeVariant(selectedLead.managed_by)}>
                                  {selectedManagedByLabel}
                                </Badge>
                                {selectedLead.whatsapp_blocked ? <Badge variant="warning">Humano - humano</Badge> : null}
                              </div>
                              <p className="mt-3 text-xs text-muted-foreground">
                                Este valor se deduce automáticamente según el estado real de la conversación de WhatsApp.
                              </p>
                            </div>
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-foreground">Etapa actual</p>
                              <Select value={stageDraft || activeStageOptions[0]?.stage_key} onValueChange={setStageDraft}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecciona una etapa" />
                                </SelectTrigger>
                                <SelectContent>
                                  {activeStageOptions.map((stage) => (
                                    <SelectItem key={stage.stage_key} value={stage.stage_key}>
                                      {stage.label_es}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-border/80 shadow-none">
                      <CardHeader className="border-b border-border/80">
                        <CardTitle className="text-base">Próxima acción</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4 p-6">
                        <div className="grid gap-4 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-foreground">Tipo de acción</p>
                            <Select value={nextActionTypeDraft} onValueChange={(value) => setNextActionTypeDraft(value as NextActionType)}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="notify_team">Seguimiento del equipo</SelectItem>
                                <SelectItem value="retry_call">Reintentar llamada</SelectItem>
                                <SelectItem value="start_whatsapp_ai">Activar WhatsApp IA</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-foreground">Fecha y hora</p>
                            <Input type="datetime-local" value={nextActionDueDraft} onChange={(event) => setNextActionDueDraft(event.target.value)} />
                          </div>
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-foreground">Nota de la tarea</p>
                            <Textarea
                              rows={4}
                              value={nextActionNoteDraft}
                              onChange={(event) => setNextActionNoteDraft(event.target.value)}
                              placeholder="Ej: llamar mañana a las 11:00, revisar objeción de precio, esperar confirmación del equipo..."
                            />
                          </div>
                        </div>
                        {primaryNextAction ? (
                          <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <Badge variant={nextActionVariant(primaryNextAction.action_type)}>{nextActionLabel(primaryNextAction.action_type)}</Badge>
                              <span className="text-xs text-muted-foreground">{formatDateTime(primaryNextAction.due_at)}</span>
                            </div>
                            <p className="mt-2 text-foreground">{getPayloadNote(primaryNextAction.payload) || "Sin nota adicional."}</p>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button type="button" variant="outline" onClick={clearNextAction} disabled={savingNextAction || (!primaryNextAction && !selectedLead.next_action_at)}>
                            Limpiar
                          </Button>
                          <Button type="button" onClick={saveNextAction} disabled={savingNextAction || !nextActionDueDraft}>
                            {savingNextAction ? "Guardando..." : "Guardar acción"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-border/80 shadow-none">
                      <CardHeader className="border-b border-border/80">
                        <CardTitle className="text-base">Timeline comercial</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 p-6">
                        {timeline.length ? (
                          timeline.map((item) => (
                            <div key={item.id} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <div className="rounded-full border border-border bg-muted/30 p-2 text-muted-foreground">
                                    {item.type === "note" ? (
                                      <NotebookPen className="h-4 w-4" />
                                    ) : item.type === "appointment" ? (
                                      <CalendarDays className="h-4 w-4" />
                                    ) : item.type === "call" ? (
                                      <Phone className="h-4 w-4" />
                                    ) : (
                                      <MessageSquareText className="h-4 w-4" />
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                                    <p className="text-xs text-muted-foreground">{item.meta}</p>
                                  </div>
                                </div>
                                <Badge variant={item.type === "note" ? "soft" : item.type === "appointment" ? "warning" : item.type === "next_action" ? "success" : "default"}>
                                  {item.type === "note" ? "Nota" : item.type === "appointment" ? "Cita" : item.type === "next_action" ? "Tarea" : "Llamada"}
                                </Badge>
                              </div>
                              <p className="mt-3 text-sm text-foreground">{item.body}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">Todavía no hay actividad registrada para este lead.</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-4">
                    <Card className="border-border/80 shadow-none">
                      <CardHeader className="border-b border-border/80">
                        <CardTitle className="text-base">Resumen rápido</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 p-6 text-sm">
                        <InfoRow label="Llamadas" value={String(calls.length)} />
                        <InfoRow label="Citas" value={String(appointments.length)} />
                        <InfoRow label="Notas" value={notesAvailable ? String(notes.length) : "No disponible"} />
                        <InfoRow label="Conversación WA" value={`${waMessages.length} mensajes`} />
                        <InfoRow label="WhatsApp" value={selectedLead.whatsapp_blocked ? "Bloqueado" : "Activo"} />
                        <InfoRow
                          label="Último mensaje WA"
                          value={formatDateTime(selectedLastWhatsappMessageAt || selectedLead.last_contact_at)}
                        />
                        <InfoRow label="Gestión actual" value={selectedManagedByLabel} />
                      </CardContent>
                    </Card>

                    <Card className="border-border/80 shadow-none">
                      <CardHeader className="border-b border-border/80">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <NotebookPen className="h-4 w-4" />
                          Notas internas
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4 p-6">
                        <Textarea
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          placeholder="Añade contexto útil: objeciones, preferencias horarias, información clínica o próxima acción..."
                          rows={5}
                          disabled={!notesAvailable}
                        />
                        <div className="flex justify-end">
                          <Button type="button" onClick={addNote} disabled={savingNote || !noteDraft.trim() || !notesAvailable}>
                            {savingNote ? "Guardando..." : "Guardar nota"}
                          </Button>
                        </div>
                        <div className="space-y-3">
                          {notes.length ? (
                            notes.map((note) => (
                              <div key={note.id} className="rounded-2xl border border-border bg-muted/20 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-medium text-foreground">{note.created_by_name || "Equipo clínica"}</p>
                                  <p className="text-xs text-muted-foreground">{formatDateTime(note.created_at)}</p>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {notesAvailable
                                ? "Aún no hay notas manuales para este lead."
                                : "Las notas estarán disponibles cuando se cree la tabla lead_notes en Supabase."}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="overflow-hidden border-border/80 shadow-none">
                      <CardHeader className="border-b border-border/80">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <MessageSquareText className="h-4 w-4" />
                              Conversación de WhatsApp
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                              {waThreads.length
                                ? `${waThreads.length} hilo${waThreads.length === 1 ? "" : "s"} · ${waMessages.length} mensajes`
                                : "Todavía no hay conversación de WhatsApp enlazada a este lead."}
                            </p>
                          </div>
                          <Button type="button" variant="outline" asChild>
                            <Link href="/messages">
                              <LinkIcon className="mr-2 h-4 w-4" />
                              Ver bandeja completa
                            </Link>
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="max-h-[640px] overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(245,239,227,0.85),rgba(255,255,255,0.95))] p-4">
                        {chatItems.length ? (
                          <div className="space-y-4">
                            {chatItems.map((item) => {
                              if (item.kind === "separator") {
                                return (
                                  <div key={item.key} className="flex justify-center">
                                    <span className="rounded-full border border-border bg-white px-3 py-1 text-xs text-muted-foreground shadow-sm">
                                      {item.label}
                                    </span>
                                  </div>
                                );
                              }

                              const message = item.message;
                              const isAssistant = message.role === "assistant" || (message.direction === "outbound" && message.role !== "human");
                              const isSystem = message.role === "system";

                              return (
                                <div key={message.id} className={cn("flex", isAssistant ? "justify-end" : "justify-start")}>
                                  <div
                                    className={cn(
                                      "max-w-[88%] rounded-[22px] border px-4 py-3 shadow-sm",
                                      isSystem
                                        ? "border-border bg-white text-foreground"
                                        : isAssistant
                                          ? "border-emerald-200 bg-emerald-100/80 text-foreground"
                                          : "border-border bg-white text-foreground"
                                    )}
                                  >
                                    <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                                      <span>{getParticipantLabel(message)}</span>
                                      <span>·</span>
                                      <span>{formatClinicTime(message.created_at)}</span>
                                    </div>
                                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-border bg-white p-6 text-sm text-muted-foreground">
                            Cuando este lead tenga mensajes guardados en <code>wa_messages</code>, los veremos aquí completos.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex min-h-[320px] items-center justify-center p-6 text-center">
              <div className="max-w-md space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-white text-muted-foreground">
                  <MessageSquareText className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-semibold text-foreground">Todavía no hay un lead seleccionado</h2>
                <p className="text-sm text-muted-foreground">
                  En esta vista podremos revisar el estado actual del lead, asignar responsable, programar la próxima acción,
                  tomar notas y ver la conversación completa de WhatsApp sin salir de Clientes.
                </p>
                {error ? <Badge variant="danger">{error}</Badge> : null}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
