export const CLINIC_TIMEZONE = process.env.NEXT_PUBLIC_CLINIC_TIMEZONE || "Europe/Madrid";

function getParts(value: Date, timeZone: string = CLINIC_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(value);

  const map = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    second: Number(map.get("second")),
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatClinicDateTime(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }
) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("es-ES", {
    ...options,
    timeZone: CLINIC_TIMEZONE,
  });
}

export function toClinicDateInputValue(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = getParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function toClinicTimeInputValue(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = getParts(date);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function zonedDateTimeToUtcIso(dateInput: string, timeInput: string, timeZone: string = CLINIC_TIMEZONE) {
  const [year, month, day] = dateInput.split("-").map(Number);
  const [hour, minute] = timeInput.split(":").map(Number);

  let utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  for (let i = 0; i < 2; i += 1) {
    const zoned = getParts(utcDate, timeZone);
    const expectedUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const actualUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second || 0, 0);
    const diffMinutes = Math.round((expectedUtc - actualUtc) / 60000);

    if (diffMinutes === 0) break;
    utcDate = new Date(utcDate.getTime() + diffMinutes * 60000);
  }

  return utcDate.toISOString();
}
