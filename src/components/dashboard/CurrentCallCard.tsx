"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Lead, SystemState } from "@/lib/types";
import { formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";

export function CurrentCallCard() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [state, setState] = useState<SystemState | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!clinicId) return;
    const loadState = async () => {
      const { data } = await supabase
        .from("system_state")
        .select("*")
        .eq("clinic_id", clinicId)
        .single();
      if (data) {
        setState(data as SystemState);
      }
    };

    loadState();

    const channel = supabase
      .channel("system-state")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "system_state", filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          setState(payload.new as SystemState);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId]);

  useEffect(() => {
    if (!state?.current_call_lead_id) {
      setLead(null);
      return;
    }

    const loadLead = async () => {
      const { data } = await supabase
        .from("leads")
        .select("*")
        .eq("id", state.current_call_lead_id)
        .single();
      if (data) setLead(data as Lead);
    };

    loadLead();
  }, [supabase, state?.current_call_lead_id]);

  useEffect(() => {
    if (!state?.current_call_started_at) return;
    const interval = setInterval(() => setTick((prev) => prev + 1), 15000);
    return () => clearInterval(interval);
  }, [state?.current_call_started_at]);

  const duration = useMemo(() => {
    if (!state?.current_call_started_at) return null;
    return formatDistanceToNowStrict(new Date(state.current_call_started_at), {
      locale: es,
      addSuffix: false,
    });
  }, [state?.current_call_started_at, tick]);

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <CardTitle>En llamada ahora</CardTitle>
        <Badge variant={state?.current_call_retell_id ? "success" : "default"}>
          {state?.current_call_retell_id ? "En llamada" : "Sin llamadas"}
        </Badge>
      </CardHeader>
      <CardContent>
        {state?.current_call_retell_id ? (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Lead</p>
              <p className="text-base font-medium">
                {lead?.full_name || lead?.phone || "Lead sin nombre"}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Teléfono</p>
                <p className="font-medium">{lead?.phone || "No disponible"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Tratamiento</p>
                <p className="font-medium">{lead?.treatment || "No especificado"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Inicio</p>
                <p className="font-medium">
                  {state.current_call_started_at
                    ? new Date(state.current_call_started_at).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Duración</p>
                <p className="font-medium">{duration || "En curso"}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sin llamadas en curso.</p>
        )}
      </CardContent>
    </Card>
  );
}
