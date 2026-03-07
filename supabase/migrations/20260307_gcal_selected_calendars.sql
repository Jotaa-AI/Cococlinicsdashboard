alter table if exists public.calendar_connections
  add column if not exists selected_calendar_ids text[];

update public.calendar_connections
set selected_calendar_ids = array[calendar_id]
where (selected_calendar_ids is null or cardinality(selected_calendar_ids) = 0)
  and calendar_id is not null;

