import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { exportAppointmentToGoogle } from "@/lib/google/sync";
import { validateSlotRange } from "@/lib/calendar/slot-rules";
import { checkSlotAvailability } from "@/lib/calendar/availability";
import { transitionLeadStage } from "@/lib/pipeline/transition";

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

  if (!profile?.clinic_id) {
    return NextResponse.json({ error: "No clinic" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.start_at) {
    return NextResponse.json({ error: "start_at es obligatorio" }, { status: 400 });
  }

  const slot = validateSlotRange({
    startAt: String(body.start_at),
    endAt: body.end_at ? String(body.end_at) : null,
  });

  if (!slot.ok) {
    return NextResponse.json({ error: slot.error }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const leadName =
    typeof body.lead_name === "string"
      ? body.lead_name.trim()
      : typeof body.patient_name === "string"
        ? body.patient_name.trim()
        : "";
  const leadPhoneInput =
    typeof body.lead_phone === "string"
      ? body.lead_phone
      : typeof body.patient_phone === "string"
        ? body.patient_phone
        : null;
  const normalizedPhone = typeof leadPhoneInput === "string" ? normalizeEsPhone(leadPhoneInput) : null;

  if (leadPhoneInput && !normalizedPhone) {
    return NextResponse.json({ error: "El teléfono debe tener formato +34XXXXXXXXX." }, { status: 400 });
  }

  if ((leadName && !normalizedPhone) || (!leadName && normalizedPhone)) {
    return NextResponse.json({ error: "Nombre y teléfono deben enviarse juntos." }, { status: 400 });
  }

  let leadId: string | null = body.lead_id || null;
  if (!leadId && leadName && normalizedPhone) {
    const { data: lead, error: leadError } = await admin
      .from("leads")
      .upsert(
        {
          clinic_id: profile.clinic_id,
          full_name: leadName,
          phone: normalizedPhone,
          source: "manual",
          treatment: body.treatment || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clinic_id,phone" }
      )
      .select("id")
      .single();

    if (leadError || !lead?.id) {
      return NextResponse.json({ error: leadError?.message || "No se pudo crear el lead." }, { status: 400 });
    }

    leadId = lead.id;
  }

  if (leadId && leadName && normalizedPhone) {
    await admin
      .from("leads")
      .update({
        full_name: leadName,
        phone: normalizedPhone,
        updated_at: new Date().toISOString(),
      })
      .eq("clinic_id", profile.clinic_id)
      .eq("id", leadId);
  }

  const availability = await checkSlotAvailability({
    supabase: admin,
    clinicId: profile.clinic_id,
    startAt: slot.startAt,
    endAt: slot.endAt,
  });

  if (!availability.ok) {
    return NextResponse.json({ error: availability.error }, { status: 409 });
  }

  const { data: appointment, error } = await admin
    .from("appointments")
    .insert({
      clinic_id: profile.clinic_id,
      lead_id: leadId,
      lead_name: leadName || null,
      lead_phone: normalizedPhone || null,
      title: body.title || "Cita Coco Clinics",
      start_at: slot.startAt,
      end_at: slot.endAt,
      status: "scheduled",
      notes: body.notes || null,
      source_channel: body.source_channel || "staff",
      created_by: body.created_by || "staff",
      created_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 400 });
  }

  const gcalEventId = await exportAppointmentToGoogle(appointment, profile.clinic_id);
  if (gcalEventId) {
    await admin.from("appointments").update({ gcal_event_id: gcalEventId }).eq("id", appointment.id);
  }

  if (leadId) {
    await transitionLeadStage({
      supabase: admin,
      clinicId: profile.clinic_id,
      leadId,
      toStageKey: "visit_scheduled",
      reason: "Cita creada desde agenda",
      actorType: "staff",
      actorId: user.id,
      meta: { appointment_id: appointment.id, source_channel: body.source_channel || "staff" },
    });
  }

  return NextResponse.json({ ok: true, appointment_id: appointment.id });
}
