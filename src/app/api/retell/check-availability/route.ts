import { NextResponse } from "next/server";
import { assertWebhookSecret } from "@/lib/utils/webhook";
import { SLOT_MINUTES, validateSlotRange } from "@/lib/calendar/slot-rules";
import { queryGoogleBusyRanges } from "@/lib/google/sync";

interface CheckAvailabilityBody {
  clinic_id?: string;
  appointment_requested_ts?: string;
  appointment_available_ts?: string;
  time_zone?: string;
}

interface BusyRange {
  start: Date;
  end: Date;
}

const MAX_SUGGESTIONS = 3;
const LOOKAHEAD_DAYS = 14;

function parseIsoDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    weekday: map.get("weekday") || "Sun",
    hour: Number(map.get("hour") || 0),
    minute: Number(map.get("minute") || 0),
  };
}

function roundUpToNextSlot(date: Date) {
  const slotMs = SLOT_MINUTES * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / slotMs) * slotMs);
}

function isWeekday(weekday: string) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
}

function isCandidateStart(date: Date, timeZone: string) {
  const local = getZonedParts(date, timeZone);
  if (!isWeekday(local.weekday)) return false;
  if (![0, 30].includes(local.minute)) return false;
  const total = local.hour * 60 + local.minute;
  return total >= 9 * 60 && total <= 18 * 60 + 30;
}

function overlapsBusy(start: Date, end: Date, busy: BusyRange[]) {
  return busy.some((block) => start < block.end && end > block.start);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function sortByDistance(reference: Date, candidates: Date[]) {
  return [...candidates].sort((a, b) => {
    const diffA = Math.abs(a.getTime() - reference.getTime());
    const diffB = Math.abs(b.getTime() - reference.getTime());
    if (diffA !== diffB) return diffA - diffB;
    return a.getTime() - b.getTime();
  });
}

function toSlotPayload(startAt: Date, timeZone: string) {
  const endAt = addMinutes(startAt, SLOT_MINUTES);
  return {
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    label_es: formatSlotLabelEs(startAt, timeZone),
  };
}

function getSpanishHourWord(hour24: number) {
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const words = [
    "",
    "una",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
    "diez",
    "once",
    "doce",
  ];
  return words[hour12];
}

function formatSlotLabelEs(date: Date, timeZone: string) {
  const weekday = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone }).format(date);
  const parts = getZonedParts(date, timeZone);
  const hourLabel = getSpanishHourWord(parts.hour);
  const minuteLabel = parts.minute === 30 ? " y media" : "";
  const period = parts.hour < 13 ? "de la mañana" : "de la tarde";
  return `${weekday} a las ${hourLabel}${minuteLabel} ${period}`;
}

export async function POST(request: Request) {
  if (!assertWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => null)) as CheckAvailabilityBody | null;
    const clinicId = body?.clinic_id || process.env.DEFAULT_CLINIC_ID;
    const requestedRaw = body?.appointment_requested_ts || body?.appointment_available_ts;
    const timeZone = body?.time_zone || "Europe/Madrid";
    const requestedDate = parseIsoDate(requestedRaw);

    if (!clinicId || !requestedDate) {
      return NextResponse.json(
        {
          error:
            "Invalid payload. Required: appointment_requested_ts (ISO). Also accepts appointment_available_ts for backward compatibility.",
        },
        { status: 400 }
      );
    }

    const now = new Date();
    const requestedEnd = addMinutes(requestedDate, SLOT_MINUTES);
    const requestedValidation = validateSlotRange({
      startAt: requestedDate.toISOString(),
      endAt: requestedEnd.toISOString(),
      timeZone,
    });

    const searchOrigin = roundUpToNextSlot(new Date(Math.max(requestedDate.getTime(), now.getTime())));
    const scanEnd = new Date(searchOrigin.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const { connection, busy, selectedCalendarIds } = await queryGoogleBusyRanges({
      clinicId,
      timeMin: searchOrigin.toISOString(),
      timeMax: scanEnd.toISOString(),
      timeZone,
    });

    if (!connection) {
      return NextResponse.json(
        { ok: false, error: "No Google Calendar connection for clinic.", available: false, suggestions: [] },
        { status: 404 }
      );
    }
    if (!selectedCalendarIds.length) {
      return NextResponse.json(
        { ok: false, error: "No selected calendars for clinic.", available: false, suggestions: [] },
        { status: 400 }
      );
    }

    const requestedInFuture = requestedDate.getTime() >= now.getTime();
    const requestedBlocked = overlapsBusy(requestedDate, requestedEnd, busy);
    const requestedAvailable = requestedValidation.ok && requestedInFuture && !requestedBlocked;

    if (requestedAvailable) {
      return NextResponse.json({
        ok: true,
        clinic_id: clinicId,
        calendar_ids: selectedCalendarIds,
        time_zone: timeZone,
        requested_ts: requestedDate.toISOString(),
        available: true,
        suggestions: [toSlotPayload(requestedDate, timeZone)],
      });
    }

    const allAvailableSlots: Date[] = [];
    for (let cursor = new Date(searchOrigin); cursor <= scanEnd; cursor = addMinutes(cursor, SLOT_MINUTES)) {
      if (cursor < now) continue;
      if (!isCandidateStart(cursor, timeZone)) continue;

      const end = addMinutes(cursor, SLOT_MINUTES);
      const valid = validateSlotRange({
        startAt: cursor.toISOString(),
        endAt: end.toISOString(),
        timeZone,
      });
      if (!valid.ok) continue;
      if (overlapsBusy(cursor, end, busy)) continue;
      allAvailableSlots.push(new Date(cursor));
    }

    const closest = sortByDistance(requestedDate, allAvailableSlots).slice(0, MAX_SUGGESTIONS);

    return NextResponse.json({
      ok: true,
      clinic_id: clinicId,
      calendar_ids: selectedCalendarIds,
      time_zone: timeZone,
      requested_ts: requestedDate.toISOString(),
      available: false,
      suggestions: closest.map((item) => toSlotPayload(item, timeZone)),
      reason: requestedValidation.ok
        ? requestedInFuture
          ? "requested_slot_busy"
          : "requested_slot_in_past"
        : "requested_slot_outside_rules",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to check availability",
      },
      { status: 500 }
    );
  }
}
