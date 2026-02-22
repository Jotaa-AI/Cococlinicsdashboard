-- Enforce 30-minute schedule slots between 09:00 and 19:00
-- and block overlaps across appointments, busy blocks and google busy cache.

create or replace function public.validate_schedule_slot()
returns trigger
language plpgsql
as $$
declare
  local_start timestamp;
  local_end timestamp;
  start_minutes int;
  end_minutes int;
begin
  if new.start_at is null or new.end_at is null then
    raise exception 'start_at and end_at are required';
  end if;

  if date_trunc('minute', new.start_at) <> new.start_at
     or date_trunc('minute', new.end_at) <> new.end_at then
    raise exception 'Only minute precision is allowed for schedule slots';
  end if;

  if extract(epoch from (new.end_at - new.start_at)) <> 1800 then
    raise exception 'Every slot must be exactly 30 minutes';
  end if;

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

  if exists (
    select 1
    from busy_blocks b
    where b.clinic_id = new.clinic_id
      and (tg_table_name <> 'busy_blocks' or b.id <> new.id)
      and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception 'Schedule conflict: overlapping busy block';
  end if;

  if exists (
    select 1
    from calendar_events c
    where c.clinic_id = new.clinic_id
      and coalesce(lower(c.status), 'confirmed') <> 'cancelled'
      and tstzrange(c.start_at, c.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception 'Schedule conflict: overlapping Google Calendar event';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_appointments_schedule on appointments;
create trigger trg_validate_appointments_schedule
before insert or update of clinic_id, start_at, end_at, status
on appointments
for each row
execute function public.validate_schedule_slot();

drop trigger if exists trg_validate_busy_blocks_schedule on busy_blocks;
create trigger trg_validate_busy_blocks_schedule
before insert or update of clinic_id, start_at, end_at
on busy_blocks
for each row
execute function public.validate_schedule_slot();

