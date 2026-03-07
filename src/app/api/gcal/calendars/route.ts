import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/google/crypto";
import { getGoogleCalendarClient, getGoogleOAuthClient } from "@/lib/google/client";
import { getSelectedCalendarIds } from "@/lib/google/connection";

interface UpdateCalendarsBody {
  calendar_ids?: string[];
}

async function getClinicContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("clinic_id, role")
    .eq("user_id", user.id)
    .single();

  if (!profile?.clinic_id) return { error: NextResponse.json({ error: "No clinic profile" }, { status: 400 }) };
  if (!["admin", "staff"].includes(profile.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { clinicId: profile.clinic_id };
}

async function fetchGoogleCalendars(refreshTokenEncrypted: string) {
  const oauth = getGoogleOAuthClient();
  oauth.setCredentials({ refresh_token: decryptToken(refreshTokenEncrypted) });
  const calendar = getGoogleCalendarClient(oauth);
  const list = await calendar.calendarList.list({ minAccessRole: "reader", showHidden: false });
  return (list.data.items || []).map((item) => ({
    id: item.id || "",
    summary: item.summary || item.id || "Sin nombre",
    primary: Boolean(item.primary),
    access_role: item.accessRole || "",
  }));
}

export async function GET() {
  const context = await getClinicContext();
  if ("error" in context) return context.error;

  const admin = createSupabaseAdminClient();
  let { data: connection, error } = await admin
    .from("calendar_connections")
    .select("calendar_id, selected_calendar_ids, google_refresh_token")
    .eq("clinic_id", context.clinicId)
    .maybeSingle();

  if (error?.message?.includes("selected_calendar_ids")) {
    const fallback = await admin
      .from("calendar_connections")
      .select("calendar_id, google_refresh_token")
      .eq("clinic_id", context.clinicId)
      .maybeSingle();
    connection = fallback.data as typeof connection;
    error = fallback.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!connection) return NextResponse.json({ connected: false, calendars: [], selected_calendar_ids: [] });

  const calendars = await fetchGoogleCalendars(connection.google_refresh_token);
  const selected = getSelectedCalendarIds(connection);

  return NextResponse.json({
    connected: true,
    calendars: calendars.filter((item) => item.id),
    selected_calendar_ids: selected,
  });
}

export async function POST(request: Request) {
  const context = await getClinicContext();
  if ("error" in context) return context.error;

  const body = (await request.json().catch(() => null)) as UpdateCalendarsBody | null;
  const requested = Array.isArray(body?.calendar_ids)
    ? body!.calendar_ids.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];

  if (!requested.length) {
    return NextResponse.json({ error: "Selecciona al menos un calendario." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  let { data: connection, error } = await admin
    .from("calendar_connections")
    .select("calendar_id, selected_calendar_ids, google_refresh_token")
    .eq("clinic_id", context.clinicId)
    .maybeSingle();

  if (error?.message?.includes("selected_calendar_ids")) {
    const fallback = await admin
      .from("calendar_connections")
      .select("calendar_id, google_refresh_token")
      .eq("clinic_id", context.clinicId)
      .maybeSingle();
    connection = fallback.data as typeof connection;
    error = fallback.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!connection) return NextResponse.json({ error: "Google Calendar no conectado." }, { status: 404 });

  const calendars = await fetchGoogleCalendars(connection.google_refresh_token);
  const availableIds = new Set(calendars.map((item) => item.id).filter(Boolean));
  const invalid = requested.filter((id) => !availableIds.has(id));
  if (invalid.length) {
    return NextResponse.json(
      { error: "Hay calendarios no válidos para esta cuenta.", invalid_calendar_ids: invalid },
      { status: 400 }
    );
  }

  const primarySelection = requested[0];
  let { error: updateError } = await admin
    .from("calendar_connections")
    .update({
      calendar_id: primarySelection,
      selected_calendar_ids: requested,
    })
    .eq("clinic_id", context.clinicId);

  if (updateError?.message?.includes("selected_calendar_ids")) {
    const fallbackUpdate = await admin
      .from("calendar_connections")
      .update({ calendar_id: primarySelection })
      .eq("clinic_id", context.clinicId);
    updateError = fallbackUpdate.error;
    if (!updateError) {
      return NextResponse.json({
        ok: true,
        selected_calendar_ids: [primarySelection],
        warning: "Activa la columna selected_calendar_ids para usar selección múltiple.",
      });
    }
  }

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true, selected_calendar_ids: requested });
}
