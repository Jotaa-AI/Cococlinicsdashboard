"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import type { EventClickArg, EventInput, DateSelectArg } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Appointment, BusyBlock } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CLOSE_HOUR, OPEN_HOUR, SLOT_MINUTES, validateBusyBlockRange, validateSlotRange } from "@/lib/calendar/slot-rules";

type EntryType = "appointment" | "busy_block";

interface CalendarEventItem extends EventInput {
  extendedProps: {
    entryType: EntryType;
    reason?: string | null;
    leadName?: string | null;
    leadPhone?: string | null;
  };
}

interface DraftEntryState {
  type: EntryType;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  leadName: string;
  leadPhone: string;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInputValue(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addMinutesToTime(value: string, minutes: number) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setMinutes(date.getMinutes() + minutes);
  return toTimeInputValue(date);
}

function normalizeEsPhone(rawPhone: string) {
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("34")) digits = digits.slice(2);

  if (!/^\d{9}$/.test(digits)) return null;
  return `+34${digits}`;
}

function buildAppointmentTitle(item: Appointment) {
  const label = item.lead_name || item.title || "Cita";
  const treatment = item.title && item.lead_name ? item.title : null;
  return treatment ? `${label} · ${treatment}` : label;
}

function getDefaultSlotStart(date: Date) {
  const output = new Date(date);
  output.setSeconds(0, 0);

  if (output.getMinutes() === 0 || output.getMinutes() === 30) {
    return output;
  }

  if (output.getMinutes() < 30) {
    output.setMinutes(30);
    return output;
  }

  output.setHours(output.getHours() + 1);
  output.setMinutes(0);
  return output;
}

function getDefaultClickDate(clickedDate: Date) {
  const now = new Date();
  const base = new Date(clickedDate);

  if (base.getHours() === 0 && base.getMinutes() === 0) {
    const isToday =
      base.getFullYear() === now.getFullYear() &&
      base.getMonth() === now.getMonth() &&
      base.getDate() === now.getDate();
    const targetHour = isToday ? Math.min(Math.max(getDefaultSlotStart(now).getHours(), OPEN_HOUR), CLOSE_HOUR - 1) : OPEN_HOUR;
    base.setHours(targetHour, isToday ? getDefaultSlotStart(now).getMinutes() : 0, 0, 0);
  }

  return getDefaultSlotStart(base);
}

function getDraftFromDates(start: Date, end?: Date): DraftEntryState {
  const safeStart = getDefaultClickDate(start);
  const safeEnd = end && end.getTime() > safeStart.getTime() ? end : new Date(safeStart.getTime() + SLOT_MINUTES * 60 * 1000);

  return {
    type: "appointment",
    date: toDateInputValue(safeStart),
    startTime: toTimeInputValue(safeStart),
    endTime: toTimeInputValue(safeEnd),
    title: "",
    leadName: "",
    leadPhone: "+34",
  };
}

export function CalendarView() {
  const calendarRef = useRef<FullCalendar | null>(null);
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [calendarTitle, setCalendarTitle] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftEntry, setDraftEntry] = useState<DraftEntryState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const buildEvents = useCallback((appointments: Appointment[], blocks: BusyBlock[]) => {
    const appts: CalendarEventItem[] = appointments.map((item) => ({
      id: `appointment-${item.id}`,
      title: buildAppointmentTitle(item),
      start: item.start_at,
      end: item.end_at,
      backgroundColor: "#233b57",
      borderColor: "#233b57",
      textColor: "#fff",
      extendedProps: {
        entryType: "appointment",
        leadName: item.lead_name,
        leadPhone: item.lead_phone,
      },
    }));

    const busy: CalendarEventItem[] = blocks.map((item) => ({
      id: `busy-block-${item.id}`,
      title: item.reason || "Bloqueado",
      start: item.start_at,
      end: item.end_at,
      backgroundColor: "#d95f4f",
      borderColor: "#d95f4f",
      textColor: "#fff",
      extendedProps: {
        entryType: "busy_block",
        reason: item.reason,
      },
    }));

    setEvents([...appts, ...busy]);
  }, []);

  const loadEvents = useCallback(async () => {
    if (!clinicId || !range) return;

    const [appointmentsResponse, busyBlocksResponse] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .eq("clinic_id", clinicId)
        .lt("start_at", range.end)
        .gt("end_at", range.start)
        .neq("status", "canceled")
        .order("start_at", { ascending: true }),
      supabase
        .from("busy_blocks")
        .select("*")
        .eq("clinic_id", clinicId)
        .lt("start_at", range.end)
        .gt("end_at", range.start)
        .order("start_at", { ascending: true }),
    ]);

    buildEvents(
      (appointmentsResponse.data || []) as Appointment[],
      (busyBlocksResponse.data || []) as BusyBlock[]
    );
  }, [buildEvents, clinicId, range, supabase]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel("calendar-events-readonly")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        loadEvents
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "busy_blocks", filter: `clinic_id=eq.${clinicId}` },
        loadEvents
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, loadEvents, supabase]);

  const calendarPlugins = useMemo(() => [timeGridPlugin, dayGridPlugin, interactionPlugin], []);

  const openCreateDialog = useCallback((start: Date, end?: Date) => {
    setDraftEntry(getDraftFromDates(start, end));
    setFormError(null);
    setDialogOpen(true);
  }, []);

  const handleDateClick = useCallback((arg: DateClickArg) => {
    openCreateDialog(arg.date);
  }, [openCreateDialog]);

  const handleSelect = useCallback((arg: DateSelectArg) => {
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.unselect();
    openCreateDialog(arg.start, arg.end);
  }, [openCreateDialog]);

  const handleEventClick = useCallback((arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
  }, []);

  const handleDraftChange = useCallback(<K extends keyof DraftEntryState>(field: K, value: DraftEntryState[K]) => {
    setDraftEntry((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setDraftEntry(null);
    setFormError(null);
    setLoading(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draftEntry) return;

    setFormError(null);
    const startAt = new Date(`${draftEntry.date}T${draftEntry.startTime}:00`);
    const endAt = new Date(`${draftEntry.date}T${draftEntry.endTime}:00`);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      setFormError("Fecha u hora no válida.");
      return;
    }

    const validator = draftEntry.type === "busy_block" ? validateBusyBlockRange : validateSlotRange;
    const slot = validator({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });

    if (!slot.ok) {
      setFormError(slot.error);
      return;
    }

    if (!draftEntry.title.trim()) {
      setFormError(draftEntry.type === "busy_block" ? "El motivo es obligatorio." : "El título es obligatorio.");
      return;
    }

    const payload: Record<string, string> = {
      entry_type: draftEntry.type,
      title: draftEntry.title.trim(),
      reason: draftEntry.title.trim(),
      notes: draftEntry.title.trim(),
      start_at: slot.startAt,
      end_at: slot.endAt,
      created_by: "staff",
    };

    if (draftEntry.type === "appointment") {
      const normalizedPhone = normalizeEsPhone(draftEntry.leadPhone);
      if (!draftEntry.leadName.trim() || !normalizedPhone) {
        setFormError("Nombre y teléfono en formato +34 son obligatorios para una cita.");
        return;
      }

      payload.lead_name = draftEntry.leadName.trim();
      payload.lead_phone = normalizedPhone;
      payload.title = draftEntry.title.trim();
    }

    try {
      setLoading(true);
      const response = await fetch("/api/appointments/manual-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        setFormError(errorPayload?.error || "No se pudo guardar el cambio en agenda.");
        return;
      }

      resetDialog();
      loadEvents();
    } catch {
      setFormError("No se pudo guardar el cambio en agenda.");
    } finally {
      setLoading(false);
    }
  }, [draftEntry, loadEvents, resetDialog]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => calendarRef.current?.getApi().prev()}>
            ←
          </Button>
          <Button type="button" variant="outline" onClick={() => calendarRef.current?.getApi().next()}>
            →
          </Button>
          <Button type="button" variant="outline" onClick={() => calendarRef.current?.getApi().today()}>
            Hoy
          </Button>
        </div>

        <p className="font-display text-base capitalize md:text-lg">{calendarTitle}</p>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => calendarRef.current?.getApi().changeView("dayGridMonth")}
          >
            Mes
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => calendarRef.current?.getApi().changeView("timeGridWeek")}
          >
            Semana
          </Button>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-white/70 p-4 text-sm text-muted-foreground">
        Haz clic en un día o franja horaria para crear una cita o bloquear horas. Todas las altas se guardan en Supabase y se reflejan al instante.
      </div>

      <FullCalendar
        ref={calendarRef}
        plugins={calendarPlugins}
        locales={[esLocale]}
        locale="es"
        initialView="dayGridMonth"
        height="auto"
        events={events}
        selectable
        selectMirror
        editable={false}
        eventDurationEditable={false}
        allDaySlot={false}
        slotDuration="00:30:00"
        snapDuration="00:30:00"
        slotMinTime="09:00:00"
        slotMaxTime="19:00:00"
        businessHours={{
          daysOfWeek: [1, 2, 3, 4, 5],
          startTime: "09:00",
          endTime: "19:00",
        }}
        slotLabelFormat={{
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }}
        eventTimeFormat={{
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }}
        titleFormat={{ year: "numeric", month: "long", day: "numeric" }}
        headerToolbar={false}
        dayMaxEventRows={3}
        select={handleSelect}
        dateClick={handleDateClick}
        eventClick={handleEventClick}
        datesSet={(arg) => {
          setCalendarTitle(arg.view.title);
          setRange((prev) => {
            const next = { start: arg.startStr, end: arg.endStr };
            if (prev && prev.start === next.start && prev.end === next.end) return prev;
            return next;
          });
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={(nextOpen) => (nextOpen ? setDialogOpen(true) : resetDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo elemento en agenda</DialogTitle>
            <DialogDescription>
              Igual que en Google Calendar: define el tipo, el título y el tramo horario. Los horarios funcionan en intervalos de 30 minutos.
            </DialogDescription>
          </DialogHeader>

          {draftEntry ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label>Tipo</Label>
                <Select
                  value={draftEntry.type}
                  onValueChange={(value: EntryType) => handleDraftChange("type", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="appointment">Cita</SelectItem>
                    <SelectItem value="busy_block">Bloqueo de horas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="calendar-entry-title">
                  {draftEntry.type === "busy_block" ? "Motivo" : "Título"}
                </Label>
                <Input
                  id="calendar-entry-title"
                  value={draftEntry.title}
                  onChange={(event) => handleDraftChange("title", event.target.value)}
                  placeholder={
                    draftEntry.type === "busy_block"
                      ? "Ej. Hora en el médico"
                      : "Ej. Valoración gratuita"
                  }
                />
              </div>

              {draftEntry.type === "appointment" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="calendar-entry-lead-name">Nombre del lead</Label>
                    <Input
                      id="calendar-entry-lead-name"
                      value={draftEntry.leadName}
                      onChange={(event) => handleDraftChange("leadName", event.target.value)}
                      placeholder="Nombre completo"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="calendar-entry-lead-phone">Teléfono</Label>
                    <Input
                      id="calendar-entry-lead-phone"
                      value={draftEntry.leadPhone}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/\D/g, "");
                        if (!digits) {
                          handleDraftChange("leadPhone", "+34");
                          return;
                        }

                        if (digits.startsWith("34")) {
                          handleDraftChange("leadPhone", `+${digits.slice(0, 11)}`);
                          return;
                        }

                        handleDraftChange("leadPhone", `+34${digits.slice(0, 9)}`);
                      }}
                      placeholder="+34600111222"
                    />
                  </div>
                </>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="calendar-entry-date">Día</Label>
                <Input
                  id="calendar-entry-date"
                  type="date"
                  value={draftEntry.date}
                  onChange={(event) => handleDraftChange("date", event.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="calendar-entry-start">Hora inicio</Label>
                <Input
                  id="calendar-entry-start"
                  type="time"
                  step={1800}
                  min={`${pad(OPEN_HOUR)}:00`}
                  max={`${pad(CLOSE_HOUR - 1)}:30`}
                  value={draftEntry.startTime}
                  onChange={(event) => {
                    handleDraftChange("startTime", event.target.value);
                    if (event.target.value >= draftEntry.endTime) {
                      handleDraftChange("endTime", addMinutesToTime(event.target.value, SLOT_MINUTES));
                    }
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="calendar-entry-end">Hora fin</Label>
                <Input
                  id="calendar-entry-end"
                  type="time"
                  step={1800}
                  min={`${pad(OPEN_HOUR)}:30`}
                  max={`${pad(CLOSE_HOUR)}:00`}
                  value={draftEntry.endTime}
                  onChange={(event) => handleDraftChange("endTime", event.target.value)}
                />
              </div>

              <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                El tramo puede durar más de 30 minutos, pero siempre en saltos de media hora.
              </div>

              {formError ? <p className="md:col-span-2 text-sm text-rose-600">{formError}</p> : null}

              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetDialog} disabled={loading}>
                  Cancelar
                </Button>
                <Button type="button" onClick={handleSave} disabled={loading}>
                  {loading ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
