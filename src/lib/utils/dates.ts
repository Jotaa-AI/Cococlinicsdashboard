import { format, subDays, startOfDay } from "date-fns";
import { es } from "date-fns/locale";

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
  return format(date, "dd/MM/yyyy 'a las' HH:mm", { locale: es });
}
