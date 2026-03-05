import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getGoogleOAuthClient, getGoogleCalendarClient } from "@/lib/google/client";
import { decryptToken } from "@/lib/google/crypto";
import { assertWebhookSecret } from "@/lib/utils/webhook";

interface AvailabilityBody {
  clinic_id?: string;
  time_min?: string;
  time_max?: string;
  time_zone?: string;
}

function isValidIso(value: string | undefined) {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime());
}

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as AvailabilityBody | null;
  if (!body?.clinic_id || !isValidIso(body.time_min) || !isValidIso(body.time_max)) {
    return NextResponse.json(
      { error: "Invalid payload. Required: clinic_id, time_min ISO, time_max ISO." },
      { status: 400 }
    );
  }

  const clinicId = body.clinic_id;
  const timeMin = body.time_min!;
  const timeMax = body.time_max!;
  const timeZone = body.time_zone || "Europe/Madrid";

  if (new Date(timeMax).getTime() <= new Date(timeMin).getTime()) {
    return NextResponse.json({ error: "time_max must be greater than time_min" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: connection, error } = await supabase
    .from("calendar_connections")
    .select("google_refresh_token, calendar_id")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!connection) {
    return NextResponse.json({ ok: false, error: "No Google Calendar connection for clinic.", busy: [] }, { status: 404 });
  }

  try {
    const oauth = getGoogleOAuthClient();
    oauth.setCredentials({ refresh_token: decryptToken(connection.google_refresh_token) });
    const calendar = getGoogleCalendarClient(oauth);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone,
        items: [{ id: connection.calendar_id }],
      },
    });

    const busy = response.data.calendars?.[connection.calendar_id]?.busy || [];

    return NextResponse.json({
      ok: true,
      clinic_id: clinicId,
      time_zone: timeZone,
      calendar_id: connection.calendar_id,
      busy: busy.map((item) => ({ start: item.start || null, end: item.end || null })).filter((item) => item.start && item.end),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Google FreeBusy request failed.", busy: [] },
      { status: 500 }
    );
  }
}
