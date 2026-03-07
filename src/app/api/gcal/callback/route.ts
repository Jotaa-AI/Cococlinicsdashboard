import { NextResponse } from "next/server";
import { getGoogleOAuthClient, getGoogleCalendarClient } from "@/lib/google/client";
import { encryptToken } from "@/lib/google/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function resolveRedirectUri(request: Request) {
  return new URL("/api/gcal/callback", request.url).toString();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const clinicId = searchParams.get("state") || process.env.DEFAULT_CLINIC_ID;

    if (!code || !clinicId) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const oauth2Client = getGoogleOAuthClient(resolveRedirectUri(request));
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return NextResponse.json(
        {
          error: "Google no devolvió refresh_token. Reintenta conectando de nuevo con consentimiento.",
          reconnect_url: new URL("/api/gcal/connect", request.url).toString(),
        },
        { status: 400 }
      );
    }

    const supabase = createSupabaseAdminClient();
    const fallbackCalendarId = process.env.GOOGLE_DEFAULT_CALENDAR_ID || "primary";
    let calendarId = fallbackCalendarId;

    // Try to store the real primary calendar id (usually the linked account email).
    oauth2Client.setCredentials(tokens);
    try {
      const calendar = getGoogleCalendarClient(oauth2Client);
      const primary = await calendar.calendarList.get({ calendarId: "primary" });
      calendarId = primary.data.id || fallbackCalendarId;
    } catch {
      calendarId = fallbackCalendarId;
    }
    let { error } = await supabase.from("calendar_connections").upsert(
      {
        clinic_id: clinicId,
        google_refresh_token: encryptToken(tokens.refresh_token),
        calendar_id: calendarId,
        selected_calendar_ids: [calendarId],
        sync_token: null,
        created_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id" }
    );

    // Backward compatibility if selected_calendar_ids column is not present yet.
    if (error?.message?.includes("selected_calendar_ids")) {
      const retry = await supabase.from("calendar_connections").upsert(
        {
          clinic_id: clinicId,
          google_refresh_token: encryptToken(tokens.refresh_token),
          calendar_id: calendarId,
          sync_token: null,
          created_at: new Date().toISOString(),
        },
        { onConflict: "clinic_id" }
      );
      error = retry.error;
    }

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    const redirectUrl = new URL("/calendar?gcal=connected", request.url);
    return NextResponse.redirect(redirectUrl);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Google Calendar callback failed.",
        hint: "Revisa GOOGLE_TOKEN_ENCRYPTION_KEY, SUPABASE_SERVICE_ROLE_KEY y la tabla calendar_connections.",
      },
      { status: 500 }
    );
  }
}
