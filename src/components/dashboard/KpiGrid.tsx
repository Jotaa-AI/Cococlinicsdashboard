"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addMonths, format, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Appointment, Call, Lead } from "@/lib/types";
import {
  getLeadClosedTimestamp,
  getLeadKeyFromAppointment,
  getLeadKeyFromCall,
  getLeadKeyFromLead,
  getReferenceTimestamp,
  inRange,
  isAiAppointment,
  isLeadClosed,
  isScheduledAiAppointment,
  median,
  parseNumeric,
} from "@/lib/dashboard/aiMetrics";

interface DashboardMetrics {
  leadsEntered: number;
  leadsCalled: number;
  leadsWithAiAppointment: number;
  leadsClosedAi: number;
  aiRevenue: number;
  aiRevenueLeadCount: number;
  totalCallCost: number;
  roiMultiple: number | null;
  costPerAiAppointment: number | null;
  costPerAiClose: number | null;
  noResponseCount: number;
  noResponseRate: number;
  medianLeadToCallMinutes: number | null;
  medianCallToAiAppointmentMinutes: number | null;
}

const currencyFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const decimalFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function formatDuration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  if (!remainingMinutes) return `${hours} h`;
  if (hours < 24) return `${hours} h ${remainingMinutes} min`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (!remHours) return `${days} d`;
  return `${days} d ${remHours} h`;
}

function ratioFrom(previous: number, current: number) {
  if (!previous) return 0;
  return Number(((current / previous) * 100).toFixed(1));
}

interface FunnelStep {
  label: string;
  value: number;
  note: string;
}

export function KpiGrid() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    leadsEntered: 0,
    leadsCalled: 0,
    leadsWithAiAppointment: 0,
    leadsClosedAi: 0,
    aiRevenue: 0,
    aiRevenueLeadCount: 0,
    totalCallCost: 0,
    roiMultiple: null,
    costPerAiAppointment: null,
    costPerAiClose: null,
    noResponseCount: 0,
    noResponseRate: 0,
    medianLeadToCallMinutes: null,
    medianCallToAiAppointmentMinutes: null,
  });

  const monthLabel = useMemo(() => {
    const label = format(selectedMonth, "MMMM yyyy", { locale: es });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [selectedMonth]);

  const monthRange = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end = addMonths(start, 1);
    return {
      start,
      end,
      startMs: start.getTime(),
      endMs: end.getTime(),
    };
  }, [selectedMonth]);

  const loadMetrics = useCallback(async () => {
    if (!clinicId) return;

    const [leadsResult, callsResult, appointmentsResult] = await Promise.all([
      supabase
        .from("leads")
        .select(
          "id, phone, created_at, converted_to_client, converted_at, converted_value_eur, stage_key, updated_at"
        )
        .eq("clinic_id", clinicId),
      supabase
        .from("calls")
        .select("lead_id, phone, status, started_at, ended_at, created_at, call_cost_eur, outcome")
        .eq("clinic_id", clinicId)
        .eq("status", "ended"),
      supabase
        .from("appointments")
        .select("lead_id, lead_phone, status, source_channel, created_at, start_at, entry_type")
        .eq("clinic_id", clinicId),
    ]);

    const leads = ((leadsResult.data || []) as Lead[]).filter(Boolean);
    const calls = ((callsResult.data || []) as Call[]).filter(Boolean);
    const appointments = ((appointmentsResult.data || []) as Appointment[]).filter(Boolean);

    const leadsEnteredKeys = new Set<string>();
    const leadCreatedAtByKey = new Map<string, number>();

    for (const lead of leads) {
      const key = getLeadKeyFromLead(lead);
      if (!key) continue;
      const createdAt = getReferenceTimestamp(lead.created_at);
      if (createdAt !== null) {
        const current = leadCreatedAtByKey.get(key);
        if (current === undefined || createdAt < current) leadCreatedAtByKey.set(key, createdAt);
      }
      if (inRange(createdAt, monthRange.startMs, monthRange.endMs)) leadsEnteredKeys.add(key);
    }

    const callsInMonth = calls.filter((call) =>
      inRange(getReferenceTimestamp(call.ended_at, call.started_at, call.created_at), monthRange.startMs, monthRange.endMs)
    );

    const calledLeadKeys = new Set<string>();
    const latestCallByLead = new Map<string, Call>();
    const earliestCallByLead = new Map<string, number>();

    for (const call of calls) {
      const key = getLeadKeyFromCall(call);
      const timestamp = getReferenceTimestamp(call.ended_at, call.started_at, call.created_at);
      if (!key || timestamp === null) continue;
      const currentFirst = earliestCallByLead.get(key);
      if (currentFirst === undefined || timestamp < currentFirst) earliestCallByLead.set(key, timestamp);
    }

    let totalCallCost = 0;
    for (const call of callsInMonth) {
      const key = getLeadKeyFromCall(call);
      const timestamp = getReferenceTimestamp(call.ended_at, call.started_at, call.created_at);
      if (!key || timestamp === null) continue;
      calledLeadKeys.add(key);
      totalCallCost += parseNumeric(call.call_cost_eur) || 0;
      const currentLatest = latestCallByLead.get(key);
      const currentLatestTs = currentLatest
        ? getReferenceTimestamp(currentLatest.ended_at, currentLatest.started_at, currentLatest.created_at)
        : null;
      if (currentLatestTs === null || timestamp > currentLatestTs) latestCallByLead.set(key, call);
    }

    const aiAppointmentsAll = appointments.filter((appointment) => isAiAppointment(appointment) && appointment.status !== "canceled");
    const aiAttributionKeys = new Set(
      aiAppointmentsAll
        .map((appointment) => getLeadKeyFromAppointment(appointment))
        .filter((value): value is string => Boolean(value))
    );

    const aiAppointmentsInMonth = appointments.filter((appointment) => {
      if (!isScheduledAiAppointment(appointment)) return false;
      const timestamp = getReferenceTimestamp(appointment.created_at, appointment.start_at);
      return inRange(timestamp, monthRange.startMs, monthRange.endMs);
    });

    const aiBookedLeadKeys = new Set(
      aiAppointmentsInMonth
        .map((appointment) => getLeadKeyFromAppointment(appointment))
        .filter((value): value is string => Boolean(value))
    );

    for (const call of callsInMonth) {
      if (call.outcome !== "appointment_scheduled") continue;
      const key = getLeadKeyFromCall(call);
      if (key) aiBookedLeadKeys.add(key);
    }

    const aiClosedLeadKeys = new Set<string>();
    let aiRevenue = 0;

    for (const lead of leads) {
      if (!isLeadClosed(lead)) continue;
      const key = getLeadKeyFromLead(lead);
      if (!key || !aiAttributionKeys.has(key)) continue;
      const closedTs = getReferenceTimestamp(getLeadClosedTimestamp(lead));
      if (!inRange(closedTs, monthRange.startMs, monthRange.endMs)) continue;
      const convertedValue = parseNumeric(lead.converted_value_eur);
      if (!convertedValue || convertedValue <= 0) continue;
      aiClosedLeadKeys.add(key);
      aiRevenue += convertedValue;
    }

    const leadToCallDiffs: number[] = [];
    for (const key of leadsEnteredKeys) {
      const leadCreatedAt = leadCreatedAtByKey.get(key);
      const firstCallAt = earliestCallByLead.get(key);
      if (leadCreatedAt === undefined || firstCallAt === undefined) continue;
      if (firstCallAt >= leadCreatedAt) leadToCallDiffs.push((firstCallAt - leadCreatedAt) / 60000);
    }

    const firstAiAppointmentByLead = new Map<string, number>();
    for (const appointment of aiAppointmentsInMonth) {
      const key = getLeadKeyFromAppointment(appointment);
      const timestamp = getReferenceTimestamp(appointment.created_at, appointment.start_at);
      if (!key || timestamp === null) continue;
      const current = firstAiAppointmentByLead.get(key);
      if (current === undefined || timestamp < current) firstAiAppointmentByLead.set(key, timestamp);
    }

    const callToAppointmentDiffs: number[] = [];
    for (const [key, appointmentTs] of firstAiAppointmentByLead.entries()) {
      const firstCallAt = earliestCallByLead.get(key);
      if (firstCallAt === undefined || appointmentTs < firstCallAt) continue;
      callToAppointmentDiffs.push((appointmentTs - firstCallAt) / 60000);
    }

    const noResponseCount = Array.from(latestCallByLead.values()).filter(
      (call) => call.outcome === "no_response"
    ).length;

    const calledLeadCount = calledLeadKeys.size;
    const aiBookedLeadCount = aiBookedLeadKeys.size;
    const aiClosedLeadCount = aiClosedLeadKeys.size;

    setMetrics({
      leadsEntered: leadsEnteredKeys.size,
      leadsCalled: calledLeadCount,
      leadsWithAiAppointment: aiBookedLeadCount,
      leadsClosedAi: aiClosedLeadCount,
      aiRevenue: Number(aiRevenue.toFixed(2)),
      aiRevenueLeadCount: aiClosedLeadCount,
      totalCallCost: Number(totalCallCost.toFixed(2)),
      roiMultiple: totalCallCost > 0 ? Number((aiRevenue / totalCallCost).toFixed(1)) : null,
      costPerAiAppointment:
        aiBookedLeadCount > 0 ? Number((totalCallCost / aiBookedLeadCount).toFixed(2)) : null,
      costPerAiClose: aiClosedLeadCount > 0 ? Number((totalCallCost / aiClosedLeadCount).toFixed(2)) : null,
      noResponseCount,
      noResponseRate: calledLeadCount > 0 ? Number(((noResponseCount / calledLeadCount) * 100).toFixed(1)) : 0,
      medianLeadToCallMinutes: median(leadToCallDiffs),
      medianCallToAiAppointmentMinutes: median(callToAppointmentDiffs),
    });
  }, [clinicId, monthRange.endMs, monthRange.startMs, supabase]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase
      .channel("ai-dashboard-metrics")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `clinic_id=eq.${clinicId}` },
        loadMetrics
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls", filter: `clinic_id=eq.${clinicId}` },
        loadMetrics
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        loadMetrics
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, loadMetrics, supabase]);

  const funnelSteps = useMemo<FunnelStep[]>(
    () => [
      { label: "Leads entrados", value: metrics.leadsEntered, note: monthLabel },
      {
        label: "Leads llamados",
        value: metrics.leadsCalled,
        note: `${percentFormatter.format(ratioFrom(metrics.leadsEntered, metrics.leadsCalled))}% del paso anterior`,
      },
      {
        label: "Leads con cita IA",
        value: metrics.leadsWithAiAppointment,
        note: `${percentFormatter.format(ratioFrom(metrics.leadsCalled, metrics.leadsWithAiAppointment))}% del paso anterior`,
      },
      {
        label: "Leads cerrados",
        value: metrics.leadsClosedAi,
        note: `${percentFormatter.format(ratioFrom(metrics.leadsWithAiAppointment, metrics.leadsClosedAi))}% del paso anterior`,
      },
    ],
    [metrics, monthLabel]
  );

  const primaryCards = [
    {
      label: "Ingresos atribuidos a IA",
      value: currencyFormatter.format(metrics.aiRevenue),
      note: monthLabel,
      detail:
        metrics.aiRevenueLeadCount === 1
          ? "1 lead cerrado con cita IA"
          : `${metrics.aiRevenueLeadCount} leads cerrados con cita IA`,
    },
    {
      label: "ROI IA",
      value: metrics.roiMultiple === null ? "—" : `${decimalFormatter.format(metrics.roiMultiple)}x`,
      note: monthLabel,
      detail:
        metrics.roiMultiple === null
          ? "Sin coste de llamadas en el mes"
          : `${currencyFormatter.format(metrics.totalCallCost)} invertidos · ${currencyFormatter.format(metrics.aiRevenue)} cerrados`,
    },
    {
      label: "Coste por cita IA",
      value: metrics.costPerAiAppointment === null ? "—" : currencyFormatter.format(metrics.costPerAiAppointment),
      note: monthLabel,
      detail:
        metrics.leadsWithAiAppointment === 1
          ? "1 lead con cita IA"
          : `${metrics.leadsWithAiAppointment} leads con cita IA`,
    },
    {
      label: "Coste por cierre IA",
      value: metrics.costPerAiClose === null ? "—" : currencyFormatter.format(metrics.costPerAiClose),
      note: monthLabel,
      detail:
        metrics.leadsClosedAi === 1 ? "1 lead cerrado atribuido a IA" : `${metrics.leadsClosedAi} leads cerrados atribuidos a IA`,
    },
  ];

  const secondaryCards = [
    {
      label: "No responde",
      value: `${percentFormatter.format(metrics.noResponseRate)}%`,
      note: monthLabel,
      detail: `${metrics.noResponseCount} de ${metrics.leadsCalled} leads llamados`,
    },
    {
      label: "Lead -> primera llamada",
      value: formatDuration(metrics.medianLeadToCallMinutes),
      note: "Mediana del periodo",
      detail: "Tiempo desde alta del lead hasta la primera llamada", 
    },
    {
      label: "Primera llamada -> cita IA",
      value: formatDuration(metrics.medianCallToAiAppointmentMinutes),
      note: "Mediana del periodo",
      detail: "Solo leads con cita creada por la IA de llamadas",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8"
          onClick={() => setSelectedMonth((prev) => addMonths(prev, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="min-w-40 text-center text-sm font-medium text-muted-foreground">{monthLabel}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8"
          onClick={() => setSelectedMonth((prev) => addMonths(prev, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Embudo IA</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {funnelSteps.map((step, index) => (
              <div
                key={step.label}
                className="rounded-2xl border bg-gradient-to-br from-background via-background to-muted/30 p-4"
              >
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  Paso {index + 1}
                </p>
                <p className="mt-2 text-sm font-medium text-muted-foreground">{step.label}</p>
                <p className="font-display mt-3 text-4xl font-semibold">{step.value}</p>
                <p className="mt-2 text-xs font-medium text-foreground/75">{step.note}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {primaryCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="font-display text-2xl font-semibold sm:text-3xl">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.note}</p>
              <p className="text-xs font-medium text-foreground/80">{card.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {secondaryCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="font-display text-2xl font-semibold sm:text-3xl">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.note}</p>
              <p className="text-xs font-medium text-foreground/80">{card.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
