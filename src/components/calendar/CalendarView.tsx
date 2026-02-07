"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Appointment, BusyBlock, CalendarEvent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CalendarEventItem {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  extendedProps: {
    type: "appointment" | "busy" | "google";
    entityId: string;
  };
}

interface EditorState {
  type: "appointment" | "busy" | "google";
  entityId: string;
  title: string;
  startAt: string;
  endAt: string;
  notes: string;
  readOnly: boolean;
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

function labelForType(type: EditorState["type"]) {
  if (type === "appointment") return "Cita";
  if (type === "busy") return "Bloqueo";
  return "Google Calendar";
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

  const buildEvents = useCallback(
    (appointments: Appointment[], blocks: BusyBlock[], googleEvents: CalendarEvent[]) => {
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

      const busy = blocks.map((item) => ({
        id: `busy-${item.id}`,
        title: item.reason || "Bloqueo",
        start: item.start_at,
        end: item.end_at,
        backgroundColor: "#e6d8cc",
        borderColor: "#e6d8cc",
        textColor: "#2f3e46",
        extendedProps: { type: "busy" as const, entityId: item.id },
      }));

      const gcal = googleEvents.map((item) => ({
        id: `google-${item.id}`,
        title: item.title || "Ocupado (Google)",
        start: item.start_at,
        end: item.end_at,
        backgroundColor: "#d9e4ef",
        borderColor: "#d9e4ef",
        textColor: "#2f3e46",
        extendedProps: { type: "google" as const, entityId: item.id },
      }));

      setEvents([...appts, ...busy, ...gcal]);
    },
    []
  );

  const loadEvents = useCallback(async () => {
    if (!clinicId || !range) return;

    const [appointments, blocks, googleEvents] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .eq("clinic_id", clinicId)
        .lt("start_at", range.end)
        .gt("end_at", range.start),
      supabase
        .from("busy_blocks")
        .select("*")
        .eq("clinic_id", clinicId)
        .lt("start_at", range.end)
        .gt("end_at", range.start),
      supabase
        .from("calendar_events")
        .select("*")
        .eq("clinic_id", clinicId)
        .lt("start_at", range.end)
        .gt("end_at", range.start),
    ]);

    buildEvents(
      (appointments.data || []) as Appointment[],
      (blocks.data || []) as BusyBlock[],
      (googleEvents.data || []) as CalendarEvent[]
    );
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "busy_blocks", filter: `clinic_id=eq.${clinicId}` },
        loadEvents
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calendar_events", filter: `clinic_id=eq.${clinicId}` },
        loadEvents
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadEvents]);

  const handleSelect = async (info: { startStr: string; endStr: string }) => {
    if (!clinicId) return;

    const createAppointment = window.confirm("¿Quieres crear una cita? Aceptar = Cita · Cancelar = Bloqueo");

    if (createAppointment) {
      const title = window.prompt("Título de la cita", "Cita Coco Clinics");
      if (!title) return;

      await fetch("/api/appointments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_at: info.startStr,
          end_at: info.endStr,
          title,
          created_by: "staff",
        }),
      });
      return;
    }

    const reason = window.prompt("Motivo del bloqueo", "Bloqueo manual");
    if (!reason) return;

    await supabase.from("busy_blocks").insert({
      clinic_id: clinicId,
      start_at: info.startStr,
      end_at: info.endStr,
      reason,
      created_by_user_id: profile?.user_id,
    });
  };

  const handleEventDrop = async (eventInfo: any) => {
    const event = eventInfo.event;
    const type = event.extendedProps.type;
    const entityId = event.extendedProps.entityId;
    const startAt = event.start ? event.start.toISOString() : null;
    const endAt = event.end ? event.end.toISOString() : startAt;

    if (type === "busy") {
      await supabase.from("busy_blocks").update({ start_at: startAt, end_at: endAt }).eq("id", entityId);
    }

    if (type === "appointment") {
      await fetch("/api/appointments/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointment_id: entityId,
          start_at: startAt,
          end_at: endAt,
        }),
      });
    }
  };

  const handleEventClick = async (info: any) => {
    const type = info.event.extendedProps.type as EditorState["type"];
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
        readOnly: false,
      });
      return;
    }

    if (type === "busy") {
      const { data } = await supabase
        .from("busy_blocks")
        .select("id, reason, start_at, end_at")
        .eq("id", entityId)
        .single();

      if (!data) return;

      setEditor({
        type,
        entityId,
        title: data.reason || "Bloqueo",
        startAt: toLocalDateTimeInputValue(data.start_at),
        endAt: toLocalDateTimeInputValue(data.end_at),
        notes: "",
        readOnly: false,
      });
      return;
    }

    const { data } = await supabase
      .from("calendar_events")
      .select("id, title, start_at, end_at, status")
      .eq("id", entityId)
      .single();

    if (!data) return;

    setEditor({
      type,
      entityId,
      title: data.title || "Evento Google",
      startAt: toLocalDateTimeInputValue(data.start_at),
      endAt: toLocalDateTimeInputValue(data.end_at),
      notes: data.status || "confirmed",
      readOnly: true,
    });
  };

  const handleSaveEditor = async () => {
    if (!editor || editor.readOnly) return;

    const startAt = toIsoFromLocalInput(editor.startAt);
    const endAt = toIsoFromLocalInput(editor.endAt);

    if (!startAt || !endAt) {
      setEditorError("Fecha u hora inválida.");
      return;
    }

    if (new Date(endAt) <= new Date(startAt)) {
      setEditorError("La hora de fin debe ser posterior a la hora de inicio.");
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
            start_at: startAt,
            end_at: endAt,
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

      if (editor.type === "busy") {
        const { error } = await supabase
          .from("busy_blocks")
          .update({
            reason: editor.title,
            start_at: startAt,
            end_at: endAt,
          })
          .eq("id", editor.entityId);

        if (error) {
          setEditorError(error.message || "No se pudo actualizar el bloqueo.");
          return;
        }
      }

      setEditor(null);
      await loadEvents();
    } finally {
      setSaving(false);
    }
  };

const handleDeleteEditor = async () => {
  if (!editor || editor.readOnly || editor.type !== "busy") return;

    setSaving(true);
    setEditorError(null);

    try {
      if (editor.type === "busy") {
        const { error } = await supabase.from("busy_blocks").delete().eq("id", editor.entityId);
        if (error) {
          setEditorError(error.message || "No se pudo eliminar el bloqueo.");
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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

        <p className="font-display text-lg capitalize">{calendarTitle}</p>

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
            <div className="md:col-span-2 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Detalle de evento</p>
                <p className="text-sm font-medium">{labelForType(editor.type)}</p>
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
                disabled={editor.readOnly || saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-start">Inicio</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={editor.startAt}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, startAt: event.target.value } : prev))}
                disabled={editor.readOnly || saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-end">Fin</Label>
              <Input
                id="event-end"
                type="datetime-local"
                value={editor.endAt}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, endAt: event.target.value } : prev))}
                disabled={editor.readOnly || saving}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="event-notes">Detalle</Label>
              <Textarea
                id="event-notes"
                rows={3}
                value={editor.notes}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
                disabled={editor.readOnly || saving || editor.type === "busy"}
              />
            </div>

            {editorError ? <p className="md:col-span-2 text-sm text-rose-600">{editorError}</p> : null}

          <div className="md:col-span-2 flex items-center justify-end gap-2">
            {!editor.readOnly ? (
              <>
                {editor.type === "busy" ? (
                  <Button type="button" variant="outline" onClick={handleDeleteEditor} disabled={saving}>
                    Eliminar
                  </Button>
                ) : null}
                <Button type="button" onClick={handleSaveEditor} disabled={saving}>
                  {saving ? "Guardando..." : "Guardar cambios"}
                </Button>
              </>
              ) : (
                <p className="text-sm text-muted-foreground">Evento de Google (solo lectura)</p>
              )}
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
        selectable
        editable
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
        eventAllow={(_, draggedEvent) => (draggedEvent?.extendedProps?.type || "") !== "google"}
        eventResizableFromStart
        select={handleSelect}
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
