"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Call } from "@/lib/types";
import { formatDistanceStrict } from "date-fns";
import { es } from "date-fns/locale";
import { PhoneCall } from "lucide-react";

interface ActiveCallRow extends Pick<Call, "id" | "status" | "started_at" | "phone" | "lead_id"> {
  leadName?: string | null;
  leadPhone?: string | null;
  leadTreatment?: string | null;
}

export function CurrentCallCard() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [activeCalls, setActiveCalls] = useState<ActiveCallRow[]>([]);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const loadActiveCalls = useCallback(async () => {
    if (!clinicId) return;
    const { data } = await supabase
      .from("calls")
      .select("id, status, started_at, phone, lead_id")
      .eq("clinic_id", clinicId)
      .eq("status", "in_progress")
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .order("created_at", { ascending: false });

    const rows = (data || []) as unknown as ActiveCallRow[];
    if (!rows.length) {
      setActiveCalls([]);
      return;
    }

    const leadIds = Array.from(new Set(rows.map((row) => row.lead_id).filter(Boolean))) as string[];
    const leadMap = new Map<string, { full_name: string | null; phone: string | null; treatment: string | null }>();

    if (leadIds.length) {
      const { data: leads } = await supabase
        .from("leads")
        .select("id, full_name, phone, treatment")
        .eq("clinic_id", clinicId)
        .in("id", leadIds);

      for (const lead of leads || []) {
        leadMap.set(lead.id, {
          full_name: lead.full_name,
          phone: lead.phone,
          treatment: lead.treatment,
        });
      }
    }

    setActiveCalls(
      rows.map((row) => {
        const lead = row.lead_id ? leadMap.get(row.lead_id) : null;
        return {
          ...row,
          leadName: lead?.full_name || null,
          leadPhone: lead?.phone || null,
          leadTreatment: lead?.treatment || null,
        };
      })
    );
  }, [supabase, clinicId]);

  useEffect(() => {
    loadActiveCalls();
  }, [loadActiveCalls]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel(`active-call-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls", filter: `clinic_id=eq.${clinicId}` },
        loadActiveCalls
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadActiveCalls]);

  useEffect(() => {
    if (!activeCalls.length) return;
    const interval = setInterval(() => setNowTs(Date.now()), 15000);
    return () => clearInterval(interval);
  }, [activeCalls.length]);

  const formatDuration = useMemo(
    () => (startedAt: string | null) => {
      if (!startedAt) return "En curso";
      return formatDistanceStrict(new Date(startedAt), new Date(nowTs), {
        locale: es,
      });
    },
    [nowTs]
  );

  const activeCallsCountLabel = useMemo(() => {
    if (!activeCalls.length) return "Sin llamadas";
    if (activeCalls.length === 1) return "1 en llamada";
    return `${activeCalls.length} en llamada`;
  }, [activeCalls.length]);

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <CardTitle>En llamada ahora</CardTitle>
        <Badge variant={activeCalls.length ? "success" : "default"}>{activeCallsCountLabel}</Badge>
      </CardHeader>
      <CardContent>
        {activeCalls.length ? (
          <div className="space-y-3">
            {activeCalls.map((call) => (
              <div key={call.id} className="space-y-3 rounded-2xl border border-border bg-accent/15 p-4 text-sm">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-11 w-11 items-center justify-center">
                    <span className="absolute h-11 w-11 rounded-full bg-primary/20 animate-ping" />
                    <div className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <PhoneCall className="h-4 w-4" />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Agente IA llamando</p>
                    <p className="text-sm font-medium text-foreground">
                      {call.leadName || call.phone || "Lead sin nombre"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">Teléfono</p>
                    <p className="font-medium">{call.leadPhone || call.phone || "No disponible"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Tratamiento</p>
                    <p className="font-medium">{call.leadTreatment || "No especificado"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Inicio</p>
                    <p className="font-medium">
                      {call.started_at
                        ? new Date(call.started_at).toLocaleTimeString("es-ES", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Duración</p>
                    <p className="font-medium">{formatDuration(call.started_at)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sin llamadas en curso.</p>
        )}
      </CardContent>
    </Card>
  );
}
