"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, MessageSquare, Phone, RefreshCw } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import { normalizeEsPhone } from "@/lib/leads/resolveLead";
import type { Call, Lead, WaMessage, WaThread } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface ThreadListItem extends WaThread {
  lead: Pick<Lead, "id" | "full_name" | "phone" | "treatment"> | null;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  messagesCount: number;
}

interface InitialCallContext {
  call: Call | null;
  lead: Pick<Lead, "full_name" | "phone" | "treatment"> | null;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCompactDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getParticipantLabel(message: WaMessage) {
  if (message.role === "assistant") return "Agente WhatsApp";
  if (message.role === "system") return "Sistema";
  return message.direction === "inbound" ? "Lead" : "Clínica";
}

function formatStateLabel(state?: string | null) {
  if (!state) return "Sin estado";
  return state.replace(/_/g, " ");
}

function getThreadDisplayName(thread: ThreadListItem) {
  return thread.lead?.full_name || thread.phone_e164 || "Lead sin identificar";
}

function getThreadPreview(thread: ThreadListItem) {
  return thread.lastMessageText || "Sin mensajes todavía";
}

export function MessagesInbox() {
  const supabase = createSupabaseBrowserClient();
  const { profile, loading: profileLoading } = useProfile();
  const clinicId = profile?.clinic_id;

  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [initialCall, setInitialCall] = useState<InitialCallContext>({ call: null, lead: null });
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [togglingHitl, setTogglingHitl] = useState(false);

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
      setSelectedThreadId(null);
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
        .order("created_at", { ascending: false })
        
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
      const lead = (thread.lead_id ? leadById.get(thread.lead_id) : null) || (normalizedPhone ? leadByPhone.get(normalizedPhone) : null) || null;
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
    setSelectedThreadId((current) => (current && nextThreads.some((thread) => thread.id === current) ? current : nextThreads[0]?.id || null));
    setLoadingThreads(false);
  }, [clinicId, supabase]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [selectedThreadId, threads]
  );

  const toggleHitl = useCallback(async () => {
    if (!selectedThread) return;
    setTogglingHitl(true);

    const nextValue = !selectedThread.hitl_active;
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from("wa_threads")
      .update({ hitl_active: nextValue, updated_at: updatedAt })
      .eq("id", selectedThread.id);

    if (!error) {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === selectedThread.id
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
  }, [selectedThread, supabase]);

  const loadThreadDetail = useCallback(async () => {
    if (!clinicId || !selectedThread) {
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
        .eq("thread_id", selectedThread.id)
        .order("created_at", { ascending: true }),
      (selectedThread.lead_id || selectedThread.lead?.id)
        ? supabase
            .from("calls")
            .select("*")
            .eq("clinic_id", clinicId)
            .eq("lead_id", selectedThread.lead_id || selectedThread.lead?.id)
            .order("started_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null as Call | null }),
      selectedThread.phone_e164
        ? supabase
            .from("calls")
            .select("*")
            .eq("clinic_id", clinicId)
            .eq("phone", selectedThread.phone_e164)
            .order("started_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null as Call | null }),
    ]);

    const firstCall = (callByLeadResult.data as Call | null) || (callByPhoneResult.data as Call | null) || null;
    setMessages(((messagesResult.data || []) as WaMessage[]).filter(Boolean));
    setInitialCall({ call: firstCall, lead: selectedThread.lead || null });
    setLoadingMessages(false);
  }, [clinicId, selectedThread, supabase]);

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
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Hilos</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Conversaciones del agente con leads por WhatsApp.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRefreshTick((value) => value + 1)}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[72vh] overflow-y-auto">
            {profileLoading || loadingThreads ? (
              <div className="p-4 text-sm text-muted-foreground">Cargando hilos...</div>
            ) : threads.length ? (
              <div className="divide-y divide-border">
                {threads.map((thread) => {
                  const active = thread.id === selectedThreadId;
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => setSelectedThreadId(thread.id)}
                      className={cn(
                        "flex w-full flex-col gap-2 px-4 py-4 text-left transition",
                        active ? "bg-primary/8" : "hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{getThreadDisplayName(thread)}</p>
                          <p className="truncate text-xs text-muted-foreground">{thread.lead?.phone || thread.phone_e164}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {thread.hitl_active ? <Badge variant="warning">HITL</Badge> : null}
                          <Badge variant="soft">{formatStateLabel(thread.state)}</Badge>
                        </div>
                      </div>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{getThreadPreview(thread)}</p>
                      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                        <span>{thread.messagesCount} mensajes</span>
                        <span>{formatCompactDate(thread.lastMessageAt || thread.updated_at)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">Todavía no hay conversaciones registradas.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4 min-w-0">
        <Card>
          <CardHeader className="border-b border-border pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>{selectedThread ? getThreadDisplayName(selectedThread) : "Mensajes"}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedThread
                    ? `${selectedThread.lead?.phone || selectedThread.phone_e164} · Actualizado ${formatDateTime(
                        selectedThread.updated_at
                      )}`
                    : "Selecciona un hilo para ver la llamada inicial y los mensajes de WhatsApp."}
                </p>
              </div>
              {selectedThread ? (
                <div className="flex flex-wrap items-center gap-2">
                  {selectedThread.hitl_active ? <Badge variant="warning">HITL activo</Badge> : <Badge variant="success">IA activa</Badge>}
                  <Badge variant="soft">{formatStateLabel(selectedThread.state)}</Badge>
                  <Button
                    type="button"
                    variant={selectedThread.hitl_active ? "default" : "outline"}
                    size="sm"
                    onClick={toggleHitl}
                    disabled={togglingHitl}
                  >
                    <Bot className="h-4 w-4" />
                    {selectedThread.hitl_active ? "Conectar IA" : "Detener IA"}
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {selectedThread ? (
              <>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <div className="rounded-2xl border border-border bg-muted/20 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Phone className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Llamada inicial IA</p>
                    </div>
                    {initialCall.call ? (
                      <div className="space-y-3 text-sm">
                        <div className="flex flex-wrap gap-3 text-muted-foreground">
                          <span>{formatDateTime(initialCall.call.started_at || initialCall.call.created_at)}</span>
                          <span>Outcome: {initialCall.call.outcome || "—"}</span>
                          <span>Duración: {initialCall.call.duration_sec ? `${Math.round(initialCall.call.duration_sec / 60)} min` : "—"}</span>
                        </div>
                        {initialCall.lead?.treatment ? (
                          <p className="text-muted-foreground">Tratamiento: {initialCall.lead.treatment}</p>
                        ) : null}
                        <p className="rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground/90">
                          {initialCall.call.summary || initialCall.call.transcript || "Sin resumen ni transcripción disponible."}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <Link href={`/calls/${initialCall.call.id}`} className="font-medium text-primary hover:underline">
                            Ver detalle completo de la llamada
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No hay llamada inicial registrada para este lead.</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-border bg-white p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Resumen del hilo</p>
                    </div>
                    <dl className="grid gap-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Lead</dt>
                        <dd className="font-medium text-foreground">{getThreadDisplayName(selectedThread)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Teléfono</dt>
                        <dd className="font-medium text-foreground">{selectedThread.lead?.phone || selectedThread.phone_e164}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Mensajes</dt>
                        <dd className="font-medium text-foreground">{messages.length}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Última actividad</dt>
                        <dd className="font-medium text-foreground">{formatDateTime(selectedThread.updated_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Estado IA</dt>
                        <dd className="font-medium text-foreground">{selectedThread.hitl_active ? "Pausada por equipo" : "Activa"}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-white">
                  <div className="border-b border-border px-4 py-4">
                    <p className="text-sm font-semibold text-foreground">Mensajes de WhatsApp</p>
                    <p className="text-xs text-muted-foreground">
                      Aquí se muestra la conversación del agente con el lead, separada de la llamada inicial.
                    </p>
                  </div>
                  <div className="max-h-[56vh] space-y-3 overflow-y-auto px-4 py-4">
                    {loadingMessages ? (
                      <p className="text-sm text-muted-foreground">Cargando mensajes...</p>
                    ) : messages.length ? (
                      messages.map((message) => {
                        const isOutbound = message.direction === "outbound";
                        const isSystem = message.role === "system";
                        return (
                          <div
                            key={message.id}
                            className={cn(
                              "flex",
                              isSystem ? "justify-center" : isOutbound ? "justify-end" : "justify-start"
                            )}
                          >
                            <div
                              className={cn(
                                "max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm",
                                isSystem
                                  ? "border border-border bg-muted/40 text-muted-foreground"
                                  : isOutbound
                                    ? "bg-primary text-primary-foreground"
                                    : "border border-border bg-background text-foreground"
                              )}
                            >
                              <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] opacity-80">
                                <span>{getParticipantLabel(message)}</span>
                                <span>·</span>
                                <span>{formatDateTime(message.created_at)}</span>
                              </div>
                              <p className="whitespace-pre-wrap leading-6">{message.text}</p>
                              {message.intent ? (
                                <div className="mt-2 flex items-center gap-2">
                                  <Badge variant={isOutbound ? "default" : "soft"}>{message.intent}</Badge>
                                  {message.delivery_status ? <span className="text-[11px] opacity-80">{message.delivery_status}</span> : null}
                                </div>
                              ) : message.delivery_status ? (
                                <div className="mt-2 text-[11px] opacity-80">{message.delivery_status}</div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-muted-foreground">Todavía no hay mensajes de WhatsApp en este hilo.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-white/70 p-8 text-center text-sm text-muted-foreground">
                Selecciona una conversación del panel izquierdo para ver la llamada inicial y los mensajes.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
