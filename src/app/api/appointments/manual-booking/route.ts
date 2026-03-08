import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SLOT_MINUTES, validateBusyBlockRange, validateSlotRange } from "@/lib/calendar/slot-rules";
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

    const { data, error } = await admin
      .from("busy_blocks")
      .insert({
        clinic_id: profile.clinic_id,
        start_at: slot.startAt,
        end_at: slot.endAt,
        reason: safeTitle,
        created_by_user_id: user.id,
      })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "No se pudo crear el bloqueo." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, busy_block_id: data.id });
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

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .upsert(
      {
        clinic_id: profile.clinic_id,
        full_name: leadName,
        phone: leadPhone,
        treatment: body.treatment || safeTitle,
        source: "manual",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id,phone" }
    )
    .select("id")
    .single();

  if (leadError || !lead?.id) {
    return NextResponse.json({ error: leadError?.message || "No se pudo crear el lead." }, { status: 400 });
  }

  const { data: appointment, error } = await admin
    .from("appointments")
    .insert({
      clinic_id: profile.clinic_id,
      lead_id: lead.id,
      lead_name: leadName,
      lead_phone: leadPhone,
      title: safeTitle,
      start_at: slot.startAt,
      end_at: slot.endAt,
      status: "scheduled",
      notes: notes || safeTitle,
      source_channel: "staff",
      created_by: "staff",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "No se pudo crear la cita." }, { status: 400 });
  }

  await transitionLeadStage({
    supabase: admin,
    clinicId: profile.clinic_id,
    leadId: lead.id,
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
