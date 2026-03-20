import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateSlotRange } from "@/lib/calendar/slot-rules";
import { checkSlotAvailability } from "@/lib/calendar/availability";
import { transitionLeadStage } from "@/lib/pipeline/transition";
import { normalizeEsPhone, resolveLeadForAppointment } from "@/lib/leads/resolveLead";
import { persistAppointmentWithCompat } from "@/lib/appointments/persist";

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

  let resolvedLead = {
    leadId: body.lead_id || null,
    leadName: leadName || null,
    leadPhone: normalizedPhone || null,
  };

  if (resolvedLead.leadId || (leadName && normalizedPhone)) {
    try {
      resolvedLead = await resolveLeadForAppointment({
        supabase: admin,
        clinicId: profile.clinic_id,
        leadId: resolvedLead.leadId,
        leadName,
        leadPhone: normalizedPhone,
        treatment: body.treatment || null,
        source: "manual",
      });
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "No se pudo crear el lead." }, { status: 400 });
    }
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

  const { data: appointment, error } = await persistAppointmentWithCompat({
    supabase: admin,
    payload: {
      clinic_id: profile.clinic_id,
      lead_id: resolvedLead.leadId,
      lead_name: resolvedLead.leadName,
      lead_phone: resolvedLead.leadPhone,
      title: body.title || "Cita Coco Clinics",
      start_at: slot.startAt,
      end_at: slot.endAt,
      notes: body.notes || null,
      source_channel: body.source_channel || "staff",
      created_by: body.created_by || "staff",
      created_at: new Date().toISOString(),
    },
    select: "*",
  });

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 400 });
  }

  if (resolvedLead.leadId) {
    await transitionLeadStage({
      supabase: admin,
      clinicId: profile.clinic_id,
      leadId: resolvedLead.leadId,
      toStageKey: "visit_scheduled",
      reason: "Cita creada desde agenda",
      actorType: "staff",
      actorId: user.id,
      meta: { appointment_id: appointment.id, source_channel: body.source_channel || "staff" },
    });
  }

  return NextResponse.json({ ok: true, appointment_id: appointment.id });
}
