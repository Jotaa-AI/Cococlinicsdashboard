import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertWebhookSecret } from "@/lib/utils/webhook";
import { validateSlotRange } from "@/lib/calendar/slot-rules";
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent, queryGoogleBusyRanges } from "@/lib/google/sync";
import { transitionLeadStage } from "@/lib/pipeline/transition";

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

function overlapsBusy(
  startAt: string,
  endAt: string,
  busy: {
    start: Date;
    end: Date;
  }[]
) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return busy.some((block) => start < block.end && end > block.start);
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
    const { connection, busy, selectedCalendarIds } = await queryGoogleBusyRanges({
      clinicId,
      timeMin: slot.startAt,
      timeMax: slot.endAt,
      timeZone: "Europe/Madrid",
    });

    if (!connection) {
      return NextResponse.json({ error: "Google Calendar no conectado para esta clínica." }, { status: 404 });
    }

    if (!selectedCalendarIds.length) {
      return NextResponse.json({ error: "No hay calendarios configurados para comprobar disponibilidad." }, { status: 400 });
    }

    if (overlapsBusy(slot.startAt, slot.endAt, busy)) {
      return NextResponse.json({ error: "El hueco solicitado ya no está disponible." }, { status: 409 });
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

    let leadId = body?.lead_id || null;
    const treatment = body?.treatment || body?.tratamiento || null;

    if (!leadId && leadName && normalizedPhone) {
      const { data: lead, error: leadError } = await admin
        .from("leads")
        .upsert(
          {
            clinic_id: clinicId,
            full_name: leadName,
            phone: normalizedPhone,
            source: "retell",
            treatment,
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
          treatment,
          updated_at: new Date().toISOString(),
        })
        .eq("clinic_id", clinicId)
        .eq("id", leadId);
    }

    const sourceChannel = body?.source_channel || "call_ai";
    const title = body?.title || (leadName ? `Valoracion gratuita · ${leadName}` : "Valoracion gratuita");
    const notes = body?.notes || (treatment ? `Interes: ${treatment}.` : "Cita creada desde Retell.");
    const descriptionParts = [
      notes,
      leadName ? `Lead: ${leadName}` : null,
      normalizedPhone ? `Telefono: ${normalizedPhone}` : null,
      treatment ? `Tratamiento: ${treatment}` : null,
    ].filter(Boolean);

    const googleEvent = await createGoogleCalendarEvent({
      clinicId,
      startAt: slot.startAt,
      endAt: slot.endAt,
      summary: title,
      description: descriptionParts.join("\n"),
    });

    if (!googleEvent.eventId) {
      return NextResponse.json({ error: "No se pudo crear el evento en Google Calendar." }, { status: 500 });
    }

    const { data: appointment, error: appointmentError } = await admin
      .from("appointments")
      .insert({
        clinic_id: clinicId,
        lead_id: leadId,
        lead_name: leadName || null,
        lead_phone: normalizedPhone || null,
        title,
        start_at: slot.startAt,
        end_at: slot.endAt,
        status: "scheduled",
        notes,
        gcal_event_id: googleEvent.eventId,
        source_channel: sourceChannel,
        created_by: "agent",
        created_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (appointmentError || !appointment) {
      await deleteGoogleCalendarEvent({
        clinicId,
        eventId: googleEvent.eventId,
        calendarId: googleEvent.calendarId,
      }).catch(() => null);

      return NextResponse.json({ error: appointmentError?.message || "No se pudo crear la cita." }, { status: 400 });
    }

    if (leadId) {
      await transitionLeadStage({
        supabase: admin,
        clinicId,
        leadId,
        toStageKey: "visit_scheduled",
        reason: "Cita agendada desde Retell",
        actorType: sourceChannel,
        actorId: null,
        meta: {
          appointment_id: appointment.id,
          source_channel: sourceChannel,
          gcal_event_id: googleEvent.eventId,
        },
      }).catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      clinic_id: clinicId,
      lead_id: leadId,
      appointment_id: appointment.id,
      gcal_event_id: googleEvent.eventId,
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
