"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Appointment, Lead } from "@/lib/types";
import { updateLeadOutcome } from "@/lib/leads/update-lead-outcome";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CelebrationOverlay } from "@/components/ui/celebration-overlay";

interface PostVisitLeadRow {
  appointment: Appointment;
  lead: Lead | null;
}

function startOfTomorrowIso() {
  const now = new Date();
  now.setHours(24, 0, 0, 0);
  return now.toISOString();
}

function formatVisitDate(value: string) {
  const date = new Date(value);
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function PostVisitLeadsCard() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [rows, setRows] = useState<PostVisitLeadRow[]>([]);
  const [valueByLeadId, setValueByLeadId] = useState<Record<string, string>>({});
  const [serviceByLeadId, setServiceByLeadId] = useState<Record<string, string>>({});
  const [reasonByLeadId, setReasonByLeadId] = useState<Record<string, string>>({});
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const [errorByLeadId, setErrorByLeadId] = useState<Record<string, string>>({});
  const [showCelebration, setShowCelebration] = useState(false);

  const loadRows = useCallback(async () => {
    if (!clinicId) return;

    const { data: appointmentsData } = await supabase
      .from("appointments")
      .select("*")
      .eq("clinic_id", clinicId)
      .neq("status", "canceled")
      .lt("start_at", startOfTomorrowIso())
      .order("start_at", { ascending: true });

    const orderedAppointments = (appointmentsData || []) as Appointment[];

    const firstVisitByLead = new Map<string, Appointment>();
    for (const appointment of orderedAppointments) {
      if (appointment.lead_id) {
        if (!firstVisitByLead.has(appointment.lead_id)) {
          firstVisitByLead.set(appointment.lead_id, appointment);
        }
      }
    }

    const dedupedAppointments = [...firstVisitByLead.values()].sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );

    const leadIds = Array.from(new Set(dedupedAppointments.map((item) => item.lead_id).filter(Boolean))) as string[];
    let leadMap = new Map<string, Lead>();

    if (leadIds.length) {
      const { data: leadsData } = await supabase
        .from("leads")
        .select("*")
        .eq("clinic_id", clinicId)
        .in("id", leadIds);

      leadMap = new Map(((leadsData || []) as Lead[]).map((lead) => [lead.id, lead]));
    }

    const nextRows = dedupedAppointments
      .map((appointment) => ({
        appointment,
        lead: appointment.lead_id ? leadMap.get(appointment.lead_id) || null : null,
      }))
      .filter((row) => row.lead && row.lead.stage_key !== "client_closed" && !row.lead.converted_to_client) as PostVisitLeadRow[];

    setRows(nextRows);

    setValueByLeadId((prev) => {
      const next = { ...prev };
      for (const row of nextRows) {
        if (!row.lead) continue;
        if (!(row.lead.id in next)) {
          next[row.lead.id] =
            row.lead.converted_value_eur === null || row.lead.converted_value_eur === undefined
              ? ""
              : String(row.lead.converted_value_eur);
        }
      }
      return next;
    });

    setServiceByLeadId((prev) => {
      const next = { ...prev };
      for (const row of nextRows) {
        if (!row.lead) continue;
        if (!(row.lead.id in next)) {
          next[row.lead.id] = row.lead.converted_service_name || row.lead.treatment || "";
        }
      }
      return next;
    });

    setReasonByLeadId((prev) => {
      const next = { ...prev };
      for (const row of nextRows) {
        if (!row.lead) continue;
        if (!(row.lead.id in next)) {
          next[row.lead.id] = row.lead.post_visit_outcome_reason || "";
        }
      }
      return next;
    });
  }, [supabase, clinicId]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel("post-visit-leads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        loadRows
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `clinic_id=eq.${clinicId}` },
        loadRows
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadRows]);

  const summaryLabel = useMemo(() => {
    if (!rows.length) return "Sin primeras visitas pendientes";
    if (rows.length === 1) return "1 primera visita pendiente de gestión";
    return `${rows.length} primeras visitas pendientes de gestión`;
  }, [rows.length]);

  const setOutcome = useCallback(
    async (row: PostVisitLeadRow, targetStage: string) => {
      if (!clinicId || !row.lead) return;

      const lead = row.lead;
      const rawValue = (valueByLeadId[lead.id] || "").trim();
      const rawService = (serviceByLeadId[lead.id] || "").trim();
      const rawReason = (reasonByLeadId[lead.id] || "").trim();
      const needsValue = targetStage === "client_closed";
      let parsedValue: number | null = null;

      if (needsValue) {
        parsedValue = Number(rawValue.replace(",", "."));
        if (!rawValue || Number.isNaN(parsedValue) || parsedValue < 0) {
          setErrorByLeadId((prev) => ({
            ...prev,
            [lead.id]: "Indica un valor válido para cerrar el lead como cliente.",
          }));
          return;
        }
        if (!rawService) {
          setErrorByLeadId((prev) => ({
            ...prev,
            [lead.id]: "Indica el servicio cerrado para guardar la conversión.",
          }));
          return;
        }
      } else if (!rawReason) {
        setErrorByLeadId((prev) => ({
          ...prev,
          [lead.id]: "Indica un motivo si el lead no ha cerrado.",
        }));
        return;
      }

      setSavingLeadId(lead.id);
      setErrorByLeadId((prev) => ({ ...prev, [lead.id]: "" }));

      const result = await updateLeadOutcome({
        supabase,
        clinicId,
        leadId: lead.id,
        toStageKey: targetStage,
        actorType: profile?.role || "staff",
        actorId: profile?.user_id || null,
        source: "dashboard_post_visit",
        convertedValueEur: needsValue ? parsedValue : null,
        convertedServiceName: needsValue ? rawService : null,
        outcomeReason: needsValue ? null : rawReason,
      });

      if (!result.ok) {
        setErrorByLeadId((prev) => ({
          ...prev,
          [lead.id]: result.error || "No se pudo actualizar el lead.",
        }));
        setSavingLeadId(null);
        return;
      }

      if (needsValue) {
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 2400);
      }

      setSavingLeadId(null);
      await loadRows();
    },
    [clinicId, profile?.role, profile?.user_id, reasonByLeadId, serviceByLeadId, supabase, valueByLeadId, loadRows]
  );

  return (
    <>
      <CelebrationOverlay open={showCelebration} />
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Primeras visitas pendientes de cierre</CardTitle>
          <Badge variant="soft">{summaryLabel}</Badge>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <div className="space-y-4">
              {rows.map((row) => {
                const lead = row.lead;
                const leadId = lead?.id || row.appointment.id;
                const saving = savingLeadId === lead?.id;

                return (
                  <div key={leadId} className="rounded-2xl border border-border bg-white p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          {lead?.full_name || row.appointment.lead_name || "Lead sin nombre"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Primera visita: {formatVisitDate(row.appointment.start_at)} · {row.appointment.title || "Valoración gratuita"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Estado actual: {lead?.stage_key || "Sin etapa"} · Teléfono: {lead?.phone || row.appointment.lead_phone || "—"}
                        </p>
                      </div>
                      <Badge variant={lead?.converted_to_client ? "success" : "default"}>
                        {lead?.converted_to_client ? "Cliente cerrado" : "Sin cierre"}
                      </Badge>
                    </div>

                    {lead ? (
                      <div className="mt-4 space-y-3">
                        <div className="space-y-1.5">
                          <p className="text-xs text-muted-foreground">Motivo si no cierra</p>
                          <Input
                            placeholder="Ej. Lo quiere pensar, presupuesto alto, necesita seguimiento..."
                            value={reasonByLeadId[lead.id] || ""}
                            onChange={(event) =>
                              setReasonByLeadId((prev) => ({
                                ...prev,
                                [lead.id]: event.target.value,
                              }))
                            }
                            disabled={saving}
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" disabled={saving} onClick={() => setOutcome(row, "post_visit_pending_decision")}>
                            Pendiente decisión
                          </Button>
                          <Button type="button" variant="outline" disabled={saving} onClick={() => setOutcome(row, "post_visit_follow_up")}>
                            Seguimiento
                          </Button>
                          <Button type="button" variant="outline" disabled={saving} onClick={() => setOutcome(row, "post_visit_not_closed")}>
                            No cerró
                          </Button>
                        </div>

                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-muted-foreground">Servicio que se ha cerrado</p>
                          <Input
                            type="text"
                            placeholder="Servicio cerrado (ej. Indiba facial, ácido hialurónico...)"
                            value={serviceByLeadId[lead.id] || ""}
                            onChange={(event) =>
                              setServiceByLeadId((prev) => ({
                                ...prev,
                                [lead.id]: event.target.value,
                              }))
                            }
                            disabled={saving}
                          />
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="Valor real del cierre (EUR)"
                            value={valueByLeadId[lead.id] || ""}
                            onChange={(event) =>
                              setValueByLeadId((prev) => ({
                                ...prev,
                                [lead.id]: event.target.value,
                              }))
                            }
                            disabled={saving}
                          />
                          <Button type="button" disabled={saving} onClick={() => setOutcome(row, "client_closed")}>
                            {saving ? "Guardando..." : "Cerrar cliente"}
                          </Button>
                        </div>

                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>
                            Valor guardado:{" "}
                            {lead.converted_value_eur === null || lead.converted_value_eur === undefined
                              ? "—"
                              : `${lead.converted_value_eur} EUR`}
                          </span>
                          <span>Servicio guardado: {lead.converted_service_name || "—"}</span>
                          <span>Motivo guardado: {lead.post_visit_outcome_reason || "—"}</span>
                        </div>

                        {errorByLeadId[lead.id] ? (
                          <p className="text-xs text-rose-600">{errorByLeadId[lead.id]}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hay primeras visitas pendientes de cierre hasta hoy.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
