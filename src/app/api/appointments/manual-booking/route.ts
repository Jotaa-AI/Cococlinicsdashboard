import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SLOT_MINUTES, validateBusyBlockRange, validateSlotRange } from "@/lib/calendar/slot-rules";

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

function getWebhookUrl() {
  return (
    process.env.N8N_MANUAL_BOOKING_WEBHOOK_URL ||
    "https://personal-n8n.brtnrr.easypanel.host/webhook/agendamiento%20manual"
  );
}

function getCalConfig() {
  return {
    apiBaseUrl: process.env.CAL_API_BASE_URL || "https://api.cal.com/v2",
    apiKey: process.env.CAL_API_KEY || "",
    apiVersion: process.env.CAL_API_VERSION || "2024-08-13",
    eventTypeId: Number(process.env.CAL_BUSY_BLOCK_EVENT_TYPE_ID || 0),
    attendeeName: process.env.CAL_BLOCKING_ATTENDEE_NAME || "Bloqueo interno",
    attendeeEmail:
      process.env.CAL_BLOCKING_ATTENDEE_EMAIL || "bloqueos-coco-clinics@example.com",
  };
}

function splitInThirtyMinuteSlots(startIso: string, endIso: string) {
  const slots: Array<{ start: string; end: string }> = [];
  const start = new Date(startIso);
  const end = new Date(endIso);
  let cursor = new Date(start);

  while (cursor < end) {
    const next = new Date(cursor.getTime() + SLOT_MINUTES * 60 * 1000);
    if (next > end) break;
    slots.push({ start: cursor.toISOString(), end: next.toISOString() });
    cursor = next;
  }

  return slots;
}

async function createCalBookingSlot(params: {
  apiBaseUrl: string;
  apiKey: string;
  apiVersion: string;
  eventTypeId: number;
  startIso: string;
  reason: string;
  blockGroupId: string;
  attendeeName: string;
  attendeeEmail: string;
  slotIndex: number;
}) {
  const response = await fetch(`${params.apiBaseUrl}/bookings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      "cal-api-version": params.apiVersion,
    },
    body: JSON.stringify({
      start: params.startIso,
      eventTypeId: params.eventTypeId,
      attendee: {
        name: params.attendeeName,
        email: params.attendeeEmail,
        timeZone: "Europe/Madrid",
        language: "es",
      },
      bookingFieldsResponses: {
        notes: params.reason,
      },
      metadata: {
        source: "dashboard_busy_block",
        block_group_id: params.blockGroupId,
        reason: params.reason,
        slot_index: params.slotIndex,
      },
    }),
    cache: "no-store",
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      error: payload,
    };
  }

  const bookingUid =
    payload?.data?.uid ||
    payload?.uid ||
    payload?.booking?.uid ||
    payload?.data?.booking?.uid ||
    null;

  return {
    ok: true as const,
    bookingUid,
    raw: payload,
  };
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

  const leadName = typeof body?.lead_name === "string" ? body.lead_name.trim() : "";
  const rawPhone = typeof body?.lead_phone === "string" ? body.lead_phone : "";
  const leadPhone = normalizeEsPhone(rawPhone);

  if (!safeTitle || !body?.start_at) {
    return NextResponse.json(
      { error: "title/reason y start_at son obligatorios." },
      { status: 400 }
    );
  }

  if (entryType === "appointment" && (!leadName || !leadPhone)) {
    return NextResponse.json(
      { error: "lead_name y lead_phone son obligatorios para crear cita." },
      { status: 400 }
    );
  }

  const slotValidator = entryType === "busy_block" ? validateBusyBlockRange : validateSlotRange;
  const slot = slotValidator({
    startAt: String(body.start_at),
    endAt: body.end_at ? String(body.end_at) : null,
  });

  if (!slot.ok) {
    return NextResponse.json({ error: slot.error }, { status: 400 });
  }

  const payload = {
    entry_type: entryType,
    clinic_id: profile.clinic_id,
    lead_name: entryType === "appointment" ? leadName : null,
    lead_phone: entryType === "appointment" ? leadPhone : null,
    title: safeTitle,
    reason: entryType === "busy_block" ? safeTitle : null,
    notes: notes || safeTitle,
    start_at: slot.startAt,
    end_at: slot.endAt,
    created_by: "staff",
    source_channel: "staff",
    source: entryType === "busy_block" ? "agenda_block_manual" : "agenda_manual",
    requested_by_user_id: user.id,
    requested_at: new Date().toISOString(),
  };

  if (entryType === "busy_block") {
    const cal = getCalConfig();
    if (!cal.apiKey || !Number.isFinite(cal.eventTypeId) || cal.eventTypeId <= 0) {
      return NextResponse.json(
        {
          error:
            "Faltan variables de Cal.com para bloqueo directo (CAL_API_KEY y CAL_BUSY_BLOCK_EVENT_TYPE_ID).",
        },
        { status: 500 }
      );
    }

    const slots = splitInThirtyMinuteSlots(slot.startAt, slot.endAt);
    if (!slots.length) {
      return NextResponse.json(
        { error: `No hay slots validos de ${SLOT_MINUTES} minutos para bloquear.` },
        { status: 400 }
      );
    }

    const blockGroupId = `bb_${profile.clinic_id}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const bookingUids: string[] = [];

    for (let i = 0; i < slots.length; i += 1) {
      const slotItem = slots[i];
      const slotResult = await createCalBookingSlot({
        apiBaseUrl: cal.apiBaseUrl,
        apiKey: cal.apiKey,
        apiVersion: cal.apiVersion,
        eventTypeId: cal.eventTypeId,
        startIso: slotItem.start,
        reason: safeTitle,
        blockGroupId,
        attendeeName: cal.attendeeName,
        attendeeEmail: cal.attendeeEmail,
        slotIndex: i,
      });

      if (!slotResult.ok) {
        return NextResponse.json(
          {
            error: "No se pudo crear el bloqueo completo en Cal.com.",
            failed_slot_index: i,
            created_booking_uids: bookingUids,
            cal_error: slotResult.error,
          },
          { status: 502 }
        );
      }

      if (slotResult.bookingUid) {
        bookingUids.push(slotResult.bookingUid);
      }
    }

    const { error: busyBlockError } = await supabase.from("busy_blocks").insert({
      clinic_id: profile.clinic_id,
      start_at: slot.startAt,
      end_at: slot.endAt,
      reason: safeTitle,
      cal_block_group_id: blockGroupId,
      cal_booking_uids: bookingUids,
      created_by_user_id: user.id,
    });

    if (busyBlockError) {
      return NextResponse.json(
        {
          error: "Se bloquearon franjas en Cal.com, pero no se pudo guardar el bloque en Supabase.",
          details: busyBlockError.message,
          created_booking_uids: bookingUids,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      direct_cal: true,
      slots_created: slots.length,
      cal_booking_uids: bookingUids,
      cal_block_group_id: blockGroupId,
    });
  }

  const webhookUrl = getWebhookUrl();

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con n8n." }, { status: 502 });
  }

  const text = await response.text();
  let webhookResponse: unknown = null;
  try {
    webhookResponse = text ? JSON.parse(text) : null;
  } catch {
    webhookResponse = text || null;
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "El webhook de n8n devolvió error.",
        status: response.status,
        details: webhookResponse,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, forwarded: true, webhook_response: webhookResponse });
}
