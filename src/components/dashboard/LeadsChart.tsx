"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  eachHourOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
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
import type { Appointment, Lead } from "@/lib/types";
import { getReferenceTimestamp, inRange, isInternalBlock } from "@/lib/dashboard/aiMetrics";

type ViewMode = "day" | "week" | "month";

interface DataPoint {
  bucketKey: string;
  label: string;
  fullLabel: string;
  leads: number;
  appointments: number;
}

const viewLabels: Record<ViewMode, string> = {
  day: "Hoy",
  week: "Semana",
  month: "Mes",
};

function getDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function getHourKey(date: Date) {
  return format(date, "yyyy-MM-dd-HH");
}

function startForView(viewMode: ViewMode, referenceDate: Date) {
  if (viewMode === "day") return startOfDay(referenceDate);
  if (viewMode === "week") return startOfWeek(referenceDate, { weekStartsOn: 1 });
  return startOfMonth(referenceDate);
}

function endForView(viewMode: ViewMode, referenceDate: Date) {
  if (viewMode === "day") return endOfDay(referenceDate);
  if (viewMode === "week") return endOfWeek(referenceDate, { weekStartsOn: 1 });
  return endOfMonth(referenceDate);
}

function shiftReferenceDate(viewMode: ViewMode, referenceDate: Date, direction: -1 | 1) {
  if (viewMode === "day") return addDays(referenceDate, direction);
  if (viewMode === "week") return addDays(referenceDate, direction * 7);
  return addMonths(referenceDate, direction);
}

function formatRangeLabel(viewMode: ViewMode, referenceDate: Date) {
  if (viewMode === "day") {
    const todayKey = getDateKey(new Date());
    return getDateKey(referenceDate) === todayKey
      ? "Hoy"
      : format(referenceDate, "d 'de' MMMM yyyy", { locale: es });
  }

  if (viewMode === "week") {
    const start = startForView("week", referenceDate);
    const end = endForView("week", referenceDate);
    return `${format(start, "d MMM", { locale: es })} - ${format(end, "d MMM yyyy", { locale: es })}`;
  }

  return format(referenceDate, "LLLL yyyy", { locale: es });
}

function buildBuckets(viewMode: ViewMode, referenceDate: Date): DataPoint[] {
  if (viewMode === "day") {
    return eachHourOfInterval({
      start: startForView("day", referenceDate),
      end: endForView("day", referenceDate),
    }).map((hour) => ({
      bucketKey: getHourKey(hour),
      label: format(hour, "HH:mm"),
      fullLabel: format(hour, "dd/MM/yyyy HH:mm"),
      leads: 0,
      appointments: 0,
    }));
  }

  return eachDayOfInterval({
    start: startForView(viewMode, referenceDate),
    end: endForView(viewMode, referenceDate),
  }).map((day) => ({
    bucketKey: getDateKey(day),
    label: viewMode === "week" ? format(day, "EEE d", { locale: es }) : format(day, "d"),
    fullLabel: format(day, "dd/MM/yyyy"),
    leads: 0,
    appointments: 0,
  }));
}

export function LeadsChart() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [data, setData] = useState<DataPoint[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [appointmentsTotal, setAppointmentsTotal] = useState(0);

  const rangeStart = useMemo(() => startForView(viewMode, referenceDate), [viewMode, referenceDate]);
  const rangeEnd = useMemo(() => endForView(viewMode, referenceDate), [viewMode, referenceDate]);
  const rangeLabel = useMemo(
    () => formatRangeLabel(viewMode, referenceDate).replace(/^\w/, (char) => char.toUpperCase()),
    [viewMode, referenceDate]
  );

  const loadData = useCallback(async () => {
    if (!clinicId) {
      setData([]);
      setLeadsTotal(0);
      setAppointmentsTotal(0);
      return;
    }

    const [leadsResult, appointmentsResult] = await Promise.all([
      supabase.from("leads").select("created_at").eq("clinic_id", clinicId),
      supabase
        .from("appointments")
        .select("status, start_at, created_at, entry_type")
        .eq("clinic_id", clinicId),
    ]);

    const leads = ((leadsResult.data || []) as Pick<Lead, "created_at">[]).filter(Boolean);
    const appointments = ((appointmentsResult.data || []) as Appointment[]).filter(Boolean);

    const points = buildBuckets(viewMode, referenceDate);
    const indexByKey = new Map(points.map((point, index) => [point.bucketKey, index]));
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = addDays(rangeEnd, 1).getTime();

    for (const lead of leads) {
      const timestamp = getReferenceTimestamp(lead.created_at);
      if (!inRange(timestamp, rangeStartMs, rangeEndMs)) continue;
      const date = new Date(timestamp as number);
      const key = viewMode === "day" ? getHourKey(date) : getDateKey(date);
      const index = indexByKey.get(key);
      if (index !== undefined) points[index].leads += 1;
    }

    for (const appointment of appointments) {
      if (appointment.status !== "scheduled" || isInternalBlock(appointment)) continue;
      const timestamp = getReferenceTimestamp(appointment.start_at, appointment.created_at);
      if (!inRange(timestamp, rangeStartMs, rangeEndMs)) continue;
      const date = new Date(timestamp as number);
      const key = viewMode === "day" ? getHourKey(date) : getDateKey(date);
      const index = indexByKey.get(key);
      if (index !== undefined) points[index].appointments += 1;
    }

    setData(points);
    setLeadsTotal(points.reduce((acc, point) => acc + point.leads, 0));
    setAppointmentsTotal(points.reduce((acc, point) => acc + point.appointments, 0));
  }, [clinicId, rangeEnd, rangeStart, referenceDate, supabase, viewMode]);

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
            {(Object.keys(viewLabels) as ViewMode[]).map((mode) => (
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
            <p className="text-xs text-muted-foreground">Citas scheduled del periodo</p>
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
                const point = payload?.[0]?.payload as DataPoint | undefined;
                return point?.fullLabel || "";
              }}
              formatter={(value, name) => {
                if (name === "leads") return [`${value}`, "Leads"];
                return [`${value}`, "Visitas agendadas"];
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
