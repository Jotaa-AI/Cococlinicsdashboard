import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGoogleOAuthClient } from "@/lib/google/client";

function resolveRedirectUri(request: Request) {
  return new URL("/api/gcal/callback", request.url).toString();
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("clinic_id, role")
    .eq("user_id", user.id)
    .single();

  if (!profile || !["admin", "staff"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clinicId = profile?.clinic_id || process.env.DEFAULT_CLINIC_ID;
  const oauth2Client = getGoogleOAuthClient(resolveRedirectUri(request));

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
    state: clinicId,
  });

  return NextResponse.redirect(url);
}
