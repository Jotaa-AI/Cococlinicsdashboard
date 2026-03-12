"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  format,
  startOfMonth,
  startOfToday,
  startOfWeek,
  endOfWeek,
} from "date-fns";
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
  getLeadKeyFromLead,
  getReferenceTimestamp,
  inRange,
  isInternalBlock,
  isLeadClosed,
  parseNumeric,
} from "@/lib/dashboard/aiMetrics";

type LeadView = "day" | "week" | "month";

interface DashboardKpis {
  leadsDay: number;
  leadsWeek: number;
  leadsMonth: number;
  callsMonth: number;
  callCostMonth: number;
  appointmentsMonth: number;
  wonAppointmentsMonth: number;
  wonRevenueMonth: number;
  estimatedAppointmentsMonth: number;
  estimatedRevenueMonth: number;
}

const currencyFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ESTIMATED_SERVICE_VALUE_EUR = 350;

function upperFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isScheduledLeadAppointment(appointment: Appointment) {
  return appointment.status === "scheduled" && !isInternalBlock(appointment);
}

export function KpiGrid() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [leadView, setLeadView] = useState<LeadView>("week");
  const [kpis, setKpis] = useState<DashboardKpis>({
    leadsDay: 0,
    leadsWeek: 0,
    leadsMonth: 0,
    callsMonth: 0,
    callCostMonth: 0,
    appointmentsMonth: 0,
    wonAppointmentsMonth: 0,
    wonRevenueMonth: 0,
    estimatedAppointmentsMonth: 0,
    estimatedRevenueMonth: 0,
  });

  const monthLabel = useMemo(() => upperFirst(format(selectedMonth, "MMMM yyyy", { locale: es })), [selectedMonth]);

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

  const loadKpis = useCallback(async () => {
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
        .select("lead_id, phone, status, ended_at, started_at, created_at, call_cost_eur")
        .eq("clinic_id", clinicId)
        .eq("status", "ended"),
      supabase
        .from("appointments")
        .select("id, lead_id, lead_phone, status, start_at, created_at")
        .eq("clinic_id", clinicId),
    ]);

    const leads = ((leadsResult.data || []) as Lead[]).filter(Boolean);
    const calls = ((callsResult.data || []) as Call[]).filter(Boolean);
    const appointments = ((appointmentsResult.data || []) as Appointment[]).filter(Boolean);

    const todayStart = startOfToday().getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
    const nextWeekStart = endOfWeek(new Date(), { weekStartsOn: 1 }).getTime() + 1;

    const leadsDay = leads.filter((lead) => inRange(getReferenceTimestamp(lead.created_at), todayStart, tomorrowStart)).length;
    const leadsWeek = leads.filter((lead) => inRange(getReferenceTimestamp(lead.created_at), weekStart, nextWeekStart)).length;
    const leadsMonth = leads.filter((lead) => inRange(getReferenceTimestamp(lead.created_at), monthRange.startMs, monthRange.endMs)).length;

    const callsMonth = calls.filter((call) =>
      inRange(getReferenceTimestamp(call.ended_at, call.started_at, call.created_at), monthRange.startMs, monthRange.endMs)
    );

    const callCostMonth = callsMonth.reduce((sum, call) => sum + (parseNumeric(call.call_cost_eur) || 0), 0);

    const scheduledAppointmentsMonth = appointments.filter((appointment) => {
      if (!isScheduledLeadAppointment(appointment)) return false;
      return inRange(getReferenceTimestamp(appointment.start_at, appointment.created_at), monthRange.startMs, monthRange.endMs);
    });

    const closedLeadKeys = new Set(
      leads
        .filter((lead) => {
          if (!isLeadClosed(lead)) return false;
          const closedAt = getReferenceTimestamp(getLeadClosedTimestamp(lead));
          return inRange(closedAt, monthRange.startMs, monthRange.endMs);
        })
        .map((lead) => getLeadKeyFromLead(lead))
        .filter((value): value is string => Boolean(value))
    );

    let wonAppointmentsMonth = 0;
    let wonRevenueMonth = 0;
    let estimatedAppointmentsMonth = 0;

    const revenueCountedLeadKeys = new Set<string>();

    for (const appointment of scheduledAppointmentsMonth) {
      const leadKey = getLeadKeyFromAppointment(appointment);
      if (leadKey && closedLeadKeys.has(leadKey)) {
        wonAppointmentsMonth += 1;
        if (!revenueCountedLeadKeys.has(leadKey)) {
          const lead = leads.find((item) => getLeadKeyFromLead(item) === leadKey);
          wonRevenueMonth += parseNumeric(lead?.converted_value_eur) || 0;
          revenueCountedLeadKeys.add(leadKey);
        }
      } else {
        estimatedAppointmentsMonth += 1;
      }
    }

    setKpis({
      leadsDay,
      leadsWeek,
      leadsMonth,
      callsMonth: callsMonth.length,
      callCostMonth: Number(callCostMonth.toFixed(2)),
      appointmentsMonth: scheduledAppointmentsMonth.length,
      wonAppointmentsMonth,
      wonRevenueMonth: Number(wonRevenueMonth.toFixed(2)),
      estimatedAppointmentsMonth,
      estimatedRevenueMonth: Number((estimatedAppointmentsMonth * ESTIMATED_SERVICE_VALUE_EUR).toFixed(2)),
    });
  }, [clinicId, monthRange.endMs, monthRange.startMs, supabase]);

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
          ? `1 cita pendiente x ${currencyFormatter.format(ESTIMATED_SERVICE_VALUE_EUR)}`
          : `${kpis.estimatedAppointmentsMonth} citas pendientes x ${currencyFormatter.format(ESTIMATED_SERVICE_VALUE_EUR)}`,
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
