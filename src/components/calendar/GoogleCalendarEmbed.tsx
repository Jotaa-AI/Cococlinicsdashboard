"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface GoogleCalendarStatus {
  connected: boolean;
  clinic_id: string | null;
  calendar_id: string | null;
  selected_calendar_ids?: string[];
  connected_at: string | null;
  linked_email?: string | null;
}

interface GoogleCalendarItem {
  id: string;
  summary: string;
  primary: boolean;
  access_role: string;
}

interface GoogleCalendarsPayload {
  connected: boolean;
  calendars: GoogleCalendarItem[];
  selected_calendar_ids: string[];
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
  const [calendars, setCalendars] = useState<GoogleCalendarItem[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [savingCalendars, setSavingCalendars] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);

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

  const loadCalendars = useCallback(async () => {
    const response = await fetch("/api/gcal/calendars", { cache: "no-store" });
    if (!response.ok) {
      setCalendars([]);
      setSelectedCalendarIds([]);
      return;
    }
    const payload = (await response.json()) as GoogleCalendarsPayload;
    setCalendars(payload.calendars || []);
    setSelectedCalendarIds(payload.selected_calendar_ids || []);
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    loadCalendars();
  }, [status?.connected, loadCalendars]);

  const toggleCalendar = (calendarId: string) => {
    setCalendarMessage(null);
    setSelectedCalendarIds((prev) => {
      if (prev.includes(calendarId)) return prev.filter((id) => id !== calendarId);
      return [...prev, calendarId];
    });
  };

  const saveSelectedCalendars = async () => {
    if (!selectedCalendarIds.length) {
      setCalendarMessage("Selecciona al menos un calendario.");
      return;
    }

    setSavingCalendars(true);
    setCalendarMessage(null);
    const response = await fetch("/api/gcal/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendar_ids: selectedCalendarIds }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setCalendarMessage(payload?.error || "No se pudo guardar la selección.");
      setSavingCalendars(false);
      return;
    }

    setCalendarMessage("Calendarios guardados correctamente.");
    await Promise.all([loadStatus(), loadCalendars()]);
    setSavingCalendars(false);
  };

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
          {status?.linked_email ? (
            <p className="text-xs text-muted-foreground">
              Cuenta vinculada: <span className="font-medium text-foreground">{status.linked_email}</span>
            </p>
          ) : null}
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

      {status?.connected ? (
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-sm font-semibold">Selecciona los calendarios que tus agentes podran usar para gestionar citas</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Solo se ofreceran huecos libres cuando todos los calendarios seleccionados esten disponibles.
          </p>
          <div className="mt-3 max-h-48 space-y-2 overflow-auto rounded-md border border-border p-3">
            {calendars.length ? (
              calendars.map((calendar) => (
                <label key={calendar.id} className="flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={selectedCalendarIds.includes(calendar.id)}
                    onChange={() => toggleCalendar(calendar.id)}
                  />
                  <span className="leading-5">
                    <span className="font-medium text-foreground">{calendar.summary}</span>
                    {calendar.primary ? <span className="text-xs text-muted-foreground"> · Principal</span> : null}
                    <span className="block text-xs text-muted-foreground">{calendar.id}</span>
                  </span>
                </label>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No se han encontrado calendarios disponibles en esta cuenta.</p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={saveSelectedCalendars} disabled={savingCalendars}>
              {savingCalendars ? "Guardando..." : "Guardar seleccion"}
            </Button>
            {calendarMessage ? <p className="text-xs text-muted-foreground">{calendarMessage}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-white">
        <iframe title="Google Calendar" src={embedUrl} className="h-[78vh] min-h-[620px] w-full" loading="lazy" />
      </div>
    </div>
  );
}
