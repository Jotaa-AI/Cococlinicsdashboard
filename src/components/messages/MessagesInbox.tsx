"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, MessageSquare, Phone, RefreshCw, Search, ShieldAlert, UserRound } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import { normalizeEsPhone } from "@/lib/leads/resolveLead";
import type { Call, Lead, WaMessage, WaThread } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

const CLINIC_TZ = "Europe/Madrid";

interface ThreadListItem extends WaThread {
  lead: Pick<Lead, "id" | "full_name" | "phone" | "treatment"> | null;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  messagesCount: number;
}

interface ConversationListItem {
  id: string;
  threadIds: string[];
  primaryThreadId: string;
  lead: Pick<Lead, "id" | "full_name" | "phone" | "treatment"> | null;
  phone_e164: string;
  state: string;
  hitl_active: boolean;
  updated_at: string | null;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  messagesCount: number;
}

interface InitialCallContext {
  call: Call | null;
  lead: Pick<Lead, "full_name" | "phone" | "treatment"> | null;
}

interface DaySeparatorItem {
  kind: "separator";
  key: string;
  label: string;
}

interface MessageItem {
  kind: "message";
  message: WaMessage;
}

type ChatItem = DaySeparatorItem | MessageItem;

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: CLINIC_TZ,
  });
}

function formatSidebarTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: CLINIC_TZ,
  });
}

function formatMessageTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: CLINIC_TZ,
  });
}

function formatDayLabel(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: CLINIC_TZ,
  });
}

function getDayKey(value?: string | null) {
  if (!value) return "sin-fecha";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: CLINIC_TZ,
  }).format(new Date(value));
}

function getParticipantLabel(message: WaMessage) {
  if (message.role === "assistant") return "Agente IA";
  if (message.role === "system") return "Sistema";
  return message.direction === "inbound" ? "Lead" : "Equipo";
}

function formatStateLabel(state?: string | null) {
  if (!state) return "Sin estado";
  return state.replace(/_/g, " ");
}

function getConversationDisplayName(conversation: ConversationListItem) {
  return conversation.lead?.full_name || conversation.phone_e164 || "Lead sin identificar";
}

function getConversationPreview(conversation: ConversationListItem) {
  return conversation.lastMessageText || "Sin mensajes todavía";
}

function getConversationKey(thread: ThreadListItem) {
  return thread.lead?.id || normalizeEsPhone(thread.phone_e164) || thread.id;
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

export function MessagesInbox() {
  const supabase = createSupabaseBrowserClient();
  const { profile, loading: profileLoading } = useProfile();
  const clinicId = profile?.clinic_id;

  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [initialCall, setInitialCall] = useState<InitialCallContext>({ call: null, lead: null });
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [togglingHitl, setTogglingHitl] = useState(false);
  const [search, setSearch] = useState("");

  const loadThreads = useCallback(async () => {
    if (!clinicId) return;
    setLoadingThreads(true);

    const { data: threadRows, error } = await supabase
      .from("wa_threads")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      setThreads([]);
      setLoadingThreads(false);
      return;
    }

    const typedThreads = ((threadRows || []) as WaThread[]).filter(Boolean);
    if (!typedThreads.length) {
      setThreads([]);
      setSelectedConversationId(null);
      setLoadingThreads(false);
      return;
    }

    const leadIds = Array.from(new Set(typedThreads.map((thread) => thread.lead_id).filter(Boolean))) as string[];
    const phones = Array.from(
      new Set(typedThreads.map((thread) => normalizeEsPhone(thread.phone_e164)).filter(Boolean))
    ) as string[];
    const threadIds = typedThreads.map((thread) => thread.id);

    const [leadsByIdResult, leadsByPhoneResult, recentMessagesResult] = await Promise.all([
      leadIds.length
        ? supabase.from("leads").select("id, full_name, phone, treatment").eq("clinic_id", clinicId).in("id", leadIds)
        : Promise.resolve({ data: [] as Array<Pick<Lead, "id" | "full_name" | "phone" | "treatment">> }),
      phones.length
        ? supabase.from("leads").select("id, full_name, phone, treatment").eq("clinic_id", clinicId).in("phone", phones)
        : Promise.resolve({ data: [] as Array<Pick<Lead, "id" | "full_name" | "phone" | "treatment">> }),
      supabase
        .from("wa_messages")
        .select("id, thread_id, text, created_at")
        .eq("clinic_id", clinicId)
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false }),
    ]);

    const leadById = new Map<string, Pick<Lead, "id" | "full_name" | "phone" | "treatment">>();
    const leadByPhone = new Map<string, Pick<Lead, "id" | "full_name" | "phone" | "treatment">>();

    for (const lead of ((leadsByIdResult.data || []) as Array<Pick<Lead, "id" | "full_name" | "phone" | "treatment">>)) {
      leadById.set(lead.id, lead);
    }
    for (const lead of ((leadsByPhoneResult.data || []) as Array<Pick<Lead, "id" | "full_name" | "phone" | "treatment">>)) {
      const normalized = normalizeEsPhone(lead.phone);
      if (normalized) leadByPhone.set(normalized, lead);
    }

    const lastMessageByThread = new Map<string, { created_at: string; text: string }>();
    const countByThread = new Map<string, number>();
    for (const message of (recentMessagesResult.data || []) as Array<Pick<WaMessage, "thread_id" | "created_at" | "text">>) {
      countByThread.set(message.thread_id, (countByThread.get(message.thread_id) || 0) + 1);
      if (!lastMessageByThread.has(message.thread_id)) {
        lastMessageByThread.set(message.thread_id, {
          created_at: message.created_at,
          text: message.text,
        });
      }
    }

    const nextThreads: ThreadListItem[] = typedThreads.map((thread) => {
      const normalizedPhone = normalizeEsPhone(thread.phone_e164);
      const lead =
        (thread.lead_id ? leadById.get(thread.lead_id) : null) ||
        (normalizedPhone ? leadByPhone.get(normalizedPhone) : null) ||
        null;
      const lastMessage = lastMessageByThread.get(thread.id);
      return {
        ...thread,
        lead,
        lastMessageAt: lastMessage?.created_at || null,
        lastMessageText: lastMessage?.text || null,
        messagesCount: countByThread.get(thread.id) || 0,
      };
    });

    setThreads(nextThreads);
    setLoadingThreads(false);
  }, [clinicId, supabase]);

  const conversations = useMemo<ConversationListItem[]>(() => {
    const grouped = new Map<string, ConversationListItem>();

    for (const thread of threads) {
      const key = getConversationKey(thread);
      const existing = grouped.get(key);
      const candidateTimestamp = new Date(thread.lastMessageAt || thread.updated_at || 0).getTime();
      const existingTimestamp = existing ? new Date(existing.lastMessageAt || existing.updated_at || 0).getTime() : -1;

      if (!existing) {
        grouped.set(key, {
          id: key,
          threadIds: [thread.id],
          primaryThreadId: thread.id,
          lead: thread.lead,
          phone_e164: thread.phone_e164,
          state: thread.state,
          hitl_active: thread.hitl_active,
          updated_at: thread.updated_at || null,
          lastMessageAt: thread.lastMessageAt,
          lastMessageText: thread.lastMessageText,
          messagesCount: thread.messagesCount,
        });
        continue;
      }

      existing.threadIds.push(thread.id);
      existing.messagesCount += thread.messagesCount;
      existing.hitl_active = existing.hitl_active || thread.hitl_active;

      if (!existing.lead && thread.lead) existing.lead = thread.lead;

      if (candidateTimestamp >= existingTimestamp) {
        existing.primaryThreadId = thread.id;
        existing.phone_e164 = thread.phone_e164;
        existing.state = thread.state;
        existing.updated_at = thread.updated_at || null;
        existing.lastMessageAt = thread.lastMessageAt;
        existing.lastMessageText = thread.lastMessageText;
      }
    }

    return [...grouped.values()].sort((a, b) => {
      const aTs = new Date(a.lastMessageAt || a.updated_at || 0).getTime();
      const bTs = new Date(b.lastMessageAt || b.updated_at || 0).getTime();
      return bTs - aTs;
    });
  }, [threads]);

  useEffect(() => {
    setSelectedConversationId((current) =>
      current && conversations.some((conversation) => conversation.id === current)
        ? current
        : conversations[0]?.id || null
    );
  }, [conversations]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [selectedConversationId, conversations]
  );

  const filteredThreads = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((conversation) => {
      const haystack = [
        getConversationDisplayName(conversation),
        conversation.lead?.phone,
        conversation.phone_e164,
        conversation.lead?.treatment,
        conversation.lastMessageText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [search, conversations]);

  const chatItems = useMemo(() => buildChatItems(messages), [messages]);

  const toggleHitl = useCallback(async () => {
    if (!selectedConversation) return;
    setTogglingHitl(true);

    const nextValue = !selectedConversation.hitl_active;
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from("wa_threads")
      .update({ hitl_active: nextValue, updated_at: updatedAt })
      .in("id", selectedConversation.threadIds);

    if (!error) {
      setThreads((current) =>
        current.map((thread) =>
          selectedConversation.threadIds.includes(thread.id)
            ? {
                ...thread,
                hitl_active: nextValue,
                updated_at: updatedAt,
              }
            : thread
        )
      );
    }

    setTogglingHitl(false);
  }, [selectedConversation, supabase]);

  const loadThreadDetail = useCallback(async () => {
    if (!clinicId || !selectedConversation) {
      setMessages([]);
      setInitialCall({ call: null, lead: null });
      return;
    }

    setLoadingMessages(true);

    const [messagesResult, callByLeadResult, callByPhoneResult] = await Promise.all([
      supabase
        .from("wa_messages")
        .select("*")
        .eq("clinic_id", clinicId)
        .in("thread_id", selectedConversation.threadIds)
        .order("created_at", { ascending: true }),
      selectedConversation.lead?.id
        ? supabase
            .from("calls")
            .select("*")
            .eq("clinic_id", clinicId)
            .eq("lead_id", selectedConversation.lead.id)
            .order("started_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null as Call | null }),
      selectedConversation.phone_e164
        ? supabase
            .from("calls")
            .select("*")
            .eq("clinic_id", clinicId)
            .eq("phone", selectedConversation.phone_e164)
            .order("started_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null as Call | null }),
    ]);

    const firstCall = (callByLeadResult.data as Call | null) || (callByPhoneResult.data as Call | null) || null;
    setMessages(((messagesResult.data || []) as WaMessage[]).filter(Boolean));
    setInitialCall({ call: firstCall, lead: selectedConversation.lead || null });
    setLoadingMessages(false);
  }, [clinicId, selectedConversation, supabase]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads, refreshTick]);

  useEffect(() => {
    loadThreadDetail();
  }, [loadThreadDetail]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel(`messages-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_threads", filter: `clinic_id=eq.${clinicId}` },
        () => loadThreads()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_messages", filter: `clinic_id=eq.${clinicId}` },
        () => {
          loadThreads();
          loadThreadDetail();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, loadThreadDetail, loadThreads, supabase]);

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="overflow-hidden rounded-[28px] border-border/70 bg-white">
        <div className="border-b border-border/70 bg-[#f6f2eb] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Conversaciones abiertas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Aquí iremos viendo todo lo que entra y sale por WhatsApp.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRefreshTick((value) => value + 1)}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por lead, teléfono o texto..."
              className="pl-9"
            />
          </div>
        </div>

        <div className="max-h-[76vh] overflow-y-auto bg-white">
          {profileLoading || loadingThreads ? (
            <div className="p-5 text-sm text-muted-foreground">Cargando conversaciones...</div>
          ) : filteredThreads.length ? (
            <div className="divide-y divide-border/70">
              {filteredThreads.map((conversation) => {
                const active = conversation.id === selectedConversationId;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-4 text-left transition",
                      active ? "bg-[#efeae2]" : "hover:bg-muted/40"
                    )}
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{getConversationDisplayName(conversation)}</p>
                          <p className="truncate text-xs text-muted-foreground">{conversation.lead?.phone || conversation.phone_e164}</p>
                        </div>
                        <div className="shrink-0 text-[11px] text-muted-foreground">
                          {formatSidebarTime(conversation.lastMessageAt || conversation.updated_at)}
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{getConversationPreview(conversation)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {conversation.hitl_active ? <Badge variant="warning">HITL</Badge> : <Badge variant="success">IA activa</Badge>}
                        <Badge variant="soft">{conversation.messagesCount} mensajes</Badge>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">Todavía no hay conversaciones registradas.</div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden rounded-[28px] border-border/70 bg-[#efeae2]">
        {selectedConversation ? (
          <>
            <div className="border-b border-border/70 bg-[#f6f2eb] px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-soft">
                    <UserRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-foreground">{getConversationDisplayName(selectedConversation)}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {selectedConversation.lead?.phone || selectedConversation.phone_e164}
                      {selectedConversation.lead?.treatment ? ` · ${selectedConversation.lead.treatment}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="soft">{formatStateLabel(selectedConversation.state)}</Badge>
                  {selectedConversation.hitl_active ? <Badge variant="warning">HITL activo</Badge> : <Badge variant="success">IA activa</Badge>}
                  <Button
                    type="button"
                    variant={selectedConversation.hitl_active ? "default" : "outline"}
                    size="sm"
                    onClick={toggleHitl}
                    disabled={togglingHitl}
                  >
                    <Bot className="h-4 w-4" />
                    {selectedConversation.hitl_active ? "Conectar IA" : "Detener IA"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid min-h-[76vh] grid-rows-[auto_1fr_auto]">
              <div className="border-b border-border/70 bg-white/80 px-5 py-4">
                <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-white px-4 py-4 shadow-soft">
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">Llamada inicial IA</p>
                      {initialCall.call ? <Badge variant="soft">{initialCall.call.outcome || "sin outcome"}</Badge> : null}
                    </div>
                    {initialCall.call ? (
                      <>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(initialCall.call.started_at || initialCall.call.created_at)}
                          {" · "}
                          {initialCall.call.duration_sec ? `${Math.round(initialCall.call.duration_sec / 60)} min` : "duración no disponible"}
                        </p>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                          {initialCall.call.summary || initialCall.call.transcript || "Sin resumen ni transcripción disponible."}
                        </p>
                        <Link
                          href={`/calls/${initialCall.call.id}`}
                          className="mt-3 inline-flex text-xs font-medium text-primary hover:underline"
                        >
                          Ver detalle completo de la llamada
                        </Link>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">No hay llamada inicial registrada para este lead.</p>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="max-h-[56vh] overflow-y-auto px-5 py-5"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 1px 1px, rgba(10, 39, 76, 0.06) 1px, transparent 0)",
                  backgroundSize: "18px 18px",
                }}
              >
                {loadingMessages ? (
                  <p className="text-sm text-muted-foreground">Cargando mensajes...</p>
                ) : chatItems.length ? (
                  <div className="space-y-3">
                    {chatItems.map((item) => {
                      if (item.kind === "separator") {
                        return (
                          <div key={item.key} className="flex justify-center py-2">
                            <div className="rounded-full border border-border/70 bg-white/90 px-4 py-1 text-[11px] font-medium text-muted-foreground shadow-soft">
                              {item.label}
                            </div>
                          </div>
                        );
                      }

                      const message = item.message;
                      const isOutbound = message.direction === "outbound";
                      const isSystem = message.role === "system";

                      return (
                        <div
                          key={message.id}
                          className={cn("flex", isSystem ? "justify-center" : isOutbound ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={cn(
                              "max-w-[82%] rounded-[22px] px-4 py-3 text-sm shadow-soft",
                              isSystem
                                ? "border border-border bg-white/90 text-muted-foreground"
                                : isOutbound
                                  ? "rounded-br-md bg-[#d9fdd3] text-foreground"
                                  : "rounded-bl-md border border-border/70 bg-white text-foreground"
                            )}
                          >
                            <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="font-medium uppercase tracking-[0.16em]">{getParticipantLabel(message)}</span>
                              <span>·</span>
                              <span>{formatMessageTime(message.created_at)}</span>
                            </div>
                            <p className="whitespace-pre-wrap leading-6">{message.text}</p>
                            {(message.intent || message.delivery_status) && !isSystem ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {message.intent ? <Badge variant="soft">{message.intent}</Badge> : null}
                                {message.delivery_status ? <span className="text-[11px] text-muted-foreground">{message.delivery_status}</span> : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="rounded-2xl border border-dashed border-border/70 bg-white/85 px-6 py-5 text-center text-sm text-muted-foreground">
                      Todavía no hay mensajes de WhatsApp en este hilo.
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-border/70 bg-[#f6f2eb] px-5 py-4">
                <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-white px-4 py-4 shadow-soft">
                  <div className="mt-0.5 text-primary">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Vista de conversación</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Este panel es de solo lectura. n8n debe ir enviando cada mensaje entrante y saliente al webhook para que el historial se vea aquí en tiempo real.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-[76vh] items-center justify-center px-8 py-10">
            <div className="max-w-md rounded-[24px] border border-dashed border-border/70 bg-white/85 p-8 text-center shadow-soft">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Selecciona una conversación</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                En cuanto el agente de n8n empiece a intercambiar mensajes con un lead, el hilo aparecerá en el panel izquierdo.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
