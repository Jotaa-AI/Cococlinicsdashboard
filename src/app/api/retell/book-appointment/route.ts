import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";
import { validateSlotRange } from "@/lib/calendar/slot-rules";
import { checkSlotAvailability } from "@/lib/calendar/availability";
import { transitionLeadStage } from "@/lib/pipeline/transition";
import { normalizeEsPhone, resolveLeadForAppointment } from "@/lib/leads/resolveLead";
import { persistAppointmentWithCompat } from "@/lib/appointments/persist";

interface RetellBookAppointmentBody {
  clinic_id?: string;
  start_at?: string;
  appointment_start_ts?: string;
  lead_id?: string;
  lead_name?: string;
  nombre?: string;
  full_name?: string;
  lead_phone?: string;
  telefono?: string;
  phone?: string;
  treatment?: string;
  tratamiento?: string;
  notes?: string;
  title?: string;
  source_channel?: "call_ai" | "whatsapp_ai" | "staff";
}

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => null)) as RetellBookAppointmentBody | null;
    const clinicId = body?.clinic_id || process.env.DEFAULT_CLINIC_ID;
    const requestedStart = body?.start_at || body?.appointment_start_ts;

    if (!clinicId) {
      return NextResponse.json({ error: "clinic_id is required" }, { status: 400 });
    }
    if (!requestedStart) {
      return NextResponse.json({ error: "start_at is required" }, { status: 400 });
    }

    const slot = validateSlotRange({
      startAt: String(requestedStart),
      endAt: null,
    });

    if (!slot.ok) {
      return NextResponse.json({ error: slot.error }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const availability = await checkSlotAvailability({
      supabase: admin,
      clinicId,
      startAt: slot.startAt,
      endAt: slot.endAt,
    });

    if (!availability.ok) {
      return NextResponse.json({ error: availability.error || "El hueco solicitado ya no está disponible." }, { status: 409 });
    }

    const leadNameRaw = body?.lead_name || body?.nombre || body?.full_name || null;
    const leadName = typeof leadNameRaw === "string" ? leadNameRaw.trim() : null;
    const leadPhoneRaw = body?.lead_phone || body?.telefono || body?.phone || null;
    const normalizedPhone =
      typeof leadPhoneRaw === "string" && leadPhoneRaw.trim() ? normalizeEsPhone(leadPhoneRaw) : null;

    if (leadPhoneRaw && !normalizedPhone) {
      return NextResponse.json({ error: "El teléfono debe tener formato +34XXXXXXXXX." }, { status: 400 });
    }

    if ((leadName && !normalizedPhone) || (!leadName && normalizedPhone)) {
      return NextResponse.json({ error: "Nombre y teléfono deben enviarse juntos." }, { status: 400 });
    }

    let resolvedLead = {
      leadId: body?.lead_id || null,
      leadName,
      leadPhone: normalizedPhone,
    };
    const treatment = body?.treatment || body?.tratamiento || null;

    if (resolvedLead.leadId || (leadName && normalizedPhone)) {
      try {
        resolvedLead = await resolveLeadForAppointment({
          supabase: admin,
          clinicId,
          leadId: resolvedLead.leadId,
          leadName,
          leadPhone: normalizedPhone,
          treatment,
          source: "retell",
        });
      } catch (error: any) {
        return NextResponse.json({ error: error?.message || "No se pudo crear el lead." }, { status: 400 });
      }
    }

    const sourceChannel = body?.source_channel || "call_ai";
    const title =
      body?.title || (resolvedLead.leadName ? `Valoracion gratuita · ${resolvedLead.leadName}` : "Valoracion gratuita");
    const notes = body?.notes || (treatment ? `Interes: ${treatment}.` : "Cita creada desde Retell.");

    const { data: appointment, error: appointmentError } = await persistAppointmentWithCompat({
      supabase: admin,
      payload: {
        clinic_id: clinicId,
        lead_id: resolvedLead.leadId,
        lead_name: resolvedLead.leadName,
        lead_phone: resolvedLead.leadPhone,
        title,
        start_at: slot.startAt,
        end_at: slot.endAt,
        status: "scheduled",
        notes,
        source_channel: sourceChannel,
        created_by: "agent",
        created_at: new Date().toISOString(),
      },
      select: "*",
    });

    if (appointmentError || !appointment) {
      return NextResponse.json({ error: appointmentError?.message || "No se pudo crear la cita." }, { status: 400 });
    }

    if (resolvedLead.leadId) {
      await transitionLeadStage({
        supabase: admin,
        clinicId,
        leadId: resolvedLead.leadId,
        toStageKey: "visit_scheduled",
        reason: "Cita agendada desde Retell",
        actorType: sourceChannel,
        actorId: null,
        meta: {
          appointment_id: appointment.id,
          source_channel: sourceChannel,
        },
      }).catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      clinic_id: clinicId,
      lead_id: resolvedLead.leadId,
      appointment_id: appointment.id,
      start_at: slot.startAt,
      end_at: slot.endAt,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to book appointment",
      },
      { status: 500 }
    );
  }
}
