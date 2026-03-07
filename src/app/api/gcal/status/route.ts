import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/google/crypto";
import { getGoogleCalendarClient, getGoogleOAuthClient } from "@/lib/google/client";

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
      connected_at: null,
      linked_email: null,
    });
  }

  const admin = createSupabaseAdminClient();
  const { data: connection, error } = await admin
    .from("calendar_connections")
    .select("clinic_id, calendar_id, google_refresh_token, created_at")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let resolvedCalendarId = connection?.calendar_id || null;
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

        if (connection.calendar_id !== primaryId) {
          await admin.from("calendar_connections").update({ calendar_id: primaryId }).eq("clinic_id", clinicId);
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
    connected_at: connection?.created_at || null,
    linked_email: linkedEmail,
  });
}
