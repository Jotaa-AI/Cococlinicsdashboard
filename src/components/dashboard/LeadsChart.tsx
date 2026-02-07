"use client";

import { useEffect, useMemo, useState } from "react";
import { format, subDays, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";

interface DataPoint {
  day: string;
  total: number;
}

export function LeadsChart() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const [data, setData] = useState<DataPoint[]>([]);

  const days = useMemo(() => {
    const list: Date[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      list.push(startOfDay(subDays(new Date(), i)));
    }
    return list;
  }, []);

  const loadData = async () => {
    if (!clinicId) return;
    const start = days[0].toISOString();
    const { data } = await supabase
      .from("leads")
      .select("created_at")
      .eq("clinic_id", clinicId)
      .gte("created_at", start);

    const counts = new Map<string, number>();
    days.forEach((day) => counts.set(day.toISOString().slice(0, 10), 0));

    (data || []).forEach((item) => {
      const key = item.created_at?.slice(0, 10);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const series = days.map((day) => ({
      day: format(day, "EEE", { locale: es }),
      total: counts.get(day.toISOString().slice(0, 10)) || 0,
    }));

    setData(series);
  };

  useEffect(() => {
    loadData();
  }, [clinicId]);

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <XAxis dataKey="day" tickLine={false} axisLine={false} />
          <YAxis hide />
          <Tooltip
            cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1 }}
            contentStyle={{
              borderRadius: 12,
              borderColor: "hsl(var(--border))",
              background: "white",
            }}
          />
          <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
