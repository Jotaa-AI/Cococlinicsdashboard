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
  const appointmentId =
    typeof payload?.appointment_id === "string" && payload.appointment_id.trim()
      ? payload.appointment_id.trim()
      : typeof payload?.busy_block_id === "string" && payload.busy_block_id.trim()
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
    if (!appointmentId) {
      return NextResponse.json(
        { error: "appointment_id es obligatorio para cancelar un bloqueo." },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("appointments")
      .update({ status: "canceled" })
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .eq("entry_type", "internal_block");

    if (error) {
      return NextResponse.json({ error: error.message || "Delete failed" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      deleted: true,
      appointment_id: appointmentId,
      busy_block_id: appointmentId,
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
    excludeAppointmentId: appointmentId || undefined,
  });

  if (!availability.ok) {
    return NextResponse.json({ error: availability.error }, { status: 409 });
  }

  const blockPayload = {
    clinic_id: clinicId,
    entry_type: "internal_block",
    title: payload?.reason || payload?.title || "No disponible",
    start_at: slot.startAt,
    end_at: slot.endAt,
    status: "scheduled",
    notes: payload?.notes || payload?.reason || payload?.title || "No disponible",
    source_channel: source === "staff" ? "staff" : "doctor_whatsapp",
    created_by: source === "staff" ? "staff" : "doctor_whatsapp",
    created_at: payload?.created_at || new Date().toISOString(),
  };

  let data: Record<string, any> | null = null;
  let error: { message?: string } | null = null;

  if (appointmentId) {
    const result = await supabase
      .from("appointments")
      .update(blockPayload)
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .eq("entry_type", "internal_block")
      .select("id, start_at, end_at")
      .single();
    data = result.data;
    error = result.error;
  } else {
    const result = await supabase
      .from("appointments")
      .insert(blockPayload)
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
    appointment_id: data.id,
    busy_block_id: data.id,
    source,
  });
}
