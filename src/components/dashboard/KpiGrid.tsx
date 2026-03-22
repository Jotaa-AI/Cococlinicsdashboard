"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addMonths, format, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { DashboardSummary } from "@/lib/dashboard/serverMetrics";

type LeadView = "day" | "week" | "month";

const currencyFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function upperFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function leadsMonthShare(value: number, total: number) {
  if (!total) return 0;
  return Number(((value / total) * 100).toFixed(1));
}

export function KpiGrid() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [leadView, setLeadView] = useState<LeadView>("week");
  const [kpis, setKpis] = useState<DashboardSummary>({
    leadsDay: 0,
    leadsWeek: 0,
    leadsMonth: 0,
    managedByHumanMonth: 0,
    managedByAiMonth: 0,
    managedByUnknownMonth: 0,
    callsMonth: 0,
    callCostMonth: 0,
    appointmentsMonth: 0,
    callAiAppointmentsMonth: 0,
    whatsappAiAppointmentsMonth: 0,
    callAiAppointmentsSharePct: 0,
    whatsappAiAppointmentsSharePct: 0,
    wonAppointmentsMonth: 0,
    wonRevenueMonth: 0,
    estimatedAppointmentsMonth: 0,
    estimatedRevenueMonth: 0,
  });

  const monthLabel = useMemo(() => upperFirst(format(selectedMonth, "MMMM yyyy", { locale: es })), [selectedMonth]);

  const loadKpis = useCallback(async () => {
    if (!clinicId) return;

    const monthParam = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, "0")}`;
    const response = await fetch(`/api/dashboard/summary?month=${encodeURIComponent(monthParam)}`, {
      cache: "no-store",
    });

    if (!response.ok) return;

    const payload = (await response.json().catch(() => null)) as DashboardSummary | null;
    if (!payload) return;

    setKpis(payload);
  }, [clinicId, selectedMonth]);

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel("dashboard-core-kpis")
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
  }, [clinicId, loadKpis, supabase]);

  const leadCount =
    leadView === "day" ? kpis.leadsDay : leadView === "week" ? kpis.leadsWeek : kpis.leadsMonth;

  const leadNote =
    leadView === "day"
      ? "Captados hoy"
      : leadView === "week"
        ? "Captados esta semana"
        : `Captados en ${monthLabel}`;

  const humanManagedShare = leadsMonthShare(kpis.managedByHumanMonth, kpis.leadsMonth);
  const aiManagedShare = leadsMonthShare(kpis.managedByAiMonth, kpis.leadsMonth);

  const cards = [
    {
      label: "Leads",
      value: String(leadCount),
      note: leadNote,
      detail: null,
      accent: null,
    },
    {
      label: "Llamadas realizadas",
      value: String(kpis.callsMonth),
      note: monthLabel,
      detail: "Llamadas finalizadas en el periodo",
      accent: null,
    },
    {
      label: "Gestionados por clínica",
      value: String(kpis.managedByHumanMonth),
      note: monthLabel,
      detail:
        kpis.leadsMonth > 0
          ? `${humanManagedShare}% de los leads del periodo${kpis.managedByUnknownMonth ? ` · ${kpis.managedByUnknownMonth} sin asignar` : ""}`
          : "Sin leads creados en el periodo",
      accent: "text-sky-700",
    },
    {
      label: "Gestionados por IA",
      value: String(kpis.managedByAiMonth),
      note: monthLabel,
      detail:
        kpis.leadsMonth > 0
          ? `${aiManagedShare}% de los leads del periodo${kpis.managedByUnknownMonth ? ` · ${kpis.managedByUnknownMonth} sin asignar` : ""}`
          : "Sin leads creados en el periodo",
      accent: "text-violet-700",
    },
    {
      label: "Coste total llamadas",
      value: currencyFormatter.format(kpis.callCostMonth),
      note: monthLabel,
      detail: "Suma de costes de llamadas del periodo",
      accent: null,
    },
    {
      label: "Total de citas agendadas",
      value: String(kpis.appointmentsMonth),
      note: monthLabel,
      detail: "Citas programadas en el periodo",
      accent: null,
    },
    {
      label: "Citas ganadas",
      value: currencyFormatter.format(kpis.wonRevenueMonth),
      note: monthLabel,
      detail:
        kpis.wonAppointmentsMonth === 1
          ? "1 cita cerrada con valor guardado"
          : `${kpis.wonAppointmentsMonth} citas cerradas con valor guardado`,
      accent: "text-emerald-700",
    },
    {
      label: "Valor estimado de cierre",
      value: currencyFormatter.format(kpis.estimatedRevenueMonth),
      note: monthLabel,
      detail:
        kpis.estimatedAppointmentsMonth === 1
          ? "1 cita pendiente x 350,00 €"
          : `${kpis.estimatedAppointmentsMonth} citas pendientes x 350,00 €`,
      accent: "text-primary",
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
            <CardContent className="space-y-2">
              {card.label === "Leads" ? (
                <div className="flex flex-wrap gap-2 pb-1">
                  {([
                    ["day", "Hoy"],
                    ["week", "Semana"],
                    ["month", "Mes"],
                  ] as const).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      variant={leadView === value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setLeadView(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              ) : null}
              <p className={`font-display text-2xl font-semibold sm:text-3xl ${card.accent || ""}`}>{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.note}</p>
              {card.detail ? <p className="text-xs font-medium text-foreground/80">{card.detail}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
