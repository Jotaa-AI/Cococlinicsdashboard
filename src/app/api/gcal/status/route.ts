import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/google/crypto";
import { getGoogleCalendarClient, getGoogleOAuthClient } from "@/lib/google/client";
import { getSelectedCalendarIds, normalizeCalendarSelection } from "@/lib/google/connection";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("user_id", user.id)
    .single();

  const clinicId = profile?.clinic_id || process.env.DEFAULT_CLINIC_ID || null;
  if (!clinicId) {
    return NextResponse.json({
      connected: false,
      clinic_id: null,
      calendar_id: null,
      primary_calendar_id: null,
      blocking_calendar_ids: [],
      selected_calendar_ids: [],
      connected_at: null,
      linked_email: null,
    });
  }

  const admin = createSupabaseAdminClient();
  let { data: connection, error } = await admin
    .from("calendar_connections")
    .select("clinic_id, calendar_id, selected_calendar_ids, google_refresh_token, created_at")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error?.message?.includes("selected_calendar_ids")) {
    const fallback = await admin
      .from("calendar_connections")
      .select("clinic_id, calendar_id, google_refresh_token, created_at")
      .eq("clinic_id", clinicId)
      .maybeSingle();
    connection = fallback.data as typeof connection;
    error = fallback.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let resolvedCalendarId = connection?.calendar_id || null;
  let selectedCalendarIds = connection ? getSelectedCalendarIds(connection) : [];
  let linkedEmail: string | null = resolvedCalendarId && resolvedCalendarId.includes("@") ? resolvedCalendarId : null;

  if (connection?.google_refresh_token) {
    try {
      const oauth = getGoogleOAuthClient();
      oauth.setCredentials({ refresh_token: decryptToken(connection.google_refresh_token) });
      const calendar = getGoogleCalendarClient(oauth);
      const primary = await calendar.calendarList.get({ calendarId: "primary" });
      const primaryId = primary.data.id || null;

      if (primaryId) {
        resolvedCalendarId = primaryId;
        linkedEmail = primaryId.includes("@") ? primaryId : linkedEmail;
        selectedCalendarIds = normalizeCalendarSelection(primaryId, selectedCalendarIds);

        const needsSelectionUpdate =
          !Array.isArray(connection.selected_calendar_ids) ||
          connection.selected_calendar_ids.length !== selectedCalendarIds.length ||
          connection.selected_calendar_ids.some((value, index) => value !== selectedCalendarIds[index]);

        if (connection.calendar_id !== primaryId || needsSelectionUpdate) {
          await admin
            .from("calendar_connections")
            .update({ calendar_id: primaryId, selected_calendar_ids: selectedCalendarIds })
            .eq("clinic_id", clinicId);
        }
      }
    } catch {
      // Keep stored values if Google lookup fails.
    }
  }

  return NextResponse.json({
    connected: Boolean(connection),
    clinic_id: clinicId,
    calendar_id: resolvedCalendarId,
    primary_calendar_id: resolvedCalendarId,
    blocking_calendar_ids: selectedCalendarIds,
    selected_calendar_ids: selectedCalendarIds,
    connected_at: connection?.created_at || null,
    linked_email: linkedEmail,
  });
}
