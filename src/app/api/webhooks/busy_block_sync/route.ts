import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateBusyBlockRange } from "@/lib/calendar/slot-rules";
import { checkSlotAvailability } from "@/lib/calendar/availability";
import { assertWebhookSecret } from "@/lib/utils/webhook";

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const clinicId = payload?.clinic_id || process.env.DEFAULT_CLINIC_ID;
  const status = payload?.status || "active";
  const supabaseBusyBlockId =
    typeof payload?.busy_block_id === "string" && payload.busy_block_id.trim()
      ? payload.busy_block_id.trim()
      : typeof payload?.supabase_busy_block_id === "string" && payload.supabase_busy_block_id.trim()
        ? payload.supabase_busy_block_id.trim()
      : null;
  const source = payload?.source || payload?.created_by || "doctor_whatsapp";

  if (!clinicId) {
    return NextResponse.json({ error: "clinic_id is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  if (status === "canceled") {
    if (!supabaseBusyBlockId) {
      return NextResponse.json(
        { error: "busy_block_id es obligatorio para cancelar un bloqueo." },
        { status: 400 }
      );
    }

    let query = supabase.from("busy_blocks").delete().eq("clinic_id", clinicId);

    if (supabaseBusyBlockId) {
      query = query.eq("id", supabaseBusyBlockId);
    }

    const { error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message || "Delete failed" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      deleted: true,
      busy_block_id: supabaseBusyBlockId,
    });
  }

  const slot = validateBusyBlockRange({
    startAt: String(payload?.start_at || ""),
    endAt: payload?.end_at ? String(payload.end_at) : null,
  });

  if (!slot.ok) {
    return NextResponse.json({ error: slot.error }, { status: 400 });
  }

  const availability = await checkSlotAvailability({
    supabase,
    clinicId,
    startAt: slot.startAt,
    endAt: slot.endAt,
    excludeBusyBlockId: supabaseBusyBlockId || undefined,
  });

  if (!availability.ok) {
    return NextResponse.json({ error: availability.error }, { status: 409 });
  }

  const blockPayload = {
    clinic_id: clinicId,
    start_at: slot.startAt,
    end_at: slot.endAt,
    reason: payload?.reason || payload?.title || "No disponible",
    created_at: payload?.created_at || new Date().toISOString(),
    cal_block_group_id: typeof payload?.external_reference === "string" ? payload.external_reference : null,
  };

  let data: Record<string, any> | null = null;
  let error: { message?: string } | null = null;

  if (supabaseBusyBlockId) {
    const result = await supabase
      .from("busy_blocks")
      .update(blockPayload)
      .eq("clinic_id", clinicId)
      .eq("id", supabaseBusyBlockId)
      .select("id, start_at, end_at")
      .single();
    data = result.data;
    error = result.error;
  } else {
    const result = await supabase
      .from("busy_blocks")
      .insert({
        ...blockPayload,
        created_by_user_id: payload?.created_by_user_id || null,
      })
      .select("id, start_at, end_at")
      .single();
    data = result.data;
    error = result.error;
  }

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Upsert failed" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    busy_block_id: data.id,
    source,
  });
}
