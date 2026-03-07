function sanitizeCalendarIds(ids: (string | null | undefined)[]) {
  return Array.from(
    new Set(
      ids
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

export function normalizeCalendarSelection(
  primaryCalendarId?: string | null,
  selectedCalendarIds?: string[] | null
) {
  const normalizedPrimary = typeof primaryCalendarId === "string" ? primaryCalendarId.trim() : "";
  const sanitizedSelected = sanitizeCalendarIds(selectedCalendarIds || []);

  if (!normalizedPrimary) return sanitizedSelected;
  return sanitizeCalendarIds([normalizedPrimary, ...sanitizedSelected]);
}

export function getSelectedCalendarIds(connection: {
  calendar_id?: string | null;
  selected_calendar_ids?: string[] | null;
}) {
  return normalizeCalendarSelection(connection.calendar_id, connection.selected_calendar_ids);
}
