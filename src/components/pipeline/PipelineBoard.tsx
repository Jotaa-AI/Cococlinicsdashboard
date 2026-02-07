"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Flame, PhoneCall, Snowflake } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Lead } from "@/lib/types";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/constants/lead-status";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const ACTIVE_PIPELINE_ORDER: LeadStatus[] = [
  "new",
  "whatsapp_sent",
  "call_done",
  "contacted",
  "visit_scheduled",
];

const OUTCOME_PIPELINE_ORDER: LeadStatus[] = [
  "no_response",
  "not_interested",
];

const PIPELINE_ORDER: LeadStatus[] = [...ACTIVE_PIPELINE_ORDER, ...OUTCOME_PIPELINE_ORDER];

const STAGE_META: Record<
  LeadStatus,
  {
    mood: string;
    stripe: string;
    badge: "success" | "warning" | "danger" | "default";
    hint: string;
    kind: "flow" | "outcome";
  }
> = {
  new: {
    mood: "Frío",
    stripe: "border-l-sky-400",
    badge: "default",
    hint: "Lead entrante sin contacto",
    kind: "flow",
  },
  whatsapp_sent: {
    mood: "Templado",
    stripe: "border-l-cyan-500",
    badge: "default",
    hint: "Primer alcance realizado",
    kind: "flow",
  },
  call_done: {
    mood: "Interés inicial",
    stripe: "border-l-blue-500",
    badge: "warning",
    hint: "Llamada ejecutada",
    kind: "flow",
  },
  contacted: {
    mood: "Caliente",
    stripe: "border-l-amber-500",
    badge: "warning",
    hint: "Conversación activa",
    kind: "flow",
  },
  visit_scheduled: {
    mood: "Muy caliente",
    stripe: "border-l-emerald-500",
    badge: "success",
    hint: "Cita cerrada",
    kind: "flow",
  },
  no_response: {
    mood: "En pausa",
    stripe: "border-l-zinc-400",
    badge: "danger",
    hint: "No respondió a seguimiento",
    kind: "outcome",
  },
  not_interested: {
    mood: "Descartado",
    stripe: "border-l-rose-400",
    badge: "danger",
    hint: "Rechazo explícito",
    kind: "outcome",
  },
};

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
        <Badge variant="soft" className="max-w-36 shrink-0 truncate">
          {lead.treatment || "Tratamiento"}
        </Badge>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{lead.phone || "Sin teléfono"}</p>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{lead.source || "meta"}</p>
      </div>
    </button>
  );
}

function StageSection({
  status,
  indexLabel,
  leads,
  collapsed,
  onToggle,
  onOpen,
}: {
  status: LeadStatus;
  indexLabel: string;
  leads: Lead[];
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (lead: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const stage = STAGE_META[status];

  return (
    <Card
      ref={setNodeRef}
      className={`overflow-hidden border-l-4 bg-card/80 ${stage.stripe} ${isOver ? "ring-2 ring-primary/30" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
            {indexLabel}
          </span>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{LEAD_STATUS_LABELS[status]}</p>
            <p className="truncate text-xs text-muted-foreground">{stage.hint}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={stage.badge}>{stage.mood}</Badge>
          <Badge variant="default">{leads.length} leads</Badge>
        </div>
      </button>

      {!collapsed ? (
        <div className="border-t border-border bg-muted/10 px-3 py-3">
          {leads.length ? (
            <SortableContext items={leads.map((lead) => lead.id)} strategy={verticalListSortingStrategy}>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
      ) : (
        <div className="border-t border-border bg-muted/20 px-4 py-2">
          <p className="text-xs text-muted-foreground">Etapa contraida. Pulsa para desplegar.</p>
        </div>
      )}
    </Card>
  );
}

export function PipelineBoard() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [collapsed, setCollapsed] = useState<Record<LeadStatus, boolean>>(() =>
    PIPELINE_ORDER.reduce((acc, status) => {
      acc[status] = true;
      return acc;
    }, {} as Record<LeadStatus, boolean>)
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const grouped = useMemo(() => {
    const map = PIPELINE_ORDER.reduce((acc, status) => {
      acc[status] = [];
      return acc;
    }, {} as Record<LeadStatus, Lead[]>);

    for (const lead of leads) {
      const status = lead.status as LeadStatus;
      if (map[status]) map[status].push(lead);
    }

    return map;
  }, [leads]);

  const loadLeads = useCallback(async () => {
    if (!clinicId) return;
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false });

    if (data) setLeads(data as Lead[]);
  }, [supabase, clinicId]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel("pipeline-leads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `clinic_id=eq.${clinicId}` },
        loadLeads
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadLeads]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeLead = leads.find((lead) => lead.id === activeId);
    if (!activeLead) return;

    let newStatus: LeadStatus | null = null;

    if (PIPELINE_ORDER.includes(overId as LeadStatus)) {
      newStatus = overId as LeadStatus;
    } else {
      const overLead = leads.find((lead) => lead.id === overId);
      if (overLead) newStatus = overLead.status as LeadStatus;
    }

    if (!newStatus || newStatus === activeLead.status) return;

    setLeads((prev) => prev.map((lead) => (lead.id === activeLead.id ? { ...lead, status: newStatus! } : lead)));

    await supabase.from("leads").update({ status: newStatus }).eq("id", activeLead.id);
    await supabase.from("audit_log").insert({
      clinic_id: clinicId,
      entity_type: "lead",
      entity_id: activeLead.id,
      action: "status_changed",
      meta: {
        from: activeLead.status,
        to: newStatus,
        moved_by: profile?.user_id,
      },
    });
  };

  return (
    <>
      <div className="mb-4 rounded-xl border border-border bg-muted/20 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Snowflake className="h-4 w-4" />
            <span>Flujo principal: de lead frio a lead caliente</span>
            <Flame className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setCollapsed(
                  PIPELINE_ORDER.reduce((acc, status) => {
                    acc[status] = false;
                    return acc;
                  }, {} as Record<LeadStatus, boolean>)
                )
              }
            >
              Desplegar todo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setCollapsed(
                  PIPELINE_ORDER.reduce((acc, status) => {
                    acc[status] = true;
                    return acc;
                  }, {} as Record<LeadStatus, boolean>)
                )
              }
            >
              Contraer todo
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <PhoneCall className="h-4 w-4" />
          <span>Arrastra tarjetas para cambiar etapa. El total se ve en cada titulo.</span>
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="px-1">
              <p className="text-sm font-semibold">Flujo comercial (frio a caliente)</p>
              <p className="text-xs text-muted-foreground">Etapas activas del lead hasta cierre de cita</p>
            </div>
            {ACTIVE_PIPELINE_ORDER.map((status, index) => (
              <StageSection
                key={status}
                status={status}
                indexLabel={`${index + 1}`}
                leads={grouped[status]}
                collapsed={collapsed[status]}
                onToggle={() => setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }))}
                onOpen={setActiveLead}
              />
            ))}
          </div>

          <div className="space-y-3">
            <div className="px-1">
              <p className="text-sm font-semibold">Estados de salida</p>
              <p className="text-xs text-muted-foreground">Leads que han salido del flujo principal</p>
            </div>
            {OUTCOME_PIPELINE_ORDER.map((status) => (
              <StageSection
                key={status}
                status={status}
                indexLabel={STAGE_META[status].kind === "outcome" ? "R" : "-"}
                leads={grouped[status]}
                collapsed={collapsed[status]}
                onToggle={() => setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }))}
                onOpen={setActiveLead}
              />
            ))}
          </div>
        </div>
      </DndContext>

      <Sheet open={!!activeLead} onOpenChange={(open) => !open && setActiveLead(null)}>
        <SheetContent>
          {activeLead ? (
            <div className="space-y-6">
              <div>
                <p className="text-sm text-muted-foreground">Lead</p>
                <p className="text-lg font-semibold">{activeLead.full_name || "Lead sin nombre"}</p>
              </div>

              <div className="grid gap-4">
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Estado actual</p>
                  <p className="text-sm font-medium">
                    {LEAD_STATUS_LABELS[(activeLead.status as LeadStatus) || "new"] || activeLead.status}
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
                  <p className="text-xs text-muted-foreground">Origen</p>
                  <p className="text-sm font-medium">{activeLead.source || "meta"}</p>
                </Card>
              </div>

              <div>
                <p className="text-sm font-medium">Historial de eventos</p>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <p>WhatsApp enviado · {activeLead.updated_at?.slice(0, 10)}</p>
                  <p>Llamada mas reciente · consultar en Calls</p>
                  <p>Cita asociada · consultar en Agenda</p>
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
