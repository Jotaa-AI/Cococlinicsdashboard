import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeDashboardSummary } from "@/lib/dashboard/serverMetrics";
import type { Appointment, Call, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseMonth(value: string | null) {
  if (!value) return new Date();

  const yearMonthMatch = value.match(/^(\d{4})-(\d{2})$/);
  if (yearMonthMatch) {
    const year = Number(yearMonthMatch[1]);
    const month = Number(yearMonthMatch[2]) - 1;
    return new Date(year, month, 1);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("user_id", user.id)
    .single();

  if (profileError || !profile?.clinic_id) {
    return NextResponse.json({ error: "No clinic" }, { status: 400 });
  }

  const url = new URL(request.url);
  const selectedMonth = parseMonth(url.searchParams.get("month"));

  const admin = createSupabaseAdminClient();
  const [leadsResult, callsResult, appointmentsResult] = await Promise.all([
    admin
      .from("leads")
      .select("id, phone, created_at, converted_to_client, converted_at, converted_value_eur, stage_key, updated_at, managed_by, whatsapp_blocked")
      .eq("clinic_id", profile.clinic_id),
    admin
      .from("calls")
      .select("lead_id, phone, status, ended_at, started_at, created_at, call_cost_eur")
      .eq("clinic_id", profile.clinic_id)
      .eq("status", "ended"),
    admin
      .from("appointments")
      .select("*")
      .eq("clinic_id", profile.clinic_id),
  ]);

  if (leadsResult.error || callsResult.error || appointmentsResult.error) {
    return NextResponse.json(
      {
        error:
          leadsResult.error?.message ||
          callsResult.error?.message ||
          appointmentsResult.error?.message ||
          "No se pudieron cargar las metricas del dashboard.",
      },
      { status: 400 }
    );
  }

  const summary = computeDashboardSummary(
    (leadsResult.data || []) as Lead[],
    (callsResult.data || []) as Call[],
    (appointmentsResult.data || []) as Appointment[],
    selectedMonth
  );

  return NextResponse.json(summary, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
