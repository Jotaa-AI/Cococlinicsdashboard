import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";
import { SLOT_MINUTES, validateSlotRange } from "@/lib/calendar/slot-rules";
import { checkSlotAvailability } from "@/lib/calendar/availability";
import { transitionLeadStage } from "@/lib/pipeline/transition";
import { normalizeEsPhone, resolveLeadForAppointment } from "@/lib/leads/resolveLead";
import { persistAppointmentWithCompat } from "@/lib/appointments/persist";

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

  let resolvedLead = {
    leadId: payload.lead_id || null,
    leadName,
    leadPhone: normalizedPhone,
  };

  if (resolvedLead.leadId || (leadName && normalizedPhone)) {
    try {
      resolvedLead = await resolveLeadForAppointment({
        supabase,
        clinicId,
        leadId: resolvedLead.leadId,
        leadName,
        leadPhone: normalizedPhone,
        treatment: payload.treatment || null,
        source: payload.source || "manual",
      });
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "No se pudo crear el lead." }, { status: 400 });
    }
  }

  const appointmentId =
    typeof payload.appointment_id === "string" && payload.appointment_id.trim()
      ? payload.appointment_id.trim()
      : null;

  if (appointmentStatus === "scheduled") {
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
  }

  const appointmentPayload = {
    clinic_id: clinicId,
    lead_id: resolvedLead.leadId,
    lead_name: resolvedLead.leadName,
    lead_phone: resolvedLead.leadPhone,
    title: payload.title || "Cita Coco Clinics",
    start_at: slot.startAt,
    end_at: slot.endAt,
    notes: payload.notes || null,
    source_channel: sourceChannel,
    created_by: payload.created_by || "agent",
    created_at: payload.created_at || new Date().toISOString(),
    ...(payload.status ? { status: appointmentStatus } : {}),
  };

  const { data: appointment, error } = await persistAppointmentWithCompat({
    supabase,
    appointmentId,
    payload: appointmentPayload,
    select: "*",
  });

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 400 });
  }

  if (resolvedLead.leadId && (appointmentStatus === "scheduled" || appointmentStatus === "done")) {
    await transitionLeadStage({
      supabase,
      clinicId,
      leadId: resolvedLead.leadId,
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
      .eq("id", resolvedLead.leadId);
  }

  if (resolvedLead.leadId && appointmentStatus === "no_show") {
    await transitionLeadStage({
      supabase,
      clinicId,
      leadId: resolvedLead.leadId,
      toStageKey: "visit_no_show",
      reason: "Cita marcada como no-show desde webhook",
      actorType: sourceChannel,
      actorId: payload.call_id || null,
      meta: {
        appointment_id: appointment.id,
        source_channel: sourceChannel,
      },
    });
  }

  if (resolvedLead.leadId && appointmentStatus === "canceled") {
    await transitionLeadStage({
      supabase,
      clinicId,
      leadId: resolvedLead.leadId,
      toStageKey: "visit_canceled",
      reason: "Cita marcada como cancelada desde webhook",
      actorType: sourceChannel,
      actorId: payload.call_id || null,
      meta: {
        appointment_id: appointment.id,
        source_channel: sourceChannel,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    appointment_id: appointment.id,
    slot_minutes: SLOT_MINUTES,
  });
}
