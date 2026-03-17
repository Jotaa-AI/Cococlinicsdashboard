import { subDays, startOfDay } from "date-fns";
import { formatClinicDateTime } from "@/lib/datetime/clinicTime";

export function isoFromDaysAgo(days: number) {
  return startOfDay(subDays(new Date(), days)).toISOString();
}

export function isoStartOfToday() {
  return startOfDay(new Date()).toISOString();
}

export function formatDateTimeEs(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatClinicDateTime(date, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(",", " a las");
}
