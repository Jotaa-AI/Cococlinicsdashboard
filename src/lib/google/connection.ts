export function getSelectedCalendarIds(connection: {
  calendar_id?: string | null;
  selected_calendar_ids?: string[] | null;
}) {
  const selected = Array.isArray(connection.selected_calendar_ids)
    ? connection.selected_calendar_ids.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];

  if (selected.length) return selected;
  if (connection.calendar_id) return [connection.calendar_id];
  return [];
}

