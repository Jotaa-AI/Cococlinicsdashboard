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

  const [activeCall, setActiveCall] = useState<ActiveCallRow | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const loadActiveCall = useCallback(async () => {
    if (!clinicId) return;
    const { data } = await supabase
      .from("calls")
      .select("id, status, started_at, phone, lead_id")
      .eq("clinic_id", clinicId)
      .eq("status", "in_progress")
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    const row = ((data || []) as unknown as ActiveCallRow[])[0];
    if (!row) {
      setActiveCall(null);
      return;
    }

    let leadName: string | null = null;
    let leadPhone: string | null = null;
    let leadTreatment: string | null = null;

    if (row.lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("full_name, phone, treatment")
        .eq("clinic_id", clinicId)
        .eq("id", row.lead_id)
        .maybeSingle();

      if (lead) {
        leadName = lead.full_name;
        leadPhone = lead.phone;
        leadTreatment = lead.treatment;
      }
    }

    setActiveCall({
      ...row,
      leadName,
      leadPhone,
      leadTreatment,
    });
  }, [supabase, clinicId]);

  useEffect(() => {
    loadActiveCall();
  }, [loadActiveCall]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel(`active-call-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls", filter: `clinic_id=eq.${clinicId}` },
        loadActiveCall
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadActiveCall]);

  useEffect(() => {
    if (!activeCall?.started_at) return;
    const interval = setInterval(() => setNowTs(Date.now()), 15000);
    return () => clearInterval(interval);
  }, [activeCall?.started_at]);

  const duration = useMemo(() => {
    if (!activeCall?.started_at) return null;
    return formatDistanceStrict(new Date(activeCall.started_at), new Date(nowTs), {
      locale: es,
    });
  }, [activeCall?.started_at, nowTs]);

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <CardTitle>En llamada ahora</CardTitle>
        <Badge variant={activeCall ? "success" : "default"}>
          {activeCall ? "En llamada" : "Sin llamadas"}
        </Badge>
      </CardHeader>
      <CardContent>
        {activeCall ? (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-4 rounded-2xl border border-border bg-accent/40 p-4">
              <div className="relative flex h-14 w-14 items-center justify-center">
                <span className="absolute h-14 w-14 rounded-full bg-primary/20 animate-ping" />
                <span
                  className="absolute h-10 w-10 rounded-full bg-primary/20 animate-ping"
                  style={{ animationDelay: "250ms" }}
                />
                <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <PhoneCall className="h-5 w-5" />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Agente IA llamando</p>
                <p className="text-sm font-medium text-foreground">Llamada activa en curso</p>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Lead</p>
              <p className="text-base font-medium">
                {activeCall.leadName || activeCall.phone || "Lead sin nombre"}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Teléfono</p>
                <p className="font-medium">{activeCall.leadPhone || activeCall.phone || "No disponible"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Tratamiento</p>
                <p className="font-medium">{activeCall.leadTreatment || "No especificado"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Inicio</p>
                <p className="font-medium">
                  {activeCall.started_at
                    ? new Date(activeCall.started_at).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
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
