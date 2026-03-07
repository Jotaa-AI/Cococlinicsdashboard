"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface GoogleCalendarStatus {
  connected: boolean;
  clinic_id: string | null;
  calendar_id: string | null;
  primary_calendar_id?: string | null;
  blocking_calendar_ids?: string[];
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
  primary_calendar_id?: string | null;
  blocking_calendar_ids?: string[];
  selected_calendar_ids: string[];
}

function buildEmbedUrl(calendarIds: string[], timezone: string) {
  const params = new URLSearchParams({
    ctz: timezone,
    mode: "WEEK",
    showTitle: "0",
    showPrint: "0",
    showTabs: "1",
    showCalendars: "0",
    showTz: "0",
  });
  for (const calendarId of calendarIds) {
    params.append("src", calendarId);
  }
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
  const [primaryCalendarId, setPrimaryCalendarId] = useState<string>("");
  const [blockingCalendarIds, setBlockingCalendarIds] = useState<string[]>([]);
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
      setPrimaryCalendarId("");
      setBlockingCalendarIds([]);
      return;
    }
    const payload = (await response.json()) as GoogleCalendarsPayload;
    setCalendars(payload.calendars || []);
    const nextPrimary = payload.primary_calendar_id || payload.selected_calendar_ids?.[0] || "";
    const nextBlocking = payload.blocking_calendar_ids || payload.selected_calendar_ids || [];
    setPrimaryCalendarId(nextPrimary);
    setBlockingCalendarIds(nextBlocking);
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    loadCalendars();
  }, [status?.connected, loadCalendars]);

  const toggleBlockingCalendar = (calendarId: string) => {
    setCalendarMessage(null);
    setBlockingCalendarIds((prev) => {
      if (prev.includes(calendarId)) return prev.filter((id) => id !== calendarId);
      return [...prev, calendarId];
    });
  };

  const saveSelectedCalendars = async () => {
    if (!primaryCalendarId) {
      setCalendarMessage("Selecciona un calendario principal.");
      return;
    }

    const normalizedBlocking = Array.from(new Set([primaryCalendarId, ...blockingCalendarIds]));
    if (!normalizedBlocking.length) {
      setCalendarMessage("Selecciona al menos un calendario que bloquee disponibilidad.");
      return;
    }

    setSavingCalendars(true);
    setCalendarMessage(null);
    const response = await fetch("/api/gcal/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary_calendar_id: primaryCalendarId,
        blocking_calendar_ids: normalizedBlocking,
      }),
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

  const resolvedCalendarId =
    primaryCalendarId || status?.primary_calendar_id || status?.calendar_id || envCalendarId || "primary";
  const effectiveBlockingCalendarIds = useMemo(() => {
    if (blockingCalendarIds.length) return Array.from(new Set([resolvedCalendarId, ...blockingCalendarIds]));
    if (status?.blocking_calendar_ids?.length) return Array.from(new Set([resolvedCalendarId, ...status.blocking_calendar_ids]));
    if (status?.selected_calendar_ids?.length) return Array.from(new Set([resolvedCalendarId, ...status.selected_calendar_ids]));
    return [resolvedCalendarId];
  }, [blockingCalendarIds, resolvedCalendarId, status?.blocking_calendar_ids, status?.selected_calendar_ids]);
  const embedUrl = useMemo(() => {
    if (explicitEmbedUrl) return explicitEmbedUrl;
    if (!status?.connected && !envCalendarId) return "";
    return buildEmbedUrl(effectiveBlockingCalendarIds, timezone);
  }, [explicitEmbedUrl, status?.connected, envCalendarId, effectiveBlockingCalendarIds, timezone]);

  const editUrl = useMemo(() => {
    if (explicitEditUrl) return explicitEditUrl;
    return buildEditUrl(resolvedCalendarId);
  }, [explicitEditUrl, resolvedCalendarId]);

  const primaryCalendar = calendars.find((calendar) => calendar.id === resolvedCalendarId) || null;
  const blockingCalendarLabels = calendars
    .filter((calendar) => effectiveBlockingCalendarIds.includes(calendar.id))
    .map((calendar) => calendar.summary);

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
            Estado: {status?.connected ? "Conectado" : "No conectado"} · Calendario principal:{" "}
            <span className="font-medium text-foreground">{primaryCalendar?.summary || resolvedCalendarId}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Calendarios que bloquean disponibilidad:{" "}
            <span className="font-medium text-foreground">{effectiveBlockingCalendarIds.length}</span>
          </p>
          {status?.linked_email ? (
            <p className="text-xs text-muted-foreground">
              Cuenta vinculada: <span className="font-medium text-foreground">{status.linked_email}</span>
            </p>
          ) : null}
          {blockingCalendarLabels.length ? (
            <p className="text-xs text-muted-foreground">
              Calendarios activos: <span className="font-medium text-foreground">{blockingCalendarLabels.join(" · ")}</span>
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
          <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold">Calendario principal para crear citas</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Las nuevas citas que creen tus agentes se insertaran en este calendario.
                </p>
              </div>
              <Select value={resolvedCalendarId} onValueChange={(value) => setPrimaryCalendarId(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona el calendario principal" />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((calendar) => (
                    <SelectItem key={calendar.id} value={calendar.id}>
                      {calendar.summary}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Cuenta conectada: <span className="font-medium text-foreground">{status.linked_email || "Sin identificar"}</span>
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold">Calendarios que bloquean disponibilidad</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Selecciona los calendarios que tus agentes podran usar para gestionar citas. Si cualquiera de ellos
                tiene un evento, ese hueco no se ofrecera como disponible.
              </p>
              <div className="mt-3 max-h-56 space-y-2 overflow-auto rounded-md border border-border p-3">
                {calendars.length ? (
                  calendars.map((calendar) => {
                    const isPrimary = calendar.id === resolvedCalendarId;
                    const checked = effectiveBlockingCalendarIds.includes(calendar.id);
                    return (
                      <label key={calendar.id} className="flex cursor-pointer items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={checked}
                          disabled={isPrimary}
                          onChange={() => toggleBlockingCalendar(calendar.id)}
                        />
                        <span className="leading-5">
                          <span className="font-medium text-foreground">{calendar.summary}</span>
                          {calendar.primary ? <span className="text-xs text-muted-foreground"> · Principal de Google</span> : null}
                          {isPrimary ? <span className="text-xs text-muted-foreground"> · Calendario de reserva</span> : null}
                          <span className="block text-xs text-muted-foreground">{calendar.id}</span>
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <p className="text-xs text-muted-foreground">No se han encontrado calendarios disponibles en esta cuenta.</p>
                )}
              </div>
            </div>
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
