import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function deriveFullName(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}) {
  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
      ? user.user_metadata.name
      : null;

  if (fullName && fullName.trim()) return fullName.trim();
  if (user.email) return user.email.split("@")[0];
  return "Usuario";
}

export async function POST() {
  const supabaseServer = await createSupabaseServerClient();
  const { data: authData } = await supabaseServer.auth.getUser();

  if (!authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const defaultClinicId = process.env.DEFAULT_CLINIC_ID || null;

  let clinicId = defaultClinicId;

  if (!clinicId) {
    const { data: clinic } = await supabaseAdmin
      .from("clinics")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    clinicId = clinic?.id || null;
  }

  if (!clinicId) {
    return NextResponse.json({ error: "No clinic configured" }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("user_id, clinic_id, role, full_name")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, profile: existing });
  }

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .insert({
      user_id: authData.user.id,
      clinic_id: clinicId,
      role: "admin",
      full_name: deriveFullName({
        email: authData.user.email,
        user_metadata: authData.user.user_metadata,
      }),
    })
    .select("user_id, clinic_id, role, full_name")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, profile });
}
