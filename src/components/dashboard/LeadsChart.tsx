"use client";

import { useCallback, useEffect, useState } from "react";
import { addDays, addMonths } from "date-fns";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import { Button } from "@/components/ui/button";
import type {
  DashboardChartPoint,
  DashboardChartResponse,
  DashboardChartView,
} from "@/lib/dashboard/serverMetrics";

const viewLabels: Record<DashboardChartView, string> = {
  day: "Hoy",
  week: "Semana",
  month: "Mes",
};

function shiftReferenceDate(viewMode: DashboardChartView, referenceDate: Date, direction: -1 | 1) {
  if (viewMode === "day") return addDays(referenceDate, direction);
  if (viewMode === "week") return addDays(referenceDate, direction * 7);
  return addMonths(referenceDate, direction);
}

export function LeadsChart() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const [viewMode, setViewMode] = useState<DashboardChartView>("month");
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [data, setData] = useState<DashboardChartPoint[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [appointmentsTotal, setAppointmentsTotal] = useState(0);
  const [rangeLabel, setRangeLabel] = useState("");

  const loadData = useCallback(async () => {
    if (!clinicId) {
      setData([]);
      setLeadsTotal(0);
      setAppointmentsTotal(0);
      setRangeLabel("");
      return;
    }

    const response = await fetch(
      `/api/dashboard/chart?view=${viewMode}&reference=${encodeURIComponent(referenceDate.toISOString())}`,
      { cache: "no-store" }
    );

    if (!response.ok) return;

    const payload = (await response.json().catch(() => null)) as DashboardChartResponse | null;
    if (!payload) return;

    setData(payload.data);
    setLeadsTotal(payload.leadsTotal);
    setAppointmentsTotal(payload.appointmentsTotal);
    setRangeLabel(payload.rangeLabel);
  }, [clinicId, referenceDate, viewMode]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase
      .channel("dashboard-overview-chart")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `clinic_id=eq.${clinicId}` },
        loadData
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        loadData
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadData]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(viewLabels) as DashboardChartView[]).map((mode) => (
              <Button
                key={mode}
                type="button"
                variant={viewMode === mode ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setViewMode(mode);
                  setReferenceDate(new Date());
                }}
              >
                {viewLabels[mode]}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8"
              onClick={() => setReferenceDate((prev) => shiftReferenceDate(viewMode, prev, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8"
              onClick={() => setReferenceDate((prev) => shiftReferenceDate(viewMode, prev, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <p className="text-sm font-medium text-muted-foreground">{rangeLabel}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border bg-background px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Leads</p>
            <p className="font-display text-3xl font-semibold">{leadsTotal}</p>
            <p className="text-xs text-muted-foreground">Entrados en el periodo</p>
          </div>
          <div className="rounded-2xl border bg-primary/5 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Visitas agendadas</p>
            <p className="font-display text-3xl font-semibold text-primary">{appointmentsTotal}</p>
            <p className="text-xs text-muted-foreground">Citas creadas en el periodo</p>
          </div>
        </div>
      </div>

      <div className="h-[320px] rounded-3xl border bg-gradient-to-br from-background via-background to-muted/20 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted) / 0.35)" }}
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as DashboardChartPoint | undefined;
                return point?.fullLabel || "";
              }}
              formatter={(value, name) => {
                if (name === "leads") return [`${value}`, "Leads"];
                return [`${value}`, "Citas agendadas"];
              }}
              contentStyle={{
                borderRadius: 18,
                borderColor: "hsl(var(--border))",
                background: "hsl(var(--background))",
                boxShadow: "0 18px 50px rgba(15, 23, 42, 0.08)",
              }}
            />
            <Bar dataKey="leads" fill="hsl(var(--primary) / 0.18)" radius={[10, 10, 0, 0]} maxBarSize={28} />
            <Line
              type="monotone"
              dataKey="appointments"
              stroke="hsl(var(--primary))"
              strokeWidth={3}
              dot={{ r: 3, strokeWidth: 2 }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
