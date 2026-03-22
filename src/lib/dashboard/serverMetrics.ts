import {
  addDays,
  addMonths,
  eachDayOfInterval,
  eachHourOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import type { Appointment, Call, Lead } from "@/lib/types";
import { getLeadClosedTimestamp, getLeadKeyFromLead, getReferenceTimestamp, inRange, parseNumeric } from "@/lib/dashboard/aiMetrics";

export type DashboardLeadView = "day" | "week" | "month";
export type DashboardChartView = "day" | "week" | "month";

export interface DashboardSummary {
  leadsDay: number;
  leadsWeek: number;
  leadsMonth: number;
  managedByHumanMonth: number;
  managedByAiMonth: number;
  managedByUnknownMonth: number;
  callsMonth: number;
  callCostMonth: number;
  appointmentsMonth: number;
  callAiAppointmentsMonth: number;
  whatsappAiAppointmentsMonth: number;
  callAiAppointmentsSharePct: number;
  whatsappAiAppointmentsSharePct: number;
  wonAppointmentsMonth: number;
  wonRevenueMonth: number;
  estimatedAppointmentsMonth: number;
  estimatedRevenueMonth: number;
}

export interface DashboardChartPoint {
  bucketKey: string;
  label: string;
  fullLabel: string;
  leads: number;
  appointments: number;
}

export interface DashboardChartResponse {
  data: DashboardChartPoint[];
  leadsTotal: number;
  appointmentsTotal: number;
  rangeLabel: string;
}

const ESTIMATED_SERVICE_VALUE_EUR = 350;

function getDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function getHourKey(date: Date) {
  return format(date, "yyyy-MM-dd-HH");
}

function isScheduledAppointment(appointment: Appointment) {
  return appointment.status === "scheduled" && appointment.entry_type !== "internal_block";
}

function startForView(viewMode: DashboardChartView, referenceDate: Date) {
  if (viewMode === "day") return startOfDay(referenceDate);
  if (viewMode === "week") return startOfWeek(referenceDate, { weekStartsOn: 1 });
  return startOfMonth(referenceDate);
}

function endForView(viewMode: DashboardChartView, referenceDate: Date) {
  if (viewMode === "day") return endOfDay(referenceDate);
  if (viewMode === "week") return endOfWeek(referenceDate, { weekStartsOn: 1 });
  return endOfMonth(referenceDate);
}

function formatRangeLabel(viewMode: DashboardChartView, referenceDate: Date) {
  if (viewMode === "day") {
    const todayKey = getDateKey(new Date());
    return getDateKey(referenceDate) === todayKey
      ? "Hoy"
      : format(referenceDate, "d 'de' MMMM yyyy", { locale: es });
  }

  if (viewMode === "week") {
    const start = startForView("week", referenceDate);
    const end = endForView("week", referenceDate);
    return `${format(start, "d MMM", { locale: es })} - ${format(end, "d MMM yyyy", { locale: es })}`;
  }

  return format(referenceDate, "LLLL yyyy", { locale: es });
}

function buildBuckets(viewMode: DashboardChartView, referenceDate: Date): DashboardChartPoint[] {
  if (viewMode === "day") {
    return eachHourOfInterval({
      start: startForView("day", referenceDate),
      end: endForView("day", referenceDate),
    }).map((hour) => ({
      bucketKey: getHourKey(hour),
      label: format(hour, "HH:mm"),
      fullLabel: format(hour, "dd/MM/yyyy HH:mm"),
      leads: 0,
      appointments: 0,
    }));
  }

  return eachDayOfInterval({
    start: startForView(viewMode, referenceDate),
    end: endForView(viewMode, referenceDate),
  }).map((day) => ({
    bucketKey: getDateKey(day),
    label: viewMode === "week" ? format(day, "EEE d", { locale: es }) : format(day, "d"),
    fullLabel: format(day, "dd/MM/yyyy"),
    leads: 0,
    appointments: 0,
  }));
}

export function computeDashboardSummary(leads: Lead[], calls: Call[], appointments: Appointment[], selectedMonth: Date): DashboardSummary {
  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = addMonths(monthStart, 1);
  const monthStartMs = monthStart.getTime();
  const monthEndMs = monthEnd.getTime();

  const todayStart = startOfDay(new Date()).getTime();
  const tomorrowStart = addDays(startOfDay(new Date()), 1).getTime();
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
  const nextWeekStart = addDays(endOfWeek(new Date(), { weekStartsOn: 1 }), 1).getTime();

  const leadsDay = leads.filter((lead) => inRange(getReferenceTimestamp(lead.created_at), todayStart, tomorrowStart)).length;
  const leadsWeek = leads.filter((lead) => inRange(getReferenceTimestamp(lead.created_at), weekStart, nextWeekStart)).length;
  const leadsMonthRows = leads.filter((lead) => inRange(getReferenceTimestamp(lead.created_at), monthStartMs, monthEndMs));
  const leadsMonth = leadsMonthRows.length;
  const managedByHumanMonth = leadsMonthRows.filter(
    (lead) => lead.whatsapp_blocked || lead.managed_by === "humano"
  ).length;
  const managedByAiMonth = leadsMonthRows.filter(
    (lead) => !lead.whatsapp_blocked && lead.managed_by === "IA"
  ).length;
  const managedByUnknownMonth = Math.max(0, leadsMonth - managedByHumanMonth - managedByAiMonth);

  const callsMonth = calls.filter((call) =>
    inRange(getReferenceTimestamp(call.ended_at, call.started_at, call.created_at), monthStartMs, monthEndMs)
  );

  const callCostMonth = callsMonth.reduce((sum, call) => sum + (parseNumeric(call.call_cost_eur) || 0), 0);

  const scheduledAppointmentsMonth = appointments.filter((appointment) => {
    if (!isScheduledAppointment(appointment)) return false;
    return inRange(getReferenceTimestamp(appointment.start_at, appointment.created_at), monthStartMs, monthEndMs);
  });

  const callAiAppointmentsMonth = scheduledAppointmentsMonth.filter(
    (appointment) => appointment.source_channel === "call_ai"
  ).length;
  const whatsappAiAppointmentsMonth = scheduledAppointmentsMonth.filter(
    (appointment) => appointment.source_channel === "whatsapp_ai"
  ).length;
  const aiAppointmentsMonth = callAiAppointmentsMonth + whatsappAiAppointmentsMonth;
  const callAiAppointmentsSharePct = aiAppointmentsMonth
    ? Number(((callAiAppointmentsMonth / aiAppointmentsMonth) * 100).toFixed(1))
    : 0;
  const whatsappAiAppointmentsSharePct = aiAppointmentsMonth
    ? Number(((whatsappAiAppointmentsMonth / aiAppointmentsMonth) * 100).toFixed(1))
    : 0;

  const closedLeadKeys = new Set(
    leads
      .filter((lead) => {
        const closedAt = getReferenceTimestamp(getLeadClosedTimestamp(lead));
        return Boolean(closedAt && inRange(closedAt, monthStartMs, monthEndMs));
      })
      .map((lead) => getLeadKeyFromLead(lead))
      .filter((value): value is string => Boolean(value))
  );

  let wonAppointmentsMonth = 0;
  let wonRevenueMonth = 0;
  let estimatedAppointmentsMonth = 0;
  const revenueCountedLeadKeys = new Set<string>();

  for (const appointment of scheduledAppointmentsMonth) {
    const leadKey = appointment.lead_id
      ? `lead:${appointment.lead_id}`
      : appointment.lead_phone
        ? `phone:${appointment.lead_phone.replace(/\D/g, "")}`
        : null;

    if (leadKey && closedLeadKeys.has(leadKey)) {
      wonAppointmentsMonth += 1;
      if (!revenueCountedLeadKeys.has(leadKey)) {
        const lead = leads.find((item) => getLeadKeyFromLead(item) === leadKey);
        wonRevenueMonth += parseNumeric(lead?.converted_value_eur) || 0;
        revenueCountedLeadKeys.add(leadKey);
      }
    } else {
      estimatedAppointmentsMonth += 1;
    }
  }

  return {
    leadsDay,
    leadsWeek,
    leadsMonth,
    managedByHumanMonth,
    managedByAiMonth,
    managedByUnknownMonth,
    callsMonth: callsMonth.length,
    callCostMonth: Number(callCostMonth.toFixed(2)),
    appointmentsMonth: scheduledAppointmentsMonth.length,
    callAiAppointmentsMonth,
    whatsappAiAppointmentsMonth,
    callAiAppointmentsSharePct,
    whatsappAiAppointmentsSharePct,
    wonAppointmentsMonth,
    wonRevenueMonth: Number(wonRevenueMonth.toFixed(2)),
    estimatedAppointmentsMonth,
    estimatedRevenueMonth: Number((estimatedAppointmentsMonth * ESTIMATED_SERVICE_VALUE_EUR).toFixed(2)),
  };
}

export function computeDashboardChart(leads: Pick<Lead, "created_at">[], appointments: Appointment[], viewMode: DashboardChartView, referenceDate: Date): DashboardChartResponse {
  const points = buildBuckets(viewMode, referenceDate);
  const indexByKey = new Map(points.map((point, index) => [point.bucketKey, index]));
  const rangeStart = startForView(viewMode, referenceDate);
  const rangeEnd = endForView(viewMode, referenceDate);
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = addDays(rangeEnd, 1).getTime();

  for (const lead of leads) {
    const timestamp = getReferenceTimestamp(lead.created_at);
    if (!inRange(timestamp, rangeStartMs, rangeEndMs)) continue;
    const date = new Date(timestamp as number);
    const key = viewMode === "day" ? getHourKey(date) : getDateKey(date);
    const index = indexByKey.get(key);
    if (index !== undefined) points[index].leads += 1;
  }

  for (const appointment of appointments) {
    if (!isScheduledAppointment(appointment)) continue;
    const timestamp = getReferenceTimestamp(appointment.start_at, appointment.created_at);
    if (!inRange(timestamp, rangeStartMs, rangeEndMs)) continue;
    const date = new Date(timestamp as number);
    const key = viewMode === "day" ? getHourKey(date) : getDateKey(date);
    const index = indexByKey.get(key);
    if (index !== undefined) points[index].appointments += 1;
  }

  return {
    data: points,
    leadsTotal: points.reduce((acc, point) => acc + point.leads, 0),
    appointmentsTotal: points.reduce((acc, point) => acc + point.appointments, 0),
    rangeLabel: formatRangeLabel(viewMode, referenceDate).replace(/^\w/, (char) => char.toUpperCase()),
  };
}
