import { NextResponse } from "next/server";
import { getGoogleOAuthClient } from "@/lib/google/client";
import { encryptToken } from "@/lib/google/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const clinicId = searchParams.get("state") || process.env.DEFAULT_CLINIC_ID;

  if (!code || !clinicId) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const oauth2Client = getGoogleOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    return NextResponse.json({ error: "No refresh token returned" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const calendarId = process.env.GOOGLE_DEFAULT_CALENDAR_ID || "primary";

  await supabase.from("calendar_connections").upsert(
    {
      clinic_id: clinicId,
      google_refresh_token: encryptToken(tokens.refresh_token),
      calendar_id: calendarId,
      sync_token: null,
      created_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );

  const redirectUrl = new URL("/settings", process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000");
  return NextResponse.redirect(redirectUrl);
}
