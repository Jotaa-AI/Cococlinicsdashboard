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
import type { Appointment } from "@/lib/types";
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
    sourceId: string;
    entryType: EntryType;
    reason?: string | null;
    leadName?: string | null;
    leadPhone?: string | null;
    formTitle?: string | null;
    notes?: string | null;
  };
}

interface DraftEntryState {
  sourceId?: string;
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
  if (item.entry_type === "internal_block") {
    return item.title || item.notes || "No disponible";
  }
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
    leadPhone: "",
  };
}

export function CalendarView() {
  const calendarRef = useRef<FullCalendar | null>(null);
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<Appointment[]>([]);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [calendarTitle, setCalendarTitle] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [draftEntry, setDraftEntry] = useState<DraftEntryState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const buildEvents = useCallback((appointments: Appointment[]) => {
    const mapped: CalendarEventItem[] = appointments.map((item) => ({
      id: `appointment-${item.id}`,
      title: buildAppointmentTitle(item),
      start: item.start_at,
      end: item.end_at,
      backgroundColor: item.entry_type === "internal_block" ? "#d95f4f" : "#233b57",
      borderColor: item.entry_type === "internal_block" ? "#d95f4f" : "#233b57",
      textColor: "#fff",
      extendedProps: {
        sourceId: item.id,
        entryType: item.entry_type === "internal_block" ? "busy_block" : "appointment",
        leadName: item.entry_type === "internal_block" ? null : item.lead_name,
        leadPhone: item.entry_type === "internal_block" ? null : item.lead_phone,
        formTitle: item.title,
        notes: item.notes,
        reason: item.entry_type === "internal_block" ? item.title || item.notes : null,
      },
    }));

    setEvents(mapped);
  }, []);

  const loadEvents = useCallback(async () => {
    if (!clinicId || !range) return;

    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("clinic_id", clinicId)
      .lt("start_at", range.end)
      .gt("end_at", range.start)
      .neq("status", "canceled")
      .order("start_at", { ascending: true });

    if (error) {
      return;
    }

    buildEvents((data || []) as Appointment[]);
  }, [buildEvents, clinicId, range, supabase]);

  const loadUpcomingAppointments = useCallback(async () => {
    if (!clinicId) return;

    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("status", "scheduled")
      .gte("start_at", new Date().toISOString())
      .order("start_at", { ascending: true })
      .limit(8);

    if (error) return;

    setUpcomingAppointments(
      ((data || []) as Appointment[]).filter((item) => item.entry_type !== "internal_block")
    );
  }, [clinicId, supabase]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    loadUpcomingAppointments();
  }, [loadUpcomingAppointments]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel("calendar-events-readonly")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        () => {
          loadEvents();
          loadUpcomingAppointments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, loadEvents, loadUpcomingAppointments, supabase]);

  const calendarPlugins = useMemo(() => [timeGridPlugin, dayGridPlugin, interactionPlugin], []);

  const openCreateDialog = useCallback((start: Date, end?: Date) => {
    setDialogMode("create");
    setDraftEntry(getDraftFromDates(start, end));
    setFormError(null);
    setFormNotice(null);
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

    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return;

    const entryType = arg.event.extendedProps.entryType === "busy_block" ? "busy_block" : "appointment";
    const rawTitle = String(arg.event.extendedProps.formTitle || arg.event.extendedProps.reason || "");
    const fallbackLeadName = rawTitle.split(" · ")[0]?.trim() || rawTitle;
    setDialogMode("edit");
    setDraftEntry({
      sourceId: String(arg.event.extendedProps.sourceId),
      type: entryType,
      date: toDateInputValue(start),
      startTime: toTimeInputValue(start),
      endTime: toTimeInputValue(end),
      title: rawTitle,
      leadName: entryType === "appointment" ? String(arg.event.extendedProps.leadName || fallbackLeadName || "") : "",
      leadPhone: entryType === "appointment" ? String(arg.event.extendedProps.leadPhone || "") : "",
    });
    setFormError(null);
    setFormNotice(null);
    setDialogOpen(true);
  }, []);

  const handleDraftChange = useCallback(<K extends keyof DraftEntryState>(field: K, value: DraftEntryState[K]) => {
    setDraftEntry((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setDraftEntry(null);
    setFormError(null);
    setFormNotice(null);
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

    if (draftEntry.type === "appointment") {
      const trimmedLeadName = draftEntry.leadName.trim();
      const trimmedLeadPhoneRaw = draftEntry.leadPhone.trim();
      const normalizedPhone = normalizeEsPhone(trimmedLeadPhoneRaw);

      if (dialogMode === "create") {
        if (!trimmedLeadName || !normalizedPhone) {
          setFormError("Nombre y teléfono en formato +34 son obligatorios para una cita.");
          return;
        }
      } else {
        const hasAnyLeadInput = Boolean(trimmedLeadName || trimmedLeadPhoneRaw);
        if (hasAnyLeadInput && (!trimmedLeadName || !normalizedPhone)) {
          setFormError("Si editas datos del lead, indica nombre y teléfono completo en formato +34.");
          return;
        }
      }

      const payload = {
        title: draftEntry.title.trim(),
        notes: draftEntry.title.trim(),
        ...(trimmedLeadName && normalizedPhone
          ? {
              lead_name: trimmedLeadName,
              lead_phone: normalizedPhone,
            }
          : {}),
        start_at: slot.startAt,
        end_at: slot.endAt,
        ...(dialogMode === "edit"
          ? { appointment_id: draftEntry.sourceId }
          : { entry_type: "appointment", created_by: "staff" }),
      };

      try {
        setLoading(true);
        const response = await fetch(
          dialogMode === "edit" ? "/api/appointments/reschedule" : "/api/appointments/manual-booking",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        const responsePayload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setFormError(responsePayload?.error || "No se pudo guardar el cambio en agenda.");
          return;
        }

        resetDialog();
        loadEvents();
        return;
      } catch {
        setFormError("No se pudo guardar el cambio en agenda.");
        return;
      } finally {
        setLoading(false);
      }
    }

    const payload = {
      entry_type: "busy_block",
      title: draftEntry.title.trim(),
      reason: draftEntry.title.trim(),
      notes: draftEntry.title.trim(),
      start_at: slot.startAt,
      end_at: slot.endAt,
      created_by: "staff",
    };

    try {
      setLoading(true);
      const response = await fetch(
        dialogMode === "edit" ? "/api/appointments/reschedule" : "/api/appointments/manual-booking",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            dialogMode === "edit"
              ? {
                  appointment_id: draftEntry.sourceId,
                  title: draftEntry.title.trim(),
                  notes: draftEntry.title.trim(),
                  start_at: slot.startAt,
                  end_at: slot.endAt,
                }
              : payload
          ),
        }
      );

      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFormError(responsePayload?.error || "No se pudo guardar el cambio en agenda.");
        return;
      }

      resetDialog();
      loadEvents();
    } catch {
      setFormError("No se pudo guardar el cambio en agenda.");
    } finally {
      setLoading(false);
    }
  }, [dialogMode, draftEntry, loadEvents, resetDialog]);

  const handleCancelAppointment = useCallback(async () => {
    if (!draftEntry?.sourceId || dialogMode !== "edit") {
      return;
    }

    setFormError(null);
    setFormNotice(null);

    try {
      setLoading(true);
      const response = await fetch("/api/appointments/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointment_id: draftEntry.sourceId,
          reason:
            draftEntry.type === "appointment"
              ? `Cancelada desde la agenda de la app${draftEntry.title.trim() ? `: ${draftEntry.title.trim()}` : ""}`
              : `Bloqueo eliminado desde la agenda de la app${draftEntry.title.trim() ? `: ${draftEntry.title.trim()}` : ""}`,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFormError(payload?.error || "No se pudo cancelar la cita.");
        return;
      }

      if (payload?.warning) {
        setFormNotice(payload.warning);
      }

      resetDialog();
      loadEvents();
    } catch {
      setFormError("No se pudo cancelar la cita.");
    } finally {
      setLoading(false);
    }
  }, [dialogMode, draftEntry, loadEvents, resetDialog]);

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

      <div className="rounded-3xl border border-border bg-white/80 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Próximas citas</p>
            <p className="text-xs text-muted-foreground">
              Solo se muestran visitas futuras de leads o pacientes.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {upcomingAppointments.length} próximas
          </span>
        </div>

        {upcomingAppointments.length ? (
          <div className="space-y-3">
            {upcomingAppointments.map((appointment) => (
              <div
                key={appointment.id}
                className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {appointment.lead_name || appointment.title || "Cita sin nombre"}
                  </p>
                  <p className="text-xs text-slate-600">
                    {new Date(appointment.start_at).toLocaleString("es-ES", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}{" "}
                    · {appointment.title || "Valoración gratuita"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {appointment.lead_phone || "Sin teléfono"} {appointment.notes ? `· ${appointment.notes}` : ""}
                  </p>
                </div>

                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                  {appointment.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No hay próximas citas agendadas.</p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(nextOpen) => (nextOpen ? setDialogOpen(true) : resetDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "edit" ? "Editar cita" : "Nuevo elemento en agenda"}
            </DialogTitle>
            <DialogDescription>
              Igual que en Google Calendar: define el tipo, el título y el tramo horario. Los horarios funcionan en intervalos de 30 minutos.
            </DialogDescription>
          </DialogHeader>

          {draftEntry ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {dialogMode === "create" ? (
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
              ) : null}

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
                          handleDraftChange("leadPhone", "");
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
              {formNotice ? <p className="md:col-span-2 text-sm text-amber-600">{formNotice}</p> : null}

              <div className="md:col-span-2 flex justify-end gap-2">
                {dialogMode === "edit" ? (
                  <Button type="button" variant="outline" onClick={handleCancelAppointment} disabled={loading}>
                    {loading ? "Cancelando..." : draftEntry.type === "appointment" ? "Cancelar cita" : "Eliminar bloqueo"}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={resetDialog} disabled={loading}>
                  Cerrar
                </Button>
                <Button type="button" onClick={handleSave} disabled={loading}>
                  {loading ? "Guardando..." : dialogMode === "edit" ? "Guardar cambios" : "Guardar"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
