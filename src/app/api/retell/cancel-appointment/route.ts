import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";

interface CancelAppointmentBody {
  clinic_id?: string;
  lead_phone?: string;
  phone?: string;
  telefono?: string;
  reason?: string;
}

function normalizeEsPhone(rawPhone: string) {
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("34")) digits = digits.slice(2);

  if (!/^\d{9}$/.test(digits)) {
    return null;
  }

  return `+34${digits}`;
}

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => null)) as CancelAppointmentBody | null;
    const clinicId = body?.clinic_id || process.env.DEFAULT_CLINIC_ID;
    const rawPhone = body?.lead_phone || body?.phone || body?.telefono;

    if (!clinicId) {
      return NextResponse.json({ error: "clinic_id is required" }, { status: 400 });
    }
    if (!rawPhone) {
      return NextResponse.json({ error: "lead_phone is required" }, { status: 400 });
    }

    const normalizedPhone = normalizeEsPhone(rawPhone);
    if (!normalizedPhone) {
      return NextResponse.json({ error: "El teléfono debe tener formato +34XXXXXXXXX." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { data: appointment, error } = await admin
      .from("appointments")
      .select("id, start_at, end_at, lead_id")
      .eq("clinic_id", clinicId)
      .eq("entry_type", "lead_visit")
      .eq("lead_phone", normalizedPhone)
      .eq("status", "scheduled")
      .gte("start_at", now)
      .order("start_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message || "No se pudo buscar la cita." }, { status: 400 });
    }

    if (!appointment) {
      return NextResponse.json({ ok: false, error: "No hay una cita futura activa para ese teléfono." }, { status: 404 });
    }

    const cancelNotes = body?.reason ? `Cancelada por Retell: ${body.reason}` : "Cancelada por Retell";
    const { error: updateError } = await admin
      .from("appointments")
      .update({
        status: "canceled",
        notes: cancelNotes,
      })
      .eq("id", appointment.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message || "No se pudo cancelar la cita." }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      appointment_id: appointment.id,
      canceled_start_at: appointment.start_at,
      canceled_end_at: appointment.end_at,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Failed to cancel appointment" }, { status: 500 });
  }
}
