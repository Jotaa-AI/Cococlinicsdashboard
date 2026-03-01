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
  contactedRate: number;
  appointments: number;
  noResponse: number;
  callCostTotal: number;
  clientsClosedMonth: number;
}

const currencyPreciseFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function KpiGrid() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [kpis, setKpis] = useState<KpiValues>({
    leadsToday: 0,
    leads7d: 0,
    leads30d: 0,
    contactedRate: 0,
    appointments: 0,
    noResponse: 0,
    callCostTotal: 0,
    clientsClosedMonth: 0,
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
      contacted,
      noResponse,
      appointments,
      endedCallsInMonth,
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
        .select("duration_sec, call_cost_eur")
        .eq("clinic_id", clinicId)
        .eq("status", "ended")
        .gte("ended_at", monthRange.startIso)
        .lt("ended_at", monthRange.endIso)
        .order("ended_at", { ascending: false }),
      supabase
        .from("leads")
        .select("id, converted_to_client, converted_at, stage_key, updated_at")
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

    const totalCallCost = (endedCallsInMonth.data || []).reduce((acc, row) => {
      const persistedCost = parseNumeric(row.call_cost_eur);
      if (persistedCost !== null) return acc + persistedCost;
      if (!callCostPerMin) return acc;
      return acc + ((row.duration_sec || 0) / 60) * callCostPerMin;
    }, 0);

    const leads30 = leads30d.count || 0;
    const contactedRate = leads30 ? Math.round(((contacted.count || 0) / leads30) * 100) : 0;
    const clientsClosedMonth = (closedLeads.data || []).filter((lead) => {
      const referenceDate =
        lead.converted_to_client && lead.converted_at
          ? lead.converted_at
          : lead.stage_key === "client_closed"
            ? lead.updated_at
            : null;

      if (!referenceDate) return false;
      const timestamp = new Date(referenceDate).getTime();
      return timestamp >= new Date(monthRange.startIso).getTime() && timestamp < new Date(monthRange.endIso).getTime();
    }).length;

    setKpis({
      leadsToday: leadsToday.count || 0,
      leads7d: leads7d.count || 0,
      leads30d: leads30d.count || 0,
      contactedRate,
      appointments: appointments.count || 0,
      noResponse: noResponse.count || 0,
      callCostTotal: Number(totalCallCost.toFixed(2)),
      clientsClosedMonth,
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
      value: currencyPreciseFormatter.format(kpis.callCostTotal),
      note: monthLabel,
    },
    {
      label: "Clientes cerrados",
      value: kpis.clientsClosedMonth,
      note: monthLabel,
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
