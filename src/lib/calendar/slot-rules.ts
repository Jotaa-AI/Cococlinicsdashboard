export const SLOT_MINUTES = 30;
export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 19;
export const DEFAULT_CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || "Europe/Madrid";
export const WEEKDAYS_ALLOWED = [1, 2, 3, 4, 5] as const;

interface SlotValidationInput {
  startAt: string;
  endAt?: string | null;
  timeZone?: string;
}

interface SlotValidationSuccess {
  ok: true;
  startAt: string;
  endAt: string;
}

interface SlotValidationFailure {
  ok: false;
  error: string;
}

export type SlotValidationResult = SlotValidationSuccess | SlotValidationFailure;

function getFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = getFormatter(timeZone).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
  };
}

function getIsoWeekday(date: Date, timeZone: string) {
  const weekdayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[weekdayLabel] || 0;
}

function sameLocalDay(a: ReturnType<typeof getZonedParts>, b: ReturnType<typeof getZonedParts>) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function validateSlotRange(input: SlotValidationInput): SlotValidationResult {
  const timeZone = input.timeZone || DEFAULT_CLINIC_TIMEZONE;
  const startDate = new Date(input.startAt);

  if (Number.isNaN(startDate.getTime())) {
    return { ok: false, error: "Hora de inicio invalida." };
  }

  const endDate = input.endAt ? new Date(input.endAt) : addMinutes(startDate, SLOT_MINUTES);
  if (Number.isNaN(endDate.getTime())) {
    return { ok: false, error: "Hora de fin invalida." };
  }

  if (startDate.getSeconds() !== 0 || startDate.getMilliseconds() !== 0) {
    return { ok: false, error: "La cita debe empezar en punto o y media." };
  }

  if (endDate.getSeconds() !== 0 || endDate.getMilliseconds() !== 0) {
    return { ok: false, error: "La cita debe terminar en punto o y media." };
  }

  const diffMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  if (diffMinutes !== SLOT_MINUTES) {
    return { ok: false, error: `Cada cita debe durar ${SLOT_MINUTES} minutos.` };
  }

  const localStart = getZonedParts(startDate, timeZone);
  const localEnd = getZonedParts(endDate, timeZone);
  const weekday = getIsoWeekday(startDate, timeZone);

  if (!sameLocalDay(localStart, localEnd)) {
    return { ok: false, error: "La cita no puede cruzar al dia siguiente." };
  }

  if (!WEEKDAYS_ALLOWED.includes(weekday as (typeof WEEKDAYS_ALLOWED)[number])) {
    return { ok: false, error: "Solo se puede agendar de lunes a viernes." };
  }

  const startTotal = localStart.hour * 60 + localStart.minute;
  const endTotal = localEnd.hour * 60 + localEnd.minute;
  const minTotal = OPEN_HOUR * 60;
  const maxTotal = CLOSE_HOUR * 60;

  if (startTotal % SLOT_MINUTES !== 0 || endTotal % SLOT_MINUTES !== 0) {
    return { ok: false, error: "Solo se permiten bloques de 30 minutos." };
  }

  if (startTotal < minTotal || endTotal > maxTotal) {
    return { ok: false, error: "La agenda solo admite citas entre 09:00 y 19:00." };
  }

  return { ok: true, startAt: startDate.toISOString(), endAt: endDate.toISOString() };
}

export function validateBusyBlockRange(input: SlotValidationInput): SlotValidationResult {
  const timeZone = input.timeZone || DEFAULT_CLINIC_TIMEZONE;
  const startDate = new Date(input.startAt);
  const endDate = input.endAt ? new Date(input.endAt) : addMinutes(startDate, SLOT_MINUTES);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { ok: false, error: "Fecha u hora invalida." };
  }

  if (startDate.getSeconds() !== 0 || startDate.getMilliseconds() !== 0) {
    return { ok: false, error: "El bloqueo debe empezar en punto o y media." };
  }

  if (endDate.getSeconds() !== 0 || endDate.getMilliseconds() !== 0) {
    return { ok: false, error: "El bloqueo debe terminar en punto o y media." };
  }

  const diffMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  if (diffMinutes < SLOT_MINUTES) {
    return { ok: false, error: `El bloqueo debe durar al menos ${SLOT_MINUTES} minutos.` };
  }

  if (diffMinutes % SLOT_MINUTES !== 0) {
    return { ok: false, error: `El bloqueo debe ir en tramos de ${SLOT_MINUTES} minutos.` };
  }

  const localStart = getZonedParts(startDate, timeZone);
  const localEnd = getZonedParts(endDate, timeZone);
  const weekday = getIsoWeekday(startDate, timeZone);

  if (!sameLocalDay(localStart, localEnd)) {
    return { ok: false, error: "El bloqueo no puede cruzar al dia siguiente." };
  }

  if (!WEEKDAYS_ALLOWED.includes(weekday as (typeof WEEKDAYS_ALLOWED)[number])) {
    return { ok: false, error: "Solo se puede bloquear de lunes a viernes." };
  }

  const startTotal = localStart.hour * 60 + localStart.minute;
  const endTotal = localEnd.hour * 60 + localEnd.minute;
  const minTotal = OPEN_HOUR * 60;
  const maxTotal = CLOSE_HOUR * 60;

  if (startTotal < minTotal || endTotal > maxTotal) {
    return { ok: false, error: "Solo se puede bloquear entre 09:00 y 19:00." };
  }

  return { ok: true, startAt: startDate.toISOString(), endAt: endDate.toISOString() };
}
