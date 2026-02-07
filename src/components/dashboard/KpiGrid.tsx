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
  callCost?: number | null;
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
    callCost: null,
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

    const [leadsToday, leads7d, leads30d, contacted, noResponse, appointments] = await Promise.all([
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
    ]);

    let callCost: number | null = null;
    if (callCostPerMin) {
      const { data } = await supabase
        .from("calls")
        .select("duration_sec")
        .eq("clinic_id", clinicId)
        .eq("status", "ended")
        .gte("ended_at", last30);

      const totalSec = (data || []).reduce((acc, row) => acc + (row.duration_sec || 0), 0);
      callCost = (totalSec / 60) * callCostPerMin;
    }

    const leads30 = leads30d.count || 0;
    const contactedRate = leads30 ? Math.round(((contacted.count || 0) / leads30) * 100) : 0;

    setKpis({
      leadsToday: leadsToday.count || 0,
      leads7d: leads7d.count || 0,
      leads30d: leads30d.count || 0,
      contactedRate,
      appointments: appointments.count || 0,
      noResponse: noResponse.count || 0,
      callCost,
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
  ];

  if (kpis.callCost !== null && kpis.callCost !== undefined) {
    cards.push({
      label: "Coste estimado llamadas",
      value: currencyFormatter.format(kpis.callCost),
      note: "Últimos 30 días",
    });
  }

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
