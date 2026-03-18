import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  computeDashboardChart,
  type DashboardChartView,
} from "@/lib/dashboard/serverMetrics";
import type { Appointment, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseView(value: string | null): DashboardChartView {
  return value === "day" || value === "week" || value === "month" ? value : "month";
}

function parseReference(value: string | null) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getRangeBounds(view: DashboardChartView, reference: Date) {
  const start = new Date(reference);

  if (view === "day") {
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  if (view === "week") {
    const day = start.getDay() || 7;
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - day + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
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
  const view = parseView(url.searchParams.get("view"));
  const referenceDate = parseReference(url.searchParams.get("reference"));
  const range = getRangeBounds(view, referenceDate);

  const admin = createSupabaseAdminClient();
  const [leadsResult, appointmentsResult] = await Promise.all([
    admin
      .from("leads")
      .select("created_at")
      .eq("clinic_id", profile.clinic_id)
      .gte("created_at", range.start.toISOString())
      .lt("created_at", range.end.toISOString()),
    admin
      .from("appointments")
      .select("*")
      .eq("clinic_id", profile.clinic_id)
      .gte("start_at", range.start.toISOString())
      .lt("start_at", range.end.toISOString()),
  ]);

  if (leadsResult.error || appointmentsResult.error) {
    return NextResponse.json(
      {
        error:
          leadsResult.error?.message ||
          appointmentsResult.error?.message ||
          "No se pudo cargar la grafica del dashboard.",
      },
      { status: 400 }
    );
  }

  const chart = computeDashboardChart(
    (leadsResult.data || []) as Pick<Lead, "created_at">[],
    (appointmentsResult.data || []) as Appointment[],
    view,
    referenceDate
  );

  return NextResponse.json(chart, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
