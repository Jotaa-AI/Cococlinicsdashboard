import { getGoogleOAuthClient, getGoogleCalendarClient } from "@/lib/google/client";
import { decryptToken } from "@/lib/google/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Appointment } from "@/lib/types";

interface CalendarConnection {
  id: string;
  clinic_id: string;
  google_refresh_token: string;
  calendar_id: string;
  sync_token: string | null;
}

function getEventStart(event: { start?: { dateTime?: string | null; date?: string | null } }) {
  return event.start?.dateTime || event.start?.date || null;
}

function getEventEnd(event: { end?: { dateTime?: string | null; date?: string | null } }) {
  return event.end?.dateTime || event.end?.date || null;
}

async function getConnection(clinicId: string) {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("calendar_connections")
    .select("*")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  return data as CalendarConnection | null;
}

async function getAuthedCalendar(connection: CalendarConnection) {
  const refreshToken = decryptToken(connection.google_refresh_token);
  const auth = getGoogleOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return getGoogleCalendarClient(auth);
}

export async function syncGoogleCalendar(clinicId: string) {
  const connection = await getConnection(clinicId);
  if (!connection) return { ok: false, message: "No calendar connection" };

  const calendar = await getAuthedCalendar(connection);
  const supabase = createSupabaseAdminClient();
  const timeMin = new Date().toISOString();
  const timeMax = new Date(new Date().setDate(new Date().getDate() + 60)).toISOString();

  let syncToken = connection.sync_token || undefined;
  let response;

  try {
    response = await calendar.events.list({
      calendarId: connection.calendar_id,
      singleEvents: true,
      showDeleted: true,
      timeMin: syncToken ? undefined : timeMin,
      timeMax: syncToken ? undefined : timeMax,
      syncToken,
    });
  } catch (error: any) {
    if (error?.code === 410) {
      syncToken = undefined;
      response = await calendar.events.list({
        calendarId: connection.calendar_id,
        singleEvents: true,
        showDeleted: true,
        timeMin,
        timeMax,
      });
    } else {
      throw error;
    }
  }

  const items = response?.data.items || [];
  const cancelled = items.filter((event) => event.status === "cancelled" && event.id).map((event) => event.id!);

  if (cancelled.length) {
    await supabase.from("calendar_events").delete().in("gcal_event_id", cancelled).eq("clinic_id", clinicId);
  }

  const upserts = items
    .filter((event) => event.status !== "cancelled" && getEventStart(event) && getEventEnd(event))
    .map((event) => ({
      clinic_id: clinicId,
      source: "google",
      gcal_event_id: event.id,
      title: event.summary || "Ocupado",
      start_at: getEventStart(event),
      end_at: getEventEnd(event),
      status: event.status,
      updated_at: new Date().toISOString(),
    }));

  if (upserts.length) {
    await supabase
      .from("calendar_events")
      .upsert(upserts, { onConflict: "clinic_id,gcal_event_id" });
  }

  if (response?.data.nextSyncToken) {
    await supabase
      .from("calendar_connections")
      .update({ sync_token: response.data.nextSyncToken })
      .eq("id", connection.id);
  }

  return { ok: true, count: upserts.length };
}

export async function exportAppointmentToGoogle(appointment: Appointment, clinicId: string) {
  const connection = await getConnection(clinicId);
  if (!connection) return null;
  const calendar = await getAuthedCalendar(connection);

  const eventPayload = {
    summary: appointment.title || "Cita Coco Clinics",
    description: appointment.notes || "Cita creada desde el dashboard",
    start: { dateTime: appointment.start_at },
    end: { dateTime: appointment.end_at },
  };

  if (appointment.gcal_event_id) {
    await calendar.events.update({
      calendarId: connection.calendar_id,
      eventId: appointment.gcal_event_id,
      requestBody: eventPayload,
    });
    return appointment.gcal_event_id;
  }

  const created = await calendar.events.insert({
    calendarId: connection.calendar_id,
    requestBody: eventPayload,
  });

  return created.data.id || null;
}
