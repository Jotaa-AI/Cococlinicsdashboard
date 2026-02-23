"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import { Button } from "@/components/ui/button";

interface DataPoint {
  dayLabel: string;
  fullDate: string;
  total: number;
}

export function LeadsChart() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [data, setData] = useState<DataPoint[]>([]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfMonth(selectedMonth),
        end: endOfMonth(selectedMonth),
      }),
    [selectedMonth]
  );

  const monthLabel = useMemo(
    () => format(selectedMonth, "LLLL yyyy", { locale: es }),
    [selectedMonth]
  );

  const loadData = useCallback(async () => {
    if (!clinicId) {
      setData([]);
      return;
    }

    const start = startOfMonth(selectedMonth).toISOString();
    const end = endOfMonth(selectedMonth).toISOString();
    const { data: rows } = await supabase
      .from("leads")
      .select("created_at")
      .eq("clinic_id", clinicId)
      .gte("created_at", start)
      .lte("created_at", end);

    const counts = new Map<string, number>();
    for (const day of days) {
      counts.set(format(day, "yyyy-MM-dd"), 0);
    }

    for (const row of rows || []) {
      const key = row.created_at ? format(new Date(row.created_at), "yyyy-MM-dd") : null;
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    setData(
      days.map((day) => ({
        dayLabel: format(day, "d"),
        fullDate: format(day, "dd/MM/yyyy"),
        total: counts.get(format(day, "yyyy-MM-dd")) || 0,
      }))
    );
  }, [clinicId, days, selectedMonth, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase
      .channel("leads-chart-month")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `clinic_id=eq.${clinicId}` },
        loadData
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadData]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setSelectedMonth((prev) => addMonths(prev, -1))}>
            ←
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setSelectedMonth((prev) => addMonths(prev, 1))}>
            →
          </Button>
        </div>
        <p className="text-sm font-medium capitalize">{monthLabel}</p>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <XAxis dataKey="dayLabel" tickLine={false} axisLine={false} minTickGap={8} />
            <YAxis hide />
            <Tooltip
              cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1 }}
              labelFormatter={(_, payload) => {
                const item = payload?.[0]?.payload as DataPoint | undefined;
                return item?.fullDate || "";
              }}
              formatter={(value) => [`${value} leads`, "Entradas"]}
              contentStyle={{
                borderRadius: 12,
                borderColor: "hsl(var(--border))",
                background: "white",
              }}
            />
            <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
