DO $$
BEGIN
  CREATE TYPE appointment_entry_type AS ENUM ('lead_visit', 'internal_block');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

alter table if exists appointments
  add column if not exists entry_type appointment_entry_type not null default 'lead_visit';

create index if not exists appointments_entry_type_idx
  on appointments (clinic_id, entry_type, start_at);

update appointments
set entry_type = coalesce(entry_type, 'lead_visit'::appointment_entry_type)
where entry_type is null;

insert into appointments (
  clinic_id,
  entry_type,
  title,
  start_at,
  end_at,
  status,
  notes,
  source_channel,
  created_by,
  created_at
)
select
  b.clinic_id,
  'internal_block'::appointment_entry_type,
  coalesce(nullif(trim(b.reason), ''), 'No disponible'),
  b.start_at,
  b.end_at,
  'scheduled'::appointment_status,
  b.reason,
  'staff',
  'system',
  coalesce(b.created_at, now())
from busy_blocks b
where not exists (
  select 1
  from appointments a
  where a.clinic_id = b.clinic_id
    and a.entry_type = 'internal_block'
    and a.start_at = b.start_at
    and a.end_at = b.end_at
    and coalesce(a.title, '') = coalesce(nullif(trim(b.reason), ''), 'No disponible')
);

create or replace function public.validate_schedule_slot()
returns trigger
language plpgsql
as $$
declare
  local_start timestamp;
  local_end timestamp;
  start_minutes int;
  end_minutes int;
  duration_seconds int;
begin
  if new.start_at is null or new.end_at is null then
    raise exception 'start_at and end_at are required';
  end if;

  if date_trunc('minute', new.start_at) <> new.start_at
     or date_trunc('minute', new.end_at) <> new.end_at then
    raise exception 'Only minute precision is allowed for schedule slots';
  end if;

  duration_seconds := extract(epoch from (new.end_at - new.start_at));

  local_start := new.start_at at time zone 'Europe/Madrid';
  local_end := new.end_at at time zone 'Europe/Madrid';

  if local_start::date <> local_end::date then
    raise exception 'Schedule slots cannot cross day boundaries';
  end if;

  start_minutes := extract(hour from local_start)::int * 60 + extract(minute from local_start)::int;
  end_minutes := extract(hour from local_end)::int * 60 + extract(minute from local_end)::int;

  if (start_minutes % 30) <> 0 or (end_minutes % 30) <> 0 then
    raise exception 'Only 30 minute blocks are allowed';
  end if;

  if coalesce(new.entry_type, 'lead_visit') = 'internal_block' then
    if duration_seconds < 1800 or (duration_seconds % 1800) <> 0 then
      raise exception 'Internal blocks must use 30 minute increments';
    end if;
  elsif duration_seconds <> 1800 then
    raise exception 'Every lead visit slot must be exactly 30 minutes';
  end if;

  if start_minutes < 540 or end_minutes > 1140 then
    raise exception 'Schedule is available only between 09:00 and 19:00';
  end if;

  if tg_table_name = 'appointments' and new.status <> 'scheduled' then
    return new;
  end if;

  if exists (
    select 1
    from appointments a
    where a.clinic_id = new.clinic_id
      and a.status = 'scheduled'
      and (tg_table_name <> 'appointments' or a.id <> new.id)
      and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception 'Schedule conflict: overlapping appointment';
  end if;

  return new;
end;
$$;


drop trigger if exists trg_validate_busy_blocks_schedule on busy_blocks;
