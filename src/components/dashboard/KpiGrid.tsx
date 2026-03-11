"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addMonths, format, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isoFromDaysAgo, isoStartOfToday } from "@/lib/utils/dates";
import { useProfile } from "@/lib/supabase/useProfile";

interface KpiValues {
  leadsToday: number;
  leads7d: number;
  leads30d: number;
  callToAppointmentRate: number;
  calledLeadsMonth: number;
  bookedLeadsMonth: number;
  appointments: number;
  noResponse: number;
  callCostTotal: number;
  costToClosedValueRate: number | null;
  clientsClosedMonth: number;
  clientsClosedValueMonth: number;
}

const currencyPreciseFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const percentFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function normalizePhone(value?: string | null) {
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, "");
  if (!normalized) return null;
  if (normalized.startsWith("+")) return normalized;
  return `+${normalized}`;
}

function getCallLeadKey(call: { lead_id?: string | null; phone?: string | null }) {
  if (call.lead_id) return `lead:${call.lead_id}`;
  const phone = normalizePhone(call.phone);
  return phone ? `phone:${phone}` : null;
}

function getAppointmentLeadKey(appointment: { lead_id?: string | null; lead_phone?: string | null }) {
  if (appointment.lead_id) return `lead:${appointment.lead_id}`;
  const phone = normalizePhone(appointment.lead_phone);
  return phone ? `phone:${phone}` : null;
}

function getReferenceTimestamp(...dates: Array<string | null | undefined>) {
  for (const value of dates) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

export function KpiGrid() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [kpis, setKpis] = useState<KpiValues>({
    leadsToday: 0,
    leads7d: 0,
    leads30d: 0,
    callToAppointmentRate: 0,
    calledLeadsMonth: 0,
    bookedLeadsMonth: 0,
    appointments: 0,
    noResponse: 0,
    callCostTotal: 0,
    costToClosedValueRate: null,
    clientsClosedMonth: 0,
    clientsClosedValueMonth: 0,
  });

  const clinicId = profile?.clinic_id;
  const callCostPerMin = useMemo(() => {
    if (!process.env.NEXT_PUBLIC_CALL_COST_PER_MIN) return null;
    const parsed = Number(process.env.NEXT_PUBLIC_CALL_COST_PER_MIN);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);

  const monthLabel = useMemo(() => {
    const label = format(selectedMonth, "MMMM yyyy", { locale: es });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [selectedMonth]);

  const monthRange = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end = addMonths(start, 1);
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    };
  }, [selectedMonth]);

  const loadKpis = useCallback(async () => {
    if (!clinicId) return;

    const today = isoStartOfToday();
    const last7 = isoFromDaysAgo(7);
    const last30 = isoFromDaysAgo(30);

    const [
      leadsToday,
      leads7d,
      leads30d,
      noResponse,
      appointments,
      endedCallsInMonth,
      appointmentsForConversion,
      closedLeads,
    ] =
      await Promise.all([
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .gte("created_at", today),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .gte("created_at", last7),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .gte("created_at", last30),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "no_response")
        .gte("created_at", last30),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .or("entry_type.eq.lead_visit,entry_type.is.null")
        .eq("status", "scheduled")
        .gte("start_at", new Date().toISOString()),
      supabase
        .from("calls")
        .select("lead_id, phone, duration_sec, call_cost_eur, ended_at, started_at, created_at, outcome")
        .eq("clinic_id", clinicId)
        .eq("status", "ended")
        .order("created_at", { ascending: false }),
      supabase
        .from("appointments")
        .select("lead_id, lead_phone, status, source_channel, created_at, start_at")
        .eq("clinic_id", clinicId),
      supabase
        .from("leads")
        .select("id, converted_to_client, converted_at, converted_value_eur, stage_key, updated_at")
        .eq("clinic_id", clinicId)
        .or("converted_to_client.eq.true,stage_key.eq.client_closed"),
    ]);

    const parseNumeric = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    };

    const monthStartTs = new Date(monthRange.startIso).getTime();
    const monthEndTs = new Date(monthRange.endIso).getTime();
    const callsInSelectedMonth = (endedCallsInMonth.data || []).filter((row) => {
      const timestamp = getReferenceTimestamp(row.ended_at, row.started_at, row.created_at);
      return timestamp !== null && timestamp >= monthStartTs && timestamp < monthEndTs;
    });

    const totalCallCost = callsInSelectedMonth.reduce((acc, row) => {
      const persistedCost = parseNumeric(row.call_cost_eur);
      if (persistedCost !== null) return acc + persistedCost;
      if (!callCostPerMin) return acc;
      return acc + ((row.duration_sec || 0) / 60) * callCostPerMin;
    }, 0);

    const calledLeadKeys = new Set(
      callsInSelectedMonth
        .map((row) => getCallLeadKey(row))
        .filter((value): value is string => Boolean(value))
    );

    const bookedLeadKeysFromAppointments = new Set(
      (appointmentsForConversion.data || [])
        .filter((appointment) => appointment.status === "scheduled" && appointment.source_channel === "call_ai")
        .filter((appointment) => {
          const timestamp = getReferenceTimestamp(appointment.created_at, appointment.start_at);
          return timestamp !== null && timestamp >= monthStartTs && timestamp < monthEndTs;
        })
        .map((appointment) => getAppointmentLeadKey(appointment))
        .filter((value): value is string => Boolean(value))
        .filter((key) => calledLeadKeys.has(key))
    );

    const bookedLeadKeysFromOutcomes = new Set(
      callsInSelectedMonth
        .filter((row) => row.outcome === "appointment_scheduled")
        .map((row) => getCallLeadKey(row))
        .filter((value): value is string => Boolean(value))
        .filter((key) => calledLeadKeys.has(key))
    );

    const bookedLeadKeys = new Set([
      ...Array.from(bookedLeadKeysFromAppointments),
      ...Array.from(bookedLeadKeysFromOutcomes),
    ]);

    const calledLeadsCount = calledLeadKeys.size;
    const bookedLeadsCount = bookedLeadKeys.size;
    const callToAppointmentRate = calledLeadsCount
      ? Number(((bookedLeadsCount / calledLeadsCount) * 100).toFixed(1))
      : 0;
    const leadsClosedThisMonth = (closedLeads.data || []).filter((lead) => {
      const referenceDate =
        lead.converted_to_client && lead.converted_at
          ? lead.converted_at
          : lead.stage_key === "client_closed"
            ? lead.updated_at
            : null;

      if (!referenceDate) return false;
      const timestamp = new Date(referenceDate).getTime();
      return timestamp >= new Date(monthRange.startIso).getTime() && timestamp < new Date(monthRange.endIso).getTime();
    });
    const clientsClosedMonth = leadsClosedThisMonth.length;
    const clientsClosedValueMonth = leadsClosedThisMonth.reduce((acc, lead) => {
      const parsedValue = parseNumeric(lead.converted_value_eur);
      return acc + (parsedValue || 0);
    }, 0);
    const costToClosedValueRate =
      clientsClosedValueMonth > 0 ? Number(((totalCallCost / clientsClosedValueMonth) * 100).toFixed(1)) : null;

    setKpis({
      leadsToday: leadsToday.count || 0,
      leads7d: leads7d.count || 0,
      leads30d: leads30d.count || 0,
      callToAppointmentRate,
      calledLeadsMonth: calledLeadsCount,
      bookedLeadsMonth: bookedLeadsCount,
      appointments: appointments.count || 0,
      noResponse: noResponse.count || 0,
      callCostTotal: Number(totalCallCost.toFixed(2)),
      costToClosedValueRate,
      clientsClosedMonth,
      clientsClosedValueMonth: Number(clientsClosedValueMonth.toFixed(2)),
    });
  }, [supabase, clinicId, callCostPerMin, monthRange.startIso, monthRange.endIso]);

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase
      .channel("kpi-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `clinic_id=eq.${clinicId}` },
        loadKpis
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls", filter: `clinic_id=eq.${clinicId}` },
        loadKpis
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        loadKpis
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadKpis]);

  const cards = [
    {
      label: "Leads totales (hoy)",
      value: kpis.leadsToday,
      note: "Últimas 24h",
    },
    {
      label: "Leads 7 días",
      value: kpis.leads7d,
      note: "Última semana",
    },
    {
      label: "Leads 30 días",
      value: kpis.leads30d,
      note: "Último mes",
    },
    {
      label: "Llamadas -> cita",
      value: `${percentFormatter.format(kpis.callToAppointmentRate)}%`,
      note: monthLabel,
      detail: `${kpis.bookedLeadsMonth} leads agendados de ${kpis.calledLeadsMonth} leads llamados`,
    },
    {
      label: "Citas agendadas",
      value: kpis.appointments,
      note: "Próximos 30 días",
    },
    {
      label: "No responde",
      value: kpis.noResponse,
      note: "Últimos 30 días",
    },
    {
      label: "Coste total llamadas",
      value: currencyPreciseFormatter.format(kpis.callCostTotal),
      note: monthLabel,
    },
    {
      label: "Coste / valor cerrado",
      value: kpis.costToClosedValueRate === null ? "—" : `${percentFormatter.format(kpis.costToClosedValueRate)}%`,
      note: monthLabel,
      detail:
        kpis.costToClosedValueRate === null
          ? "Sin valor cerrado en el mes"
          : `${currencyPreciseFormatter.format(kpis.callCostTotal)} en llamadas sobre ${currencyPreciseFormatter.format(kpis.clientsClosedValueMonth)} cerrados`,
    },
    {
      label: "Clientes cerrados",
      value: currencyPreciseFormatter.format(kpis.clientsClosedValueMonth),
      note: monthLabel,
      detail:
        kpis.clientsClosedMonth === 1
          ? "1 lead cerrado"
          : `${kpis.clientsClosedMonth} leads cerrados`,
    },
  ];

  return (
    <div className="space-y-4">
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="font-display text-2xl font-semibold sm:text-3xl">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.note}</p>
              {"detail" in card && card.detail ? <p className="text-xs font-medium text-foreground/80">{card.detail}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
