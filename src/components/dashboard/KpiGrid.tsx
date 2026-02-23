"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isoFromDaysAgo, isoStartOfToday } from "@/lib/utils/dates";
import { useProfile } from "@/lib/supabase/useProfile";

interface KpiValues {
  leadsToday: number;
  leads7d: number;
  leads30d: number;
  contactedRate: number;
  appointments: number;
  noResponse: number;
  callCostTotal: number;
  successfulCalls: number;
  successfulCallsRevenue: number;
  avgTreatmentPrice: number;
}

const currencyFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function KpiGrid() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const [kpis, setKpis] = useState<KpiValues>({
    leadsToday: 0,
    leads7d: 0,
    leads30d: 0,
    contactedRate: 0,
    appointments: 0,
    noResponse: 0,
    callCostTotal: 0,
    successfulCalls: 0,
    successfulCallsRevenue: 0,
    avgTreatmentPrice: 399,
  });

  const clinicId = profile?.clinic_id;
  const callCostPerMin = useMemo(() => {
    if (!process.env.NEXT_PUBLIC_CALL_COST_PER_MIN) return null;
    const parsed = Number(process.env.NEXT_PUBLIC_CALL_COST_PER_MIN);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);

  const loadKpis = useCallback(async () => {
    if (!clinicId) return;

    const today = isoStartOfToday();
    const last7 = isoFromDaysAgo(7);
    const last30 = isoFromDaysAgo(30);

    const [leadsToday, leads7d, leads30d, contacted, noResponse, appointments, successfulCalls, clinic, endedCalls] =
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
        .in("status", ["contacted", "visit_scheduled"])
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
        .eq("status", "scheduled")
        .gte("start_at", new Date().toISOString()),
      supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "ended")
        .eq("outcome", "appointment_scheduled"),
      supabase.from("clinics").select("avg_treatment_price_eur").eq("id", clinicId).maybeSingle(),
      supabase
        .from("calls")
        .select("duration_sec, call_cost_eur")
        .eq("clinic_id", clinicId)
        .eq("status", "ended")
        .order("ended_at", { ascending: false }),
    ]);

    const parseNumeric = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    };

    const totalCallCost = (endedCalls.data || []).reduce((acc, row) => {
      const persistedCost = parseNumeric(row.call_cost_eur);
      if (persistedCost !== null) return acc + persistedCost;
      if (!callCostPerMin) return acc;
      return acc + ((row.duration_sec || 0) / 60) * callCostPerMin;
    }, 0);

    const avgTreatmentPrice = parseNumeric(clinic.data?.avg_treatment_price_eur) ?? 399;
    const successfulCallsCount = successfulCalls.count || 0;

    const leads30 = leads30d.count || 0;
    const contactedRate = leads30 ? Math.round(((contacted.count || 0) / leads30) * 100) : 0;

    setKpis({
      leadsToday: leadsToday.count || 0,
      leads7d: leads7d.count || 0,
      leads30d: leads30d.count || 0,
      contactedRate,
      appointments: appointments.count || 0,
      noResponse: noResponse.count || 0,
      callCostTotal: Number(totalCallCost.toFixed(2)),
      successfulCalls: successfulCallsCount,
      successfulCallsRevenue: Number((successfulCallsCount * avgTreatmentPrice).toFixed(2)),
      avgTreatmentPrice: Number(avgTreatmentPrice.toFixed(2)),
    });
  }, [supabase, clinicId, callCostPerMin]);

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
      label: "% contactados",
      value: `${kpis.contactedRate}%`,
      note: "Base 30 días",
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
      value: currencyFormatter.format(kpis.callCostTotal),
      note: "Acumulado",
    },
    {
      label: "Valor llamadas exitosas",
      value: currencyFormatter.format(kpis.successfulCallsRevenue),
      note: `${kpis.successfulCalls} cierres x ${currencyFormatter.format(kpis.avgTreatmentPrice)}`,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="font-display text-2xl font-semibold sm:text-3xl">{card.value}</p>
            <p className="text-xs text-muted-foreground">{card.note}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
