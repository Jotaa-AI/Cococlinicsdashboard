import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateBusyBlockRange, validateSlotRange } from "@/lib/calendar/slot-rules";
import { checkSlotAvailability } from "@/lib/calendar/availability";
import { normalizeEsPhone, resolveLeadForAppointment } from "@/lib/leads/resolveLead";

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
  if (!body?.appointment_id || !body?.start_at) {
    return NextResponse.json({ error: "appointment_id y start_at son obligatorios" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const leadName = typeof body.lead_name === "string" ? body.lead_name.trim() : "";
  const leadPhoneRaw = typeof body.lead_phone === "string" ? body.lead_phone : "";
  const leadPhone = leadPhoneRaw ? normalizeEsPhone(leadPhoneRaw) : null;

  if ((leadName && !leadPhone) || (!leadName && leadPhoneRaw)) {
    return NextResponse.json(
      { error: "Nombre y teléfono deben enviarse juntos y con formato +34XXXXXXXXX." },
      { status: 400 }
    );
  }

  const { data: existingAppointment, error: existingAppointmentError } = await admin
    .from("appointments")
    .select("id, lead_id, lead_name, lead_phone, entry_type")
    .eq("clinic_id", profile.clinic_id)
    .eq("id", body.appointment_id)
    .single();

  if (existingAppointmentError || !existingAppointment) {
    return NextResponse.json({ error: "No se encontro la cita a modificar." }, { status: 404 });
  }

  const validator =
    existingAppointment.entry_type === "internal_block" ? validateBusyBlockRange : validateSlotRange;
  const slot = validator({
    startAt: String(body.start_at),
    endAt: body.end_at ? String(body.end_at) : null,
  });

  if (!slot.ok) {
    return NextResponse.json({ error: slot.error }, { status: 400 });
  }

  const availability = await checkSlotAvailability({
    supabase: admin,
    clinicId: profile.clinic_id,
    startAt: slot.startAt,
    endAt: slot.endAt,
    excludeAppointmentId: String(body.appointment_id),
  });

  if (!availability.ok) {
    return NextResponse.json({ error: availability.error }, { status: 409 });
  }

  const updatePayload: Record<string, string | number | boolean | null> = {
    start_at: slot.startAt,
    end_at: slot.endAt,
  };

  if (typeof body.title === "string") {
    updatePayload.title = body.title;
  }

  if ("notes" in body) {
    updatePayload.notes = body.notes ? String(body.notes) : null;
  }

  const resolveLeadName = leadName || existingAppointment.lead_name || "";
  const resolveLeadPhone = leadPhone || normalizeEsPhone(existingAppointment.lead_phone);

  if (existingAppointment.entry_type !== "internal_block" && (existingAppointment.lead_id || (resolveLeadName && resolveLeadPhone))) {
    let resolvedLead;
    try {
      resolvedLead = await resolveLeadForAppointment({
        supabase: admin,
        clinicId: profile.clinic_id,
        leadId: existingAppointment.lead_id,
        leadName: resolveLeadName,
        leadPhone: resolveLeadPhone,
        source: "manual",
      });
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "No se pudo vincular el lead." }, { status: 400 });
    }

    updatePayload.lead_id = resolvedLead.leadId;
    updatePayload.lead_name = resolvedLead.leadName;
    updatePayload.lead_phone = resolvedLead.leadPhone;
  }

  const { data: appointment, error } = await admin
    .from("appointments")
    .update(updatePayload)
    .eq("id", body.appointment_id)
    .select("*")
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: error?.message || "Update failed" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
