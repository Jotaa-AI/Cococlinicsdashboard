"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Appointment, BusyBlock } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface CalendarEventItem {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
}

function buildAppointmentTitle(item: Appointment) {
  const label = item.lead_name || item.title || "Cita";
  const treatment = item.title && item.lead_name ? item.title : null;
  return treatment ? `${label} · ${treatment}` : label;
}

export function CalendarView() {
  const calendarRef = useRef<FullCalendar | null>(null);
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [calendarTitle, setCalendarTitle] = useState("");

  const buildEvents = useCallback((appointments: Appointment[], blocks: BusyBlock[]) => {
    const appts = appointments.map((item) => ({
      id: `appointment-${item.id}`,
      title: buildAppointmentTitle(item),
      start: item.start_at,
      end: item.end_at,
      backgroundColor: "#233b57",
      borderColor: "#233b57",
      textColor: "#fff",
    }));

    const busy = blocks.map((item) => ({
      id: `busy-block-${item.id}`,
      title: `No disponible · ${item.reason || "Bloqueado"}`,
      start: item.start_at,
      end: item.end_at,
      backgroundColor: "#d95f4f",
      borderColor: "#d95f4f",
      textColor: "#fff",
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

      <FullCalendar
        ref={calendarRef}
        plugins={calendarPlugins}
        locales={[esLocale]}
        locale="es"
        initialView="dayGridMonth"
        height="auto"
        events={events}
        selectable={false}
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
