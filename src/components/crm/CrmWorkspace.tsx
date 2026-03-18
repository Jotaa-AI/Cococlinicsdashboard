"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  MessageSquareText,
  NotebookPen,
  Phone,
  RefreshCw,
  Save,
  Search,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Appointment, Call, Lead, LeadNote } from "@/lib/types";
import { formatClinicDateTime } from "@/lib/datetime/clinicTime";
import { cn } from "@/lib/utils/cn";

type ManagedByFilter = "all" | "humano" | "IA" | "unassigned";
type ManagedByValue = "humano" | "IA" | "unassigned";

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
  type: "note" | "appointment" | "call";
  title: string;
  body: string;
  meta: string;
  created_at: string;
}

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
  const [search, setSearch] = useState("");
  const [managedByFilter, setManagedByFilter] = useState<ManagedByFilter>("all");
  const [managedByDraft, setManagedByDraft] = useState<ManagedByValue>("unassigned");
  const [stageDraft, setStageDraft] = useState<string>("");
  const [noteDraft, setNoteDraft] = useState("");
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [savingLead, setSavingLead] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  const stageLabelMap = useMemo(
    () => new Map(stageOptions.map((stage) => [stage.stage_key, stage.label_es])),
    [stageOptions]
  );

  const loadLeads = useCallback(async () => {
    if (!clinicId) return;
    setLoadingLeads(true);
    setError(null);

    const [leadsResult, stagesResult] = await Promise.all([
      supabase
        .from("leads")
        .select(
          "id, clinic_id, full_name, phone, treatment, source, managed_by, status, intents, converted_to_client, converted_value_eur, converted_service_name, converted_at, post_visit_outcome_reason, contacto_futuro, whatsapp_blocked, whatsapp_blocked_reason, whatsapp_blocked_at, whatsapp_blocked_by_user_id, first_call_answered, second_call_answered, whatsapp_handoff_needed, has_scheduled_appointment, stage_key, ab_variant, last_contact_at, next_action_at, created_at, updated_at"
        )
        .eq("clinic_id", clinicId)
        .order("updated_at", { ascending: false })
        .limit(500),
      supabase
        .from("lead_stage_catalog")
        .select("stage_key, label_es, pipeline_label_es, pipeline_order, order_index, is_active")
        .eq("is_active", true)
        .order("pipeline_order", { ascending: true })
        .order("order_index", { ascending: true }),
    ]);

    if (leadsResult.error || stagesResult.error) {
      setError(
        leadsResult.error?.message ||
          stagesResult.error?.message ||
          "No se pudieron cargar los datos del CRM."
      );
      setLoadingLeads(false);
      return;
    }

    const nextLeads = (leadsResult.data || []) as Lead[];
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
        return;
      }

      setLoadingDetails(true);
      setError(null);

      const [appointmentsResult, callsResult, notesResult] = await Promise.all([
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
      ]);

      if (appointmentsResult.error || callsResult.error || notesResult.error) {
        setError(
          appointmentsResult.error?.message ||
            callsResult.error?.message ||
            notesResult.error?.message ||
            "No se pudieron cargar los detalles del lead."
        );
        setLoadingDetails(false);
        return;
      }

      setAppointments((appointmentsResult.data || []) as Appointment[]);
      setCalls((callsResult.data || []) as Call[]);
      setNotes((notesResult.data || []) as LeadNote[]);
      setLoadingDetails(false);
    },
    [clinicId, supabase]
  );

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    if (!selectedLead) return;
    setManagedByDraft(selectedLead.managed_by || "unassigned");
    setStageDraft(selectedLead.stage_key || "");
    loadLeadDetails(selectedLead);
  }, [loadLeadDetails, selectedLead]);

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
      managed_by: managedByDraft === "unassigned" ? null : managedByDraft,
      stage_key: stageDraft || selectedLead.stage_key,
      updated_at: new Date().toISOString(),
    };

    const { data, error: updateError } = await supabase
      .from("leads")
      .update(payload)
      .eq("id", selectedLead.id)
      .select(
        "id, clinic_id, full_name, phone, treatment, source, managed_by, status, intents, converted_to_client, converted_value_eur, converted_service_name, converted_at, post_visit_outcome_reason, contacto_futuro, whatsapp_blocked, whatsapp_blocked_reason, whatsapp_blocked_at, whatsapp_blocked_by_user_id, first_call_answered, second_call_answered, whatsapp_handoff_needed, has_scheduled_appointment, stage_key, ab_variant, last_contact_at, next_action_at, created_at, updated_at"
      )
      .single();

    if (updateError || !data) {
      setError(updateError?.message || "No se pudieron guardar los cambios del lead.");
      setSavingLead(false);
      return;
    }

    setLeads((current) => current.map((lead) => (lead.id === selectedLead.id ? (data as Lead) : lead)));
    setSuccess("Lead actualizado correctamente.");
    setSavingLead(false);
  };

  const addNote = async () => {
    if (!selectedLead || !clinicId) return;
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
      body: `${appointment.status === "scheduled" ? "Cita programada" : appointment.status === "done" ? "Cita realizada" : "Cita cancelada"} · ${formatDateTime(appointment.start_at)}`,
      meta: `${appointment.source_channel || "sin canal"} · ${appointment.status}`,
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

    return [...noteItems, ...appointmentItems, ...callItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [appointments, calls, notes]);

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

  if (profileLoading) {
    return <div className="rounded-xl border border-border bg-white p-6 text-sm text-muted-foreground">Cargando CRM...</div>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-[linear-gradient(180deg,rgba(244,240,230,0.95),rgba(255,255,255,0.95))]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Leads</CardTitle>
              <p className="text-sm text-muted-foreground">Tu bandeja CRM para seguir el estado comercial real.</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-10 w-10 px-0" onClick={loadLeads} disabled={loadingLeads}>
              <RefreshCw className={cn("h-4 w-4", loadingLeads && "animate-spin")} />
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre, teléfono o tratamiento..."
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ["all", "Todos"],
              ["humano", "Clínica"],
              ["IA", "IA"],
              ["unassigned", "Sin asignar"],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={managedByFilter === value ? "default" : "outline"}
                size="sm"
                onClick={() => setManagedByFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="max-h-[calc(100vh-14rem)] overflow-y-auto p-0">
          {filteredLeads.length ? (
            filteredLeads.map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => setSelectedLeadId(lead.id)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border px-4 py-4 text-left transition hover:bg-muted/50",
                  selectedLeadId === lead.id && "bg-primary/5"
                )}
              >
                <div className="mt-1 rounded-full border border-border bg-white p-2 text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{lead.full_name || lead.phone || "Lead sin nombre"}</p>
                      <p className="text-xs text-muted-foreground">{lead.phone || "Sin teléfono"}</p>
                    </div>
                    <p className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(lead.updated_at)}</p>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {lead.treatment || "Sin tratamiento"} · {stageLabelMap.get(lead.stage_key || "") || lead.stage_key || "Sin etapa"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={managedByBadgeVariant(lead.managed_by)}>{managedByLabel(lead.managed_by)}</Badge>
                    <Badge variant={stageBadgeVariant(lead.stage_key)}>{stageLabelMap.get(lead.stage_key || "") || lead.stage_key || "Sin etapa"}</Badge>
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="p-6 text-sm text-muted-foreground">No hay leads que coincidan con ese filtro.</div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {selectedLead ? (
          <>
            <Card>
              <CardHeader className="border-b border-border bg-[linear-gradient(180deg,rgba(244,240,230,0.95),rgba(255,255,255,0.95))]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-semibold text-foreground">{selectedLead.full_name || "Lead sin nombre"}</h2>
                      <Badge variant={managedByBadgeVariant(selectedLead.managed_by)}>{managedByLabel(selectedLead.managed_by)}</Badge>
                      <Badge variant={stageBadgeVariant(selectedLead.stage_key)}>
                        {stageLabelMap.get(selectedLead.stage_key || "") || selectedLead.stage_key || "Sin etapa"}
                      </Badge>
                      {selectedLead.whatsapp_blocked ? <Badge variant="danger">WhatsApp bloqueado</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {selectedLead.phone || "Sin teléfono"} · {selectedLead.treatment || "Sin tratamiento"} · {selectedLead.source || "Sin origen"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
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
              <CardContent className="space-y-4 pt-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-border bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Creado</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{formatDateTime(selectedLead.created_at)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Último contacto</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{formatDateTime(selectedLead.last_contact_at)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Próxima acción</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{formatDateTime(selectedLead.next_action_at)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Cita agendada</p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {selectedLead.has_scheduled_appointment ? "Sí" : "No"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                  <Card className="border-border/80 shadow-none">
                    <CardHeader>
                      <CardTitle className="text-base">Control comercial</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">Quién lo gestiona</p>
                        <Select value={managedByDraft} onValueChange={(value) => setManagedByDraft(value as ManagedByValue)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="humano">Clínica</SelectItem>
                            <SelectItem value="IA">IA</SelectItem>
                            <SelectItem value="unassigned">Sin asignar</SelectItem>
                          </SelectContent>
                        </Select>
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
                      <div className="rounded-xl border border-border bg-muted/30 p-4 md:col-span-2">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Cierre comercial</p>
                        <p className="mt-2 text-sm text-foreground">
                          {selectedLead.converted_to_client
                            ? `${selectedLead.converted_service_name || "Servicio sin especificar"} · ${selectedLead.converted_value_eur ?? 0} €`
                            : selectedLead.post_visit_outcome_reason || "Aún no hay cierre registrado."}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border/80 shadow-none">
                    <CardHeader>
                      <CardTitle className="text-base">Resumen rápido</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Llamadas</span>
                        <span className="font-medium text-foreground">{calls.length}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Citas</span>
                        <span className="font-medium text-foreground">{appointments.length}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Notas</span>
                        <span className="font-medium text-foreground">{notes.length}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">WhatsApp</span>
                        <span className="font-medium text-foreground">
                          {selectedLead.whatsapp_blocked ? "Bloqueado" : "Activo"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Valor cerrado</span>
                        <span className="font-medium text-foreground">
                          {selectedLead.converted_value_eur ? `${selectedLead.converted_value_eur} €` : "—"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {(error || success) ? (
                  <div className="flex flex-wrap gap-3">
                    {error ? <Badge variant="danger">{error}</Badge> : null}
                    {success ? <Badge variant="success">{success}</Badge> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <NotebookPen className="h-4 w-4" />
                    Notas manuales
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Añade contexto útil: objeciones, preferencias horarias, información clínica o próxima acción..."
                    rows={5}
                  />
                  <div className="flex justify-end">
                    <Button type="button" onClick={addNote} disabled={savingNote || !noteDraft.trim()}>
                      {savingNote ? "Guardando..." : "Guardar nota"}
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {notes.length ? (
                      notes.map((note) => (
                        <div key={note.id} className="rounded-xl border border-border bg-muted/20 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-foreground">{note.created_by_name || "Equipo clínica"}</p>
                            <p className="text-xs text-muted-foreground">{formatDateTime(note.created_at)}</p>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">Aún no hay notas manuales para este lead.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Timeline comercial</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {timeline.length ? (
                    timeline.map((item) => (
                      <div key={item.id} className="rounded-xl border border-border bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="rounded-full border border-border bg-muted/30 p-2 text-muted-foreground">
                              {item.type === "note" ? (
                                <NotebookPen className="h-4 w-4" />
                              ) : item.type === "appointment" ? (
                                <CalendarDays className="h-4 w-4" />
                              ) : (
                                <Phone className="h-4 w-4" />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-foreground">{item.title}</p>
                              <p className="text-xs text-muted-foreground">{item.meta}</p>
                            </div>
                          </div>
                          <Badge variant={item.type === "note" ? "soft" : item.type === "appointment" ? "warning" : "default"}>
                            {item.type === "note" ? "Nota" : item.type === "appointment" ? "Cita" : "Llamada"}
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
                  En esta vista podremos revisar el estado actual del lead, tomar notas manuales y seguir su historia de llamadas,
                  citas y acciones del equipo.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
