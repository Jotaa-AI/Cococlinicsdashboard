"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Lead, LeadStageCatalog, LeadStageHistory } from "@/lib/types";
import { LEGACY_STATUS_FROM_STAGE, PIPELINE_LABELS_ES, STAGE_TONE_ES } from "@/lib/constants/lead-stage";
import { updateLeadOutcome } from "@/lib/leads/update-lead-outcome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CelebrationOverlay } from "@/components/ui/celebration-overlay";

const LEGACY_STAGE_FROM_STATUS: Record<string, string> = {
  new: "new_lead",
  whatsapp_sent: "contacting_whatsapp",
  call_done: "first_call_in_progress",
  contacted: "whatsapp_conversation_active",
  visit_scheduled: "visit_scheduled",
  no_response: "no_answer_first_call",
  not_interested: "not_interested",
};

const HIDDEN_PIPELINES = new Set(["whatsapp_ai"]);

const STAGE_REDIRECT_WHEN_HIDDEN: Record<string, string> = {
  contacting_whatsapp: "no_answer_second_call",
  whatsapp_conversation_active: "no_answer_second_call",
  whatsapp_followup_pending: "no_answer_second_call",
  whatsapp_failed_team_review: "no_answer_second_call",
};

const FALLBACK_STAGES: LeadStageCatalog[] = [
  {
    stage_key: "new_lead",
    pipeline_key: "calls_ai",
    pipeline_label_es: "Agentes de Llamada",
    label_es: "Nuevo lead",
    description_es: "Lead entrante",
    pipeline_order: 1,
    order_index: 10,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "first_call_in_progress",
    pipeline_key: "calls_ai",
    pipeline_label_es: "Agentes de Llamada",
    label_es: "Primera llamada en curso",
    description_es: "Primer intento",
    pipeline_order: 1,
    order_index: 20,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "no_answer_first_call",
    pipeline_key: "calls_ai",
    pipeline_label_es: "Agentes de Llamada",
    label_es: "No contesta primera llamada",
    description_es: "Sin respuesta",
    pipeline_order: 1,
    order_index: 30,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "second_call_scheduled",
    pipeline_key: "calls_ai",
    pipeline_label_es: "Agentes de Llamada",
    label_es: "Segunda llamada programada",
    description_es: "Reintento pendiente",
    pipeline_order: 1,
    order_index: 40,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "second_call_in_progress",
    pipeline_key: "calls_ai",
    pipeline_label_es: "Agentes de Llamada",
    label_es: "Segunda llamada en curso",
    description_es: "Reintento en marcha",
    pipeline_order: 1,
    order_index: 50,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "no_answer_second_call",
    pipeline_key: "calls_ai",
    pipeline_label_es: "Agentes de Llamada",
    label_es: "No contesta segunda llamada",
    description_es: "Escalado a WhatsApp",
    pipeline_order: 1,
    order_index: 60,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "contacting_whatsapp",
    pipeline_key: "whatsapp_ai",
    pipeline_label_es: "Agentes de WhatsApp",
    label_es: "Contactando por WhatsApp",
    description_es: "Primer contacto",
    pipeline_order: 2,
    order_index: 10,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "whatsapp_conversation_active",
    pipeline_key: "whatsapp_ai",
    pipeline_label_es: "Agentes de WhatsApp",
    label_es: "Conversación activa",
    description_es: "Detectando dolor y cierre",
    pipeline_order: 2,
    order_index: 20,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "whatsapp_followup_pending",
    pipeline_key: "whatsapp_ai",
    pipeline_label_es: "Agentes de WhatsApp",
    label_es: "Seguimiento pendiente",
    description_es: "Esperando respuesta",
    pipeline_order: 2,
    order_index: 30,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "whatsapp_failed_team_review",
    pipeline_key: "whatsapp_ai",
    pipeline_label_es: "Agentes de WhatsApp",
    label_es: "Revisión manual equipo",
    description_es: "No cerró por IA",
    pipeline_order: 2,
    order_index: 40,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "visit_scheduled",
    pipeline_key: "closed",
    pipeline_label_es: "Cerrados",
    label_es: "Agendado",
    description_es: "Cita confirmada",
    pipeline_order: 3,
    order_index: 10,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "post_visit_pending_decision",
    pipeline_key: "closed",
    pipeline_label_es: "Cerrados",
    label_es: "Pendiente decisión",
    description_es: "Está valorando la propuesta",
    pipeline_order: 3,
    order_index: 20,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "post_visit_follow_up",
    pipeline_key: "closed",
    pipeline_label_es: "Cerrados",
    label_es: "Seguimiento post-visita",
    description_es: "Requiere seguimiento",
    pipeline_order: 3,
    order_index: 30,
    is_terminal: false,
    is_active: true,
  },
  {
    stage_key: "post_visit_not_closed",
    pipeline_key: "closed",
    pipeline_label_es: "Cerrados",
    label_es: "No cerró tras visita",
    description_es: "No se cerró la venta",
    pipeline_order: 3,
    order_index: 40,
    is_terminal: true,
    is_active: true,
  },
  {
    stage_key: "client_closed",
    pipeline_key: "closed",
    pipeline_label_es: "Cerrados",
    label_es: "Cliente cerrado",
    description_es: "Venta cerrada",
    pipeline_order: 3,
    order_index: 50,
    is_terminal: true,
    is_active: true,
  },
  {
    stage_key: "not_interested",
    pipeline_key: "closed",
    pipeline_label_es: "Cerrados",
    label_es: "No interesado",
    description_es: "Cierre por rechazo",
    pipeline_order: 3,
    order_index: 60,
    is_terminal: true,
    is_active: true,
  },
  {
    stage_key: "discarded",
    pipeline_key: "closed",
    pipeline_label_es: "Cerrados",
    label_es: "Descartado",
    description_es: "Cierre interno",
    pipeline_order: 3,
    order_index: 70,
    is_terminal: true,
    is_active: true,
  },
];

function toLocalDate(value: string) {
  return new Date(value).toLocaleString("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

interface LeadCardProps {
  lead: Lead;
  onOpen: (lead: Lead) => void;
}

function LeadCard({ lead, onOpen }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: lead.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(lead)}
      className="w-full rounded-xl border border-border/80 bg-white px-3 py-3 text-left shadow-sm transition hover:border-primary/40 hover:shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-sm font-semibold text-foreground">{lead.full_name || "Lead sin nombre"}</p>
        <Badge variant="soft" className="max-w-36 shrink-0 truncate">{lead.treatment || "Tratamiento"}</Badge>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="truncate text-xs text-muted-foreground">{lead.phone || "Sin telefono"}</p>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{lead.source || "meta"}</p>
      </div>
      {lead.whatsapp_blocked ? (
        <div className="mt-2">
          <Badge variant="warning">WhatsApp bloqueado</Badge>
        </div>
      ) : null}
      {lead.stage_key === "post_visit_not_closed" && lead.post_visit_outcome_reason ? (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          Motivo: {lead.post_visit_outcome_reason}
        </p>
      ) : null}
      {lead.stage_key === "client_closed" && lead.converted_value_eur !== null && lead.converted_value_eur !== undefined ? (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          Cerrado: {Number(lead.converted_value_eur).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
        </p>
      ) : null}
    </button>
  );
}

function StageColumn({
  stage,
  leads,
  onOpen,
}: {
  stage: LeadStageCatalog;
  leads: Lead[];
  onOpen: (lead: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.stage_key });
  const tone = STAGE_TONE_ES[stage.stage_key] || {
    mood: "En curso",
    accent: "border-t-slate-300",
    badge: "default" as const,
    hint: stage.description_es || "",
  };

  return (
    <Card
      ref={setNodeRef}
      className={`h-[68vh] min-h-[500px] w-[84vw] max-w-[320px] shrink-0 overflow-hidden border bg-card/80 sm:h-[620px] sm:w-[290px] sm:max-w-none ${tone.accent} border-t-2 ${isOver ? "ring-2 ring-primary/30" : ""}`}
    >
      <div className="border-b border-border bg-white px-3 py-3">
        <p className="truncate text-sm font-semibold">{stage.label_es}</p>
        <p className="text-[11px] text-muted-foreground">{leads.length} oportunidades</p>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={tone.badge}>{tone.mood}</Badge>
          <p className="truncate text-[11px] text-muted-foreground">{tone.hint}</p>
        </div>
      </div>

      <div className="h-[calc(68vh-56px)] min-h-[444px] overflow-y-auto bg-muted/10 p-2 sm:h-[564px]">
        {leads.length ? (
          <SortableContext items={leads.map((lead) => lead.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {leads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} onOpen={onOpen} />
              ))}
            </div>
          </SortableContext>
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-white px-3 py-5 text-center text-sm text-muted-foreground">
            Sin leads en esta etapa
          </p>
        )}
      </div>
    </Card>
  );
}

export function PipelineBoard() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [stages, setStages] = useState<LeadStageCatalog[]>(FALLBACK_STAGES);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [leadHistory, setLeadHistory] = useState<LeadStageHistory[]>([]);
  const [updatingLeadBlock, setUpdatingLeadBlock] = useState(false);
  const [leadBlockError, setLeadBlockError] = useState<string | null>(null);
  const [leadConversionValue, setLeadConversionValue] = useState("");
  const [leadOutcomeReason, setLeadOutcomeReason] = useState("");
  const [savingLeadConversion, setSavingLeadConversion] = useState(false);
  const [leadConversionError, setLeadConversionError] = useState<string | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const visibleStages = useMemo(() => {
    return stages.filter((stage) => !HIDDEN_PIPELINES.has(stage.pipeline_key));
  }, [stages]);

  const stageMap = useMemo(() => {
    const map = new Map<string, LeadStageCatalog>();
    for (const stage of visibleStages) {
      map.set(stage.stage_key, stage);
    }
    return map;
  }, [visibleStages]);

  const resolveStageKey = useCallback(
    (lead: Pick<Lead, "stage_key" | "status">) => {
      const current = lead.stage_key || "";
      if (current && stageMap.has(current)) return current;

      const redirected = STAGE_REDIRECT_WHEN_HIDDEN[current];
      if (redirected && stageMap.has(redirected)) return redirected;

      const legacy = LEGACY_STAGE_FROM_STATUS[lead.status] || "new_lead";
      if (stageMap.has(legacy)) return legacy;

      return visibleStages[0]?.stage_key || "new_lead";
    },
    [stageMap, visibleStages]
  );

  const grouped = useMemo(() => {
    const map: Record<string, Lead[]> = {};
    for (const stage of visibleStages) {
      map[stage.stage_key] = [];
    }

    for (const lead of leads) {
      const stageKey = resolveStageKey(lead);
      if (map[stageKey]) map[stageKey].push({ ...lead, stage_key: stageKey });
    }

    return map;
  }, [leads, visibleStages, resolveStageKey]);

  const pipelines = useMemo(() => {
    const map = new Map<string, LeadStageCatalog[]>();
    for (const stage of visibleStages) {
      const list = map.get(stage.pipeline_key) || [];
      list.push(stage);
      map.set(stage.pipeline_key, list);
    }

    return Array.from(map.entries()).sort((a, b) => {
      const orderA = Math.min(...a[1].map((stage) => stage.pipeline_order));
      const orderB = Math.min(...b[1].map((stage) => stage.pipeline_order));
      return orderA - orderB;
    });
  }, [visibleStages]);

  const loadStages = useCallback(async () => {
    const { data } = await supabase
      .from("lead_stage_catalog")
      .select("*")
      .eq("is_active", true)
      .order("pipeline_order", { ascending: true })
      .order("order_index", { ascending: true });

    if (data && data.length) {
      setStages(data as LeadStageCatalog[]);
    }
  }, [supabase]);

  const loadLeads = useCallback(async () => {
    if (!clinicId) return;
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false });

    if (data) setLeads(data as Lead[]);
  }, [supabase, clinicId]);

  const loadLeadHistory = useCallback(
    async (leadId: string) => {
      if (!clinicId || !leadId) return;
      const { data } = await supabase
        .from("lead_stage_history")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(12);

      setLeadHistory((data || []) as LeadStageHistory[]);
    },
    [supabase, clinicId]
  );

  useEffect(() => {
    loadStages();
    loadLeads();
  }, [loadStages, loadLeads]);

  useEffect(() => {
    if (!clinicId || !activeLead?.id) return;
    loadLeadHistory(activeLead.id);
  }, [activeLead?.id, clinicId, loadLeadHistory]);

  useEffect(() => {
    if (!activeLead) return;
    const updated = leads.find((lead) => lead.id === activeLead.id);
    if (updated) {
      setActiveLead(updated);
    }
  }, [leads, activeLead]);

  useEffect(() => {
    if (!activeLead) {
      setLeadConversionValue("");
      setLeadOutcomeReason("");
      setLeadConversionError(null);
      return;
    }

    setLeadConversionValue(
      activeLead.converted_value_eur === null || activeLead.converted_value_eur === undefined
        ? ""
        : String(activeLead.converted_value_eur)
    );
    setLeadOutcomeReason(activeLead.post_visit_outcome_reason || "");
    setLeadConversionError(null);
  }, [activeLead]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel("pipeline-leads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `clinic_id=eq.${clinicId}` },
        loadLeads
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_stage_history", filter: `clinic_id=eq.${clinicId}` },
        () => {
          loadLeads();
          if (activeLead?.id) {
            loadLeadHistory(activeLead.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadLeads, loadLeadHistory, activeLead?.id]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !clinicId) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const currentLead = leads.find((lead) => lead.id === activeId);
    if (!currentLead) return;

    let newStage: string | null = null;

    if (stageMap.has(overId)) {
      newStage = overId;
    } else {
      const overLead = leads.find((lead) => lead.id === overId);
      if (overLead) {
        newStage = resolveStageKey(overLead);
      }
    }

    const currentStage = resolveStageKey(currentLead);
    if (!newStage || newStage === currentStage) return;

    const newStatus = LEGACY_STATUS_FROM_STAGE[newStage] || currentLead.status;
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === currentLead.id
          ? {
              ...lead,
              stage_key: newStage!,
              status: newStatus,
            }
          : lead
      )
    );

    const { data, error } = await supabase.rpc("rpc_transition_lead_stage", {
      p_clinic_id: clinicId,
      p_lead_id: currentLead.id,
      p_to_stage_key: newStage,
      p_reason: "Movimiento manual desde pipeline",
      p_actor_type: profile?.role || "staff",
      p_actor_id: profile?.user_id || null,
      p_meta: { source: "pipeline_board" },
    });

    const result = Array.isArray(data) ? data[0] : null;
    if (error || !result?.ok) {
      await loadLeads();
    }
  };

  const toggleLeadWhatsappBlock = async () => {
    if (!clinicId || !activeLead) return;

    const nextBlocked = !activeLead.whatsapp_blocked;
    setUpdatingLeadBlock(true);
    setLeadBlockError(null);

    const payload = {
      whatsapp_blocked: nextBlocked,
      whatsapp_blocked_at: nextBlocked ? new Date().toISOString() : null,
      whatsapp_blocked_by_user_id: nextBlocked ? profile?.user_id || null : null,
      whatsapp_blocked_reason: nextBlocked ? "Bloqueado manualmente desde pipeline" : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("leads")
      .update(payload)
      .eq("clinic_id", clinicId)
      .eq("id", activeLead.id)
      .select("*")
      .single();

    if (error) {
      setLeadBlockError(error.message);
      setUpdatingLeadBlock(false);
      return;
    }

    const updatedLead = data as Lead;
    setLeads((prev) => prev.map((lead) => (lead.id === updatedLead.id ? updatedLead : lead)));
    setActiveLead(updatedLead);

    await supabase.from("audit_log").insert({
      clinic_id: clinicId,
      entity_type: "lead",
      entity_id: updatedLead.id,
      action: nextBlocked ? "whatsapp_blocked" : "whatsapp_unblocked",
      meta: {
        source: "pipeline_board",
        actor_id: profile?.user_id || null,
      },
    });

    setUpdatingLeadBlock(false);
  };

  const updateLeadPostVisitOutcome = async (targetStage: string) => {
    if (!clinicId || !activeLead) return;

    const requiresValue = targetStage === "client_closed";
    const trimmedValue = leadConversionValue.trim();
    let parsedValue: number | null = null;

    if (requiresValue) {
      parsedValue = Number(trimmedValue.replace(",", "."));
      if (!trimmedValue || Number.isNaN(parsedValue) || parsedValue < 0) {
        setLeadConversionError("Indica un valor económico válido para marcar el lead como cliente.");
        return;
      }
    } else if (!leadOutcomeReason.trim()) {
      setLeadConversionError("Indica un motivo cuando el lead no se cierra.");
      return;
    }

    setSavingLeadConversion(true);
    setLeadConversionError(null);

    const result = await updateLeadOutcome({
      supabase,
      clinicId,
      leadId: activeLead.id,
      toStageKey: targetStage,
      actorType: profile?.role || "staff",
      actorId: profile?.user_id || null,
      source: "pipeline_board",
      convertedValueEur: requiresValue ? parsedValue : null,
      outcomeReason: requiresValue ? null : leadOutcomeReason.trim(),
    });

    if (!result.ok || !result.lead) {
      setLeadConversionError(result.error || "No se pudo guardar el resultado del lead.");
      setSavingLeadConversion(false);
      return;
    }

    const updatedLead = result.lead;
    setLeads((prev) => prev.map((lead) => (lead.id === updatedLead.id ? updatedLead : lead)));
    setActiveLead(updatedLead);
    if (requiresValue) {
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 2400);
    }

    setSavingLeadConversion(false);
  };

  const canManagePostVisitOutcome = useMemo(
    () =>
      activeLead
        ? [
            "visit_scheduled",
            "post_visit_pending_decision",
            "post_visit_follow_up",
            "post_visit_not_closed",
            "client_closed",
          ].includes(resolveStageKey(activeLead))
        : false,
    [activeLead, resolveStageKey]
  );

  return (
    <>
      <CelebrationOverlay open={showCelebration} />
      <div className="mb-4 rounded-xl border border-border bg-muted/20 p-3">
        <p className="text-sm font-semibold">Pipeline por etapas dinámicas</p>
        <p className="text-xs text-muted-foreground">Vista principal de llamadas y cierre.</p>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="space-y-6">
          {pipelines.map(([pipelineKey, stageList]) => (
            <div key={pipelineKey} className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-border bg-white px-4 py-3">
                <p className="text-sm font-semibold">
                  {stageList[0]?.pipeline_label_es || PIPELINE_LABELS_ES[pipelineKey] || pipelineKey}
                </p>
                <Badge variant="soft">
                  {stageList.reduce((acc, stage) => acc + (grouped[stage.stage_key]?.length || 0), 0)} leads
                </Badge>
              </div>

              <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max gap-3">
                  {stageList.map((stage) => (
                    <StageColumn
                      key={stage.stage_key}
                      stage={stage}
                      leads={grouped[stage.stage_key] || []}
                      onOpen={setActiveLead}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </DndContext>

      <Sheet
        open={!!activeLead}
        onOpenChange={(open) => {
          if (!open) {
            setLeadBlockError(null);
            setLeadConversionError(null);
            setActiveLead(null);
          }
        }}
      >
        <SheetContent>
          {activeLead ? (
            <div className="space-y-6">
              <div>
                <p className="text-sm text-muted-foreground">Lead</p>
                <p className="text-lg font-semibold">{activeLead.full_name || "Lead sin nombre"}</p>
              </div>

              <div className="grid gap-4">
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Etapa actual</p>
                  <p className="text-sm font-medium">
                    {stageMap.get(resolveStageKey(activeLead))?.label_es || resolveStageKey(activeLead) || "Sin etapa"}
                  </p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Telefono</p>
                  <p className="text-sm font-medium">{activeLead.phone || "No disponible"}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Tratamiento</p>
                  <p className="text-sm font-medium">{activeLead.treatment || "No especificado"}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Siguiente acción</p>
                  <p className="text-sm font-medium">
                    {activeLead.next_action_at ? toLocalDate(activeLead.next_action_at) : "Sin acción pendiente"}
                  </p>
                </Card>
                {canManagePostVisitOutcome ? (
                  <Card className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">Resultado tras la visita</p>
                      <Badge variant={activeLead.converted_to_client ? "success" : "soft"}>
                        {activeLead.converted_to_client ? "Cliente cerrado" : "Pendiente"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Tras la visita, decide aquí cómo queda el lead y, si cerró, anota el valor real del tratamiento.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={savingLeadConversion}
                        onClick={() => updateLeadPostVisitOutcome("post_visit_pending_decision")}
                      >
                        Pendiente decisión
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={savingLeadConversion}
                        onClick={() => updateLeadPostVisitOutcome("post_visit_follow_up")}
                      >
                        Seguimiento
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={savingLeadConversion}
                        onClick={() => updateLeadPostVisitOutcome("post_visit_not_closed")}
                      >
                        No cerró
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">Valor real del tratamiento (EUR)</p>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={leadConversionValue}
                        onChange={(event) => setLeadConversionValue(event.target.value)}
                        disabled={savingLeadConversion}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">Motivo si no cierra</p>
                      <Input
                        type="text"
                        placeholder="Ej. Lo quiere pensar, necesita seguimiento..."
                        value={leadOutcomeReason}
                        onChange={(event) => setLeadOutcomeReason(event.target.value)}
                        disabled={savingLeadConversion}
                      />
                    </div>
                    <Button
                      type="button"
                      disabled={savingLeadConversion}
                      onClick={() => updateLeadPostVisitOutcome("client_closed")}
                    >
                      {savingLeadConversion ? "Guardando..." : "Marcar como cliente cerrado"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {activeLead.converted_to_client
                        ? `Valor guardado: ${activeLead.converted_value_eur ?? 0} EUR`
                        : `Motivo guardado: ${activeLead.post_visit_outcome_reason || "Sin motivo"} · Usa una etapa de seguimiento o no cierre.`}
                    </p>
                    {leadConversionError ? <p className="text-xs text-rose-600">{leadConversionError}</p> : null}
                  </Card>
                ) : null}

                <Card className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Canal WhatsApp para este lead</p>
                    <Badge variant={activeLead.whatsapp_blocked ? "warning" : "success"}>
                      {activeLead.whatsapp_blocked ? "Bloqueado" : "Permitido"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Si está bloqueado, el flujo de WhatsApp no debe actuar sobre este lead (campo{" "}
                    <span className="font-medium text-foreground">leads.whatsapp_blocked</span>).
                  </p>
                  <Button
                    type="button"
                    variant={activeLead.whatsapp_blocked ? "default" : "outline"}
                    disabled={updatingLeadBlock}
                    onClick={toggleLeadWhatsappBlock}
                  >
                    {updatingLeadBlock
                      ? "Actualizando..."
                      : activeLead.whatsapp_blocked
                        ? "Permitir WhatsApp"
                        : "Bloquear WhatsApp"}
                  </Button>
                  {leadBlockError ? <p className="text-xs text-rose-600">{leadBlockError}</p> : null}
                </Card>
              </div>

              <div>
                <p className="text-sm font-medium">Historial de etapas</p>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {leadHistory.length ? (
                    leadHistory.map((item) => (
                      <p key={item.id}>
                        {toLocalDate(item.created_at)} · {stageMap.get(item.from_stage_key || "")?.label_es || item.from_stage_key || "Inicio"}
                        {" -> "}
                        {stageMap.get(item.to_stage_key)?.label_es || item.to_stage_key}
                      </p>
                    ))
                  ) : (
                    <p>Sin cambios de etapa registrados todavía.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
