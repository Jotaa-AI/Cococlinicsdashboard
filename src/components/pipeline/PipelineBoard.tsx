"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Lead } from "@/lib/types";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/constants/lead-status";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
const PIPELINE_ORDER: LeadStatus[] = ["new", "whatsapp_sent", "call_done", "contacted", "visit_scheduled", "no_response", "not_interested"];

const STAGE_META: Record<
  LeadStatus,
  {
    mood: string;
    accent: string;
    badge: "success" | "warning" | "danger" | "default";
    hint: string;
  }
> = {
  new: {
    mood: "Frio",
    accent: "border-t-slate-300",
    badge: "default",
    hint: "Lead entrante sin contacto",
  },
  whatsapp_sent: {
    mood: "Templado",
    accent: "border-t-sky-400",
    badge: "default",
    hint: "Primer alcance realizado",
  },
  call_done: {
    mood: "Interés inicial",
    accent: "border-t-blue-500",
    badge: "warning",
    hint: "Llamada ejecutada",
  },
  contacted: {
    mood: "Caliente",
    accent: "border-t-amber-500",
    badge: "warning",
    hint: "Conversación activa",
  },
  visit_scheduled: {
    mood: "Muy caliente",
    accent: "border-t-emerald-500",
    badge: "success",
    hint: "Cita cerrada",
  },
  no_response: {
    mood: "En pausa",
    accent: "border-t-zinc-400",
    badge: "danger",
    hint: "No respondió a seguimiento",
  },
  not_interested: {
    mood: "Descartado",
    accent: "border-t-rose-400",
    badge: "danger",
    hint: "Rechazo explícito",
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
        <Badge variant="soft" className="max-w-32 shrink-0 truncate">{lead.treatment || "Tratamiento"}</Badge>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{lead.phone || "Sin telefono"}</p>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{lead.source || "meta"}</p>
      </div>
    </button>
  );
}

function StageColumn({
  status,
  leads,
  onOpen,
}: {
  status: LeadStatus;
  leads: Lead[];
  onOpen: (lead: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const stage = STAGE_META[status];

  return (
    <Card
      ref={setNodeRef}
      className={`h-[70vh] min-h-[520px] w-[84vw] max-w-[320px] shrink-0 overflow-hidden border bg-card/80 sm:h-[640px] sm:w-[290px] sm:max-w-none ${stage.accent} border-t-2 ${isOver ? "ring-2 ring-primary/30" : ""}`}
    >
      <div className="border-b border-border bg-white px-3 py-3">
        <p className="truncate text-sm font-semibold">{LEAD_STATUS_LABELS[status]}</p>
        <p className="text-[11px] text-muted-foreground">{leads.length} oportunidades</p>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={stage.badge}>{stage.mood}</Badge>
          <p className="truncate text-[11px] text-muted-foreground">{stage.hint}</p>
        </div>
      </div>

      <div className="h-[calc(70vh-56px)] min-h-[464px] overflow-y-auto bg-muted/10 p-2 sm:h-[584px]">
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

  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

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
        <p className="text-sm font-semibold">Pipeline por etapas</p>
        <p className="text-xs text-muted-foreground">
          Vista tipo kanban. Arrastra tarjetas entre columnas para actualizar estado.
        </p>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max gap-3">
            {PIPELINE_ORDER.map((status) => (
              <StageColumn
                key={status}
                status={status}
                leads={grouped[status]}
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
