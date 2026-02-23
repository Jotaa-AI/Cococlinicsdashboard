"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Call } from "@/lib/types";
import { CALL_OUTCOME_LABELS } from "@/lib/constants/call-outcomes";

interface CallDetail extends Call {
  leads?: { full_name: string | null; treatment: string | null; phone: string | null } | null;
}

function mimeTypeFromUrl(url: string) {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".wav")) return "audio/wav";
  if (clean.endsWith(".mp3")) return "audio/mpeg";
  if (clean.endsWith(".m4a")) return "audio/mp4";
  if (clean.endsWith(".ogg")) return "audio/ogg";
  return undefined;
}

export default function CallDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [call, setCall] = useState<CallDetail | null>(null);

  useEffect(() => {
    const loadCall = async () => {
      const { data } = await supabase
        .from("calls")
        .select("*, leads(full_name, treatment, phone)")
        .eq("id", params.id)
        .single();

      if (data) {
        const row = data as unknown as CallDetail;
        const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
        setCall({ ...row, leads: lead || null });
      }
    };

    loadCall();
  }, [params.id, supabase]);

  if (!call) {
    return <div className="text-sm text-muted-foreground">Cargando detalle...</div>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => router.back()}>
        ← Volver
      </Button>
      <Card>
        <CardHeader className="flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
          <CardTitle>Detalle de llamada</CardTitle>
          <Badge variant={call.outcome === "appointment_scheduled" ? "success" : "soft"}>
            {call.outcome && call.outcome in CALL_OUTCOME_LABELS
              ? CALL_OUTCOME_LABELS[call.outcome as keyof typeof CALL_OUTCOME_LABELS]
              : call.outcome || "pendiente"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Lead</p>
              <p className="text-base font-medium">{call.leads?.full_name || "Lead"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Teléfono</p>
              <p className="text-base font-medium">{call.leads?.phone || call.phone || "—"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Tratamiento</p>
              <p className="text-base font-medium">{call.leads?.treatment || "—"}</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Duración</p>
              <p className="text-base font-medium">
                {call.duration_sec ? `${Math.round(call.duration_sec / 60)} min` : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Estado</p>
              <p className="text-base font-medium">{call.status}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Grabación</p>
              {call.recording_url ? (
                <div className="space-y-2">
                  <audio controls preload="none" className="w-full">
                    <source src={call.recording_url} type={mimeTypeFromUrl(call.recording_url)} />
                    Tu navegador no soporta reproducción de audio.
                  </audio>
                  <a className="text-sm text-primary" href={call.recording_url} target="_blank" rel="noreferrer">
                    Abrir audio en pestaña nueva
                  </a>
                </div>
              ) : (
                <span>—</span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Resumen</p>
            <p className="text-sm text-muted-foreground">{call.summary || "Sin resumen disponible."}</p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Transcripción</p>
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              {call.transcript || "Sin transcripción."}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Variables extraídas</p>
            <pre className="rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
              {call.extracted ? JSON.stringify(call.extracted, null, 2) : "Sin variables."}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
