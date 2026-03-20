import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SLOT_MINUTES, validateBusyBlockRange, validateSlotRange } from "@/lib/calendar/slot-rules";
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
  const entryType = body?.entry_type === "busy_block" ? "busy_block" : "appointment";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const safeTitle = title || reason;

  if (!safeTitle || !body?.start_at) {
    return NextResponse.json({ error: "title/reason y start_at son obligatorios." }, { status: 400 });
  }

  const slotValidator = entryType === "busy_block" ? validateBusyBlockRange : validateSlotRange;
  const slot = slotValidator({
    startAt: String(body.start_at),
    endAt: body.end_at ? String(body.end_at) : null,
  });

  if (!slot.ok) {
    return NextResponse.json({ error: slot.error }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  if (entryType === "busy_block") {
    const availability = await checkSlotAvailability({
      supabase: admin,
      clinicId: profile.clinic_id,
      startAt: slot.startAt,
      endAt: slot.endAt,
    });

    if (!availability.ok) {
      return NextResponse.json({ error: availability.error }, { status: 409 });
    }

    const { data, error } = await persistAppointmentWithCompat({
      supabase: admin,
      payload: {
        clinic_id: profile.clinic_id,
        entry_type: "internal_block",
        title: safeTitle,
        start_at: slot.startAt,
        end_at: slot.endAt,
        status: "scheduled",
        notes: notes || safeTitle,
        source_channel: "staff",
        created_by: "staff",
        created_at: new Date().toISOString(),
      },
      select: "id",
    });

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "No se pudo crear el bloqueo." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, appointment_id: data.id, busy_block_id: data.id });
  }

  const leadName = typeof body?.lead_name === "string" ? body.lead_name.trim() : "";
  const rawPhone = typeof body?.lead_phone === "string" ? body.lead_phone : "";
  const leadPhone = normalizeEsPhone(rawPhone);

  if (!leadName || !leadPhone) {
    return NextResponse.json(
      { error: "lead_name y lead_phone son obligatorios para crear cita." },
      { status: 400 }
    );
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

  let lead;
  try {
    lead = await resolveLeadForAppointment({
      supabase: admin,
      clinicId: profile.clinic_id,
      leadName,
      leadPhone,
      treatment: body.treatment || safeTitle,
      source: "manual",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "No se pudo crear el lead." }, { status: 400 });
  }

  if (!lead?.leadId) {
    return NextResponse.json({ error: "No se pudo crear el lead." }, { status: 400 });
  }

  const { data: appointment, error } = await persistAppointmentWithCompat({
    supabase: admin,
    payload: {
      clinic_id: profile.clinic_id,
      entry_type: "lead_visit",
      lead_id: lead.leadId,
      lead_name: lead.leadName,
      lead_phone: lead.leadPhone,
      title: safeTitle,
      start_at: slot.startAt,
      end_at: slot.endAt,
      status: "scheduled",
      notes: notes || safeTitle,
      source_channel: "staff",
      created_by: "staff",
      created_at: new Date().toISOString(),
    },
    select: "id",
  });

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "No se pudo crear la cita." }, { status: 400 });
  }

  await transitionLeadStage({
    supabase: admin,
    clinicId: profile.clinic_id,
      leadId: lead.leadId,
    toStageKey: "visit_scheduled",
    reason: "Cita creada manualmente desde agenda",
    actorType: "staff",
    actorId: user.id,
    meta: {
      appointment_id: appointment.id,
      source_channel: "staff",
    },
  }).catch(() => null);

  return NextResponse.json({
    ok: true,
    appointment_id: appointment.id,
    slot_minutes: SLOT_MINUTES,
  });
}
