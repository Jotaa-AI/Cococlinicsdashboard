import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";
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
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const supabase = createSupabaseAdminClient();
  const clinicId = payload.clinic_id || process.env.DEFAULT_CLINIC_ID;
  const appointmentStatus = payload.status || "scheduled";
  const sourceChannel = payload.source_channel || "staff";
  if (!clinicId) {
    return NextResponse.json({ error: "clinic_id is required" }, { status: 400 });
  }

  const slot = validateSlotRange({
    startAt: String(payload.start_at || ""),
    endAt: payload.end_at ? String(payload.end_at) : null,
  });

  if (!slot.ok) {
    return NextResponse.json({ error: slot.error }, { status: 400 });
  }

  const leadNameRaw = payload.lead_name || payload.patient_name || payload.nombre || payload.full_name || null;
  const leadName = typeof leadNameRaw === "string" ? leadNameRaw.trim() : null;
  const leadPhoneRaw = payload.lead_phone || payload.patient_phone || payload.telefono || payload.phone || null;
  const normalizedPhone =
    typeof leadPhoneRaw === "string" && leadPhoneRaw.trim()
      ? normalizeEsPhone(leadPhoneRaw)
      : null;

  if (leadPhoneRaw && !normalizedPhone) {
    return NextResponse.json({ error: "El teléfono debe tener formato +34XXXXXXXXX." }, { status: 400 });
  }

  let leadId: string | null = payload.lead_id || null;
  if (!leadId && leadName && normalizedPhone) {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .upsert(
        {
          clinic_id: clinicId,
          full_name: leadName,
          phone: normalizedPhone,
          source: payload.source || "manual",
          treatment: payload.treatment || null,
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
    await supabase
      .from("leads")
      .update({
        full_name: leadName,
        phone: normalizedPhone,
        updated_at: new Date().toISOString(),
      })
      .eq("clinic_id", clinicId)
      .eq("id", leadId);
  }

  let appointmentLeadName = leadName;
  let appointmentLeadPhone = normalizedPhone;

  if (leadId && (!appointmentLeadName || !appointmentLeadPhone)) {
    const { data: lead } = await supabase
      .from("leads")
      .select("full_name, phone")
      .eq("clinic_id", clinicId)
      .eq("id", leadId)
      .maybeSingle();

    appointmentLeadName = appointmentLeadName || lead?.full_name || null;
    appointmentLeadPhone = appointmentLeadPhone || lead?.phone || null;
  }

  if (appointmentStatus === "scheduled") {
    const availability = await checkSlotAvailability({
      supabase,
      clinicId,
      startAt: slot.startAt,
      endAt: slot.endAt,
    });

    if (!availability.ok) {
      return NextResponse.json({ error: availability.error }, { status: 409 });
    }
  }

  const { data: appointment, error } = await supabase
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      lead_id: leadId,
      lead_name: appointmentLeadName || null,
      lead_phone: appointmentLeadPhone || null,
      title: payload.title || "Cita Coco Clinics",
      start_at: slot.startAt,
      end_at: slot.endAt,
      status: appointmentStatus,
      notes: payload.notes || null,
      source_channel: sourceChannel,
      created_by: payload.created_by || "agent",
      created_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 400 });
  }

  if (payload.export_google) {
    const gcalEventId = await exportAppointmentToGoogle(appointment, clinicId);
    if (gcalEventId) {
      await supabase.from("appointments").update({ gcal_event_id: gcalEventId }).eq("id", appointment.id);
    }
  }

  if (leadId && (appointmentStatus === "scheduled" || appointmentStatus === "done")) {
    await transitionLeadStage({
      supabase,
      clinicId,
      leadId,
      toStageKey: "visit_scheduled",
      reason: "Cita agendada desde webhook",
      actorType: sourceChannel,
      actorId: payload.call_id || null,
      meta: {
        appointment_id: appointment.id,
        source_channel: sourceChannel,
      },
    });

    await supabase
      .from("leads")
      .update({ last_contact_at: new Date().toISOString(), next_action_at: null })
      .eq("clinic_id", clinicId)
      .eq("id", leadId);
  }

  return NextResponse.json({ ok: true, appointment_id: appointment.id });
}
