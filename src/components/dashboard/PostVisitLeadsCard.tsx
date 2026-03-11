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

interface VisitSections {
  today: PostVisitLeadRow[];
  review: PostVisitLeadRow[];
}

function normalizePhone(rawPhone?: string | null) {
  if (!rawPhone) return null;
  let digits = rawPhone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("34")) digits = digits.slice(2);
  if (!/^\d{9}$/.test(digits)) return null;
  return `+34${digits}`;
}

function startOfTomorrowIso() {
  const now = new Date();
  now.setHours(24, 0, 0, 0);
  return now.toISOString();
}

function madridDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  const day = parts.find((part) => part.type === "day")?.value || "00";
  return `${year}-${month}-${day}`;
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

    const orderedAppointments = ((appointmentsData || []) as Appointment[]).filter(
      (appointment) => appointment.entry_type !== "internal_block"
    );

    const firstVisitByLead = new Map<string, Appointment>();
    for (const appointment of orderedAppointments) {
      const key =
        appointment.lead_id ||
        normalizePhone(appointment.lead_phone) ||
        appointment.lead_name?.trim().toLowerCase() ||
        appointment.id;
      if (!firstVisitByLead.has(key)) firstVisitByLead.set(key, appointment);
    }

    const dedupedAppointments = [...firstVisitByLead.values()].sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );

    const leadIds = Array.from(new Set(dedupedAppointments.map((item) => item.lead_id).filter(Boolean))) as string[];
    const leadPhones = Array.from(
      new Set(dedupedAppointments.map((item) => normalizePhone(item.lead_phone)).filter(Boolean))
    ) as string[];
    const leadNames = Array.from(
      new Set(
        dedupedAppointments
          .filter((item) => !item.lead_id && !normalizePhone(item.lead_phone))
          .map((item) => item.lead_name?.trim())
          .filter(Boolean)
      )
    ) as string[];
    let leadMap = new Map<string, Lead>();
    let leadPhoneMap = new Map<string, Lead>();
    let leadNameMap = new Map<string, Lead>();

    if (leadIds.length || leadPhones.length || leadNames.length) {
      const [leadsByIdResult, leadsByPhoneResult, leadsByNameResult] = await Promise.all([
        leadIds.length
          ? supabase.from("leads").select("*").eq("clinic_id", clinicId).in("id", leadIds)
          : Promise.resolve({ data: [] as Lead[] }),
        leadPhones.length
          ? supabase.from("leads").select("*").eq("clinic_id", clinicId).in("phone", leadPhones)
          : Promise.resolve({ data: [] as Lead[] }),
        leadNames.length
          ? supabase.from("leads").select("*").eq("clinic_id", clinicId).in("full_name", leadNames)
          : Promise.resolve({ data: [] as Lead[] }),
      ]);

      leadMap = new Map(((leadsByIdResult.data || []) as Lead[]).map((lead) => [lead.id, lead]));
      leadPhoneMap = new Map(
        ((leadsByPhoneResult.data || []) as Lead[])
          .map((lead) => [normalizePhone(lead.phone), lead] as const)
          .filter((entry): entry is [string, Lead] => Boolean(entry[0]))
      );
      leadNameMap = new Map(
        ((leadsByNameResult.data || []) as Lead[])
          .map((lead) => [lead.full_name?.trim().toLowerCase(), lead] as const)
          .filter((entry): entry is [string, Lead] => Boolean(entry[0]))
      );
    }

    const nextRows = dedupedAppointments
      .map((appointment) => {
        const normalizedPhone = normalizePhone(appointment.lead_phone);
        const normalizedName = appointment.lead_name?.trim().toLowerCase() || null;
        const lead =
          (appointment.lead_id ? leadMap.get(appointment.lead_id) : null) ||
          (normalizedPhone ? leadPhoneMap.get(normalizedPhone) : null) ||
          (normalizedName ? leadNameMap.get(normalizedName) : null) ||
          null;

        return {
          appointment,
          lead,
        };
      })
      .filter((row) => !row.lead || (row.lead.stage_key !== "client_closed" && !row.lead.converted_to_client)) as PostVisitLeadRow[];

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

  const visitSections = useMemo<VisitSections>(() => {
    const todayKey = madridDateKey(new Date());
    const nowTs = Date.now();
    const today: PostVisitLeadRow[] = [];
    const review: PostVisitLeadRow[] = [];

    for (const row of rows) {
      const appointmentKey = madridDateKey(row.appointment.start_at);
      const appointmentTs = new Date(row.appointment.start_at).getTime();

      if (appointmentKey > todayKey) continue;

      if (appointmentKey === todayKey && appointmentTs > nowTs) {
        today.push(row);
        continue;
      }

      review.push(row);
    }

    return { today, review };
  }, [rows]);

  const summaryLabel = useMemo(() => {
    const totalVisible = visitSections.today.length + visitSections.review.length;
    if (!totalVisible) return "Sin citas para gestionar";
    if (totalVisible === 1) return "1 cita para gestionar";
    return `${totalVisible} citas para gestionar`;
  }, [visitSections.review.length, visitSections.today.length]);

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
          <CardTitle>Visitas de hoy y pendientes de cierre</CardTitle>
          <Badge variant="soft">{summaryLabel}</Badge>
        </CardHeader>
        <CardContent>
          {visitSections.today.length || visitSections.review.length ? (
            <div className="space-y-4">
              {visitSections.today.length ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" />
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                      Citas de hoy por atender
                    </p>
                  </div>

                  {visitSections.today.map((row) => {
                    const lead = row.lead;
                    const leadId = lead?.id || row.appointment.id;

                    return (
                      <div
                        key={leadId}
                        className="relative overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 via-white to-cyan-50 p-4 shadow-sm ring-1 ring-sky-100"
                      >
                        <div className="absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-sky-500" />
                        <div className="flex flex-col gap-2 pl-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold">
                              {lead?.full_name || row.appointment.lead_name || "Lead sin nombre"}
                            </p>
                            <p className="text-xs text-slate-600">
                              Hoy a las {formatVisitDate(row.appointment.start_at).slice(-5)} ·{" "}
                              {row.appointment.title || "Valoración gratuita"}
                            </p>
                            <p className="text-xs text-slate-500">
                              Teléfono: {lead?.phone || row.appointment.lead_phone || "—"}
                            </p>
                          </div>
                          <Badge variant="soft">Hoy</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {visitSections.review.length ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-700">
                      Revisar y actualizar estado
                    </p>
                  </div>

                  {visitSections.review.map((row) => {
                const lead = row.lead;
                const leadId = lead?.id || row.appointment.id;
                const saving = savingLeadId === lead?.id;

                return (
                  <div key={leadId} className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
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
                    ) : (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Esta cita no tiene un lead vinculado en Supabase. Revisa el teléfono o el lead asociado antes de
                        marcar el cierre.
                      </div>
                    )}
                  </div>
                );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hay citas de hoy ni visitas pendientes de revisión.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
