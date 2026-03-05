"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface GoogleCalendarStatus {
  connected: boolean;
  clinic_id: string | null;
  calendar_id: string | null;
  connected_at: string | null;
}

function buildEmbedUrl(calendarId: string, timezone: string) {
  const params = new URLSearchParams({
    src: calendarId,
    ctz: timezone,
    mode: "WEEK",
    showTitle: "0",
    showPrint: "0",
    showTabs: "1",
    showCalendars: "0",
    showTz: "0",
  });
  return `https://calendar.google.com/calendar/embed?${params.toString()}`;
}

function buildEditUrl(calendarId: string) {
  return `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`;
}

export function GoogleCalendarEmbed() {
  const timezone = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_TIMEZONE || "Europe/Madrid";
  const explicitEmbedUrl = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_EMBED_URL || "";
  const explicitEditUrl = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_EDIT_URL || "";
  const envCalendarId = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_ID || "";

  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    const response = await fetch("/api/gcal/status", { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as GoogleCalendarStatus;
      setStatus(payload);
    } else {
      setStatus({ connected: false, clinic_id: null, calendar_id: null, connected_at: null });
    }
    setLoadingStatus(false);
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const resolvedCalendarId = status?.calendar_id || envCalendarId || "primary";
  const embedUrl = useMemo(() => {
    if (explicitEmbedUrl) return explicitEmbedUrl;
    if (!status?.connected && !envCalendarId) return "";
    return buildEmbedUrl(resolvedCalendarId, timezone);
  }, [explicitEmbedUrl, status?.connected, envCalendarId, resolvedCalendarId, timezone]);

  const editUrl = useMemo(() => {
    if (explicitEditUrl) return explicitEditUrl;
    return buildEditUrl(resolvedCalendarId);
  }, [explicitEditUrl, resolvedCalendarId]);

  if (loadingStatus) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Comprobando conexión con Google Calendar...</CardContent>
      </Card>
    );
  }

  if (!status?.connected && !envCalendarId && !explicitEmbedUrl) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <p className="text-sm font-semibold">Google Calendar no conectado</p>
            <p className="text-sm text-muted-foreground">
              Conecta la cuenta de la doctora para mostrar su agenda y bloquear disponibilidad desde aquí.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href="/api/gcal/connect">Conectar Google</a>
            </Button>
            <Button asChild variant="outline">
              <a href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noreferrer">
                Abrir Google Calendar
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Google Calendar de la doctora</p>
          <p className="text-xs text-muted-foreground">
            Estado: {status?.connected ? "Conectado" : "No conectado"} · Calendario:{" "}
            <span className="font-medium text-foreground">{resolvedCalendarId}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Si el login de Google no aparece dentro del iframe, usa “Abrir en pestaña nueva”.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status?.connected ? (
            <Button asChild variant="outline" size="sm">
              <a href="/api/gcal/connect">Reconectar</a>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <a href="/api/gcal/connect">Conectar Google</a>
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={loadStatus}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Recargar
          </Button>
          <Button asChild size="sm">
            <a href={editUrl} target="_blank" rel="noreferrer">
              Abrir en pestaña nueva
            </a>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-white">
        <iframe title="Google Calendar" src={embedUrl} className="h-[78vh] min-h-[620px] w-full" loading="lazy" />
      </div>
    </div>
  );
}
