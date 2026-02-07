import { subDays, startOfDay } from "date-fns";

export function isoFromDaysAgo(days: number) {
  return startOfDay(subDays(new Date(), days)).toISOString();
}

export function isoStartOfToday() {
  return startOfDay(new Date()).toISOString();
}
