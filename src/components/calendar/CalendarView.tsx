"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Appointment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CLOSE_HOUR, OPEN_HOUR, SLOT_MINUTES, validateSlotRange } from "@/lib/calendar/slot-rules";

interface CalendarEventItem {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  extendedProps: {
    type: "appointment";
    entityId: string;
  };
}

interface EditorState {
  type: "appointment";
  entityId: string;
  title: string;
  startAt: string;
  endAt: string;
  notes: string;
}

function toLocalDateTimeInputValue(isoValue: string) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function toIsoFromLocalInput(localValue: string) {
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toLocalInputPlusMinutes(localValue: string, minutes: number) {
  const baseDate = new Date(localValue);
  if (Number.isNaN(baseDate.getTime())) return null;
  const nextDate = new Date(baseDate.getTime() + minutes * 60 * 1000);
  return toLocalDateTimeInputValue(nextDate.toISOString());
}

export function CalendarView() {
  const calendarRef = useRef<FullCalendar | null>(null);
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [calendarTitle, setCalendarTitle] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const buildEvents = useCallback((appointments: Appointment[]) => {
    const appts = appointments.map((item) => ({
      id: `appointment-${item.id}`,
      title: item.title || "Cita agendada",
      start: item.start_at,
      end: item.end_at,
      backgroundColor: "#2f3e46",
      borderColor: "#2f3e46",
      textColor: "#fff",
      extendedProps: { type: "appointment" as const, entityId: item.id },
    }));

    setEvents(appts);
  }, []);

  const loadEvents = useCallback(async () => {
    if (!clinicId || !range) return;

    const { data } = await supabase
      .from("appointments")
      .select("*")
      .eq("clinic_id", clinicId)
      .lt("start_at", range.end)
      .gt("end_at", range.start)
      .neq("status", "canceled");

    buildEvents((data || []) as Appointment[]);
  }, [supabase, clinicId, range, buildEvents]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel("calendar-events")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        loadEvents
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadEvents]);

  const handleEventDrop = async (eventInfo: any) => {
    const event = eventInfo.event;
    const type = event.extendedProps.type;
    const entityId = event.extendedProps.entityId;
    const startAt = event.start ? event.start.toISOString() : null;
    const endAt = event.end ? event.end.toISOString() : startAt;
    const slot = validateSlotRange({
      startAt: String(startAt || ""),
      endAt: String(endAt || ""),
    });

    if (!slot.ok) {
      eventInfo.revert();
      window.alert(slot.error);
      return;
    }

    if (type === "appointment") {
      const response = await fetch("/api/appointments/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointment_id: entityId,
          start_at: slot.startAt,
          end_at: slot.endAt,
        }),
      });

      if (!response.ok) {
        eventInfo.revert();
        const payload = await response.json().catch(() => ({}));
        window.alert(payload.error || "No se pudo mover la cita.");
      }
    }
  };

  const handleEventClick = async (info: any) => {
    const type = info.event.extendedProps.type as "appointment";
    const entityId = info.event.extendedProps.entityId as string;
    setEditorError(null);

    if (type === "appointment") {
      const { data } = await supabase
        .from("appointments")
        .select("id, title, start_at, end_at, notes")
        .eq("id", entityId)
        .single();

      if (!data) return;

      setEditor({
        type,
        entityId,
        title: data.title || "Cita",
        startAt: toLocalDateTimeInputValue(data.start_at),
        endAt: toLocalDateTimeInputValue(data.end_at),
        notes: data.notes || "",
      });
      return;
    }
  };

  const handleSaveEditor = async () => {
    if (!editor) return;

    const startAt = toIsoFromLocalInput(editor.startAt);
    const endAt = toIsoFromLocalInput(editor.endAt);

    if (!startAt || !endAt) {
      setEditorError("Fecha u hora inválida.");
      return;
    }

    const slot = validateSlotRange({ startAt, endAt });
    if (!slot.ok) {
      setEditorError(slot.error);
      return;
    }

    setSaving(true);
    setEditorError(null);

    try {
      if (editor.type === "appointment") {
        const response = await fetch("/api/appointments/reschedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appointment_id: editor.entityId,
            start_at: slot.startAt,
            end_at: slot.endAt,
            title: editor.title,
            notes: editor.notes,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setEditorError(payload.error || "No se pudo actualizar la cita.");
          return;
        }
      }

      setEditor(null);
      await loadEvents();
    } finally {
      setSaving(false);
    }
  };

  const calendarPlugins = useMemo(() => [timeGridPlugin, dayGridPlugin, interactionPlugin], []);

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

      {editor ? (
        <Card className="p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Detalle de evento</p>
                <p className="text-sm font-medium">Cita</p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setEditor(null)}>
                Cerrar
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-title">Título / Motivo</Label>
              <Input
                id="event-title"
                value={editor.title}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-start">Inicio</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={editor.startAt}
                step={1800}
                onChange={(event) =>
                  setEditor((prev) => {
                    if (!prev) return prev;
                    const nextStart = event.target.value;
                    const nextEnd = toLocalInputPlusMinutes(nextStart, SLOT_MINUTES);
                    return {
                      ...prev,
                      startAt: nextStart,
                      endAt: nextEnd || prev.endAt,
                    };
                  })
                }
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-end">Fin</Label>
              <Input
                id="event-end"
                type="datetime-local"
                value={editor.endAt}
                step={1800}
                disabled
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="event-notes">Detalle</Label>
              <Textarea
                id="event-notes"
                rows={3}
                value={editor.notes}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
                disabled={saving}
              />
            </div>

            <p className="md:col-span-2 text-xs text-muted-foreground">
              Duracion fija de {SLOT_MINUTES} minutos entre {OPEN_HOUR}:00 y {CLOSE_HOUR}:00.
            </p>

            {editorError ? <p className="md:col-span-2 text-sm text-rose-600">{editorError}</p> : null}

          <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={handleSaveEditor} disabled={saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <FullCalendar
        ref={calendarRef}
        plugins={calendarPlugins}
        locales={[esLocale]}
        locale="es"
        initialView="dayGridMonth"
        height="auto"
        events={events}
        selectable={false}
        editable
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
        eventAllow={(dropInfo) => {
          if (!dropInfo.start || !dropInfo.end) return false;
          const slot = validateSlotRange({
            startAt: dropInfo.start.toISOString(),
            endAt: dropInfo.end.toISOString(),
          });
          return slot.ok;
        }}
        eventResizableFromStart
        dayMaxEventRows={2}
        eventDrop={handleEventDrop}
        eventResize={handleEventDrop}
        eventClick={handleEventClick}
        headerToolbar={false}
        datesSet={(arg) => {
          setCalendarTitle(arg.view.title);
          setRange((prev) => {
            const next = { start: arg.startStr, end: arg.endStr };
            if (prev && prev.start === next.start && prev.end === next.end) {
              return prev;
            }
            return next;
          });
        }}
      />
    </div>
  );
}
