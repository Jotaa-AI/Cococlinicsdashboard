import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
    return NextResponse.json({ connected: false, clinic_id: null, calendar_id: null, connected_at: null });
  }

  const admin = createSupabaseAdminClient();
  const { data: connection, error } = await admin
    .from("calendar_connections")
    .select("clinic_id, calendar_id, created_at")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    connected: Boolean(connection),
    clinic_id: clinicId,
    calendar_id: connection?.calendar_id || null,
    connected_at: connection?.created_at || null,
  });
}
