-- Coco Clinics Dashboard Schema

-- Extensions
create extension if not exists "pgcrypto";

-- Enums (Postgres no soporta IF NOT EXISTS para CREATE TYPE)
DO $$
BEGIN
  CREATE TYPE lead_status AS ENUM (
    'new',
    'whatsapp_sent',
    'call_done',
    'contacted',
    'visit_scheduled',
    'no_response',
    'not_interested'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE call_status AS ENUM ('in_progress', 'ended');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE appointment_status AS ENUM ('scheduled', 'canceled', 'done');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'staff');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE reminder_delivery_status AS ENUM ('no_enviado', 'enviado');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Core tables
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avg_treatment_price_eur numeric(10,2) not null default 399,
  created_at timestamptz default now()
);

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  role user_role not null default 'staff',
  full_name text,
  created_at timestamptz default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  full_name text,
  phone text,
  treatment text,
  source text default 'meta',
  status lead_status not null default 'new',
  converted_to_client boolean not null default false,
  converted_value_eur numeric(10,2),
  converted_at timestamptz,
  post_visit_outcome_reason text,
  contacto_futuro timestamptz,
  whatsapp_blocked boolean not null default false,
  whatsapp_blocked_reason text,
  whatsapp_blocked_at timestamptz,
  whatsapp_blocked_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists leads_phone_unique on leads (clinic_id, phone);
create index if not exists leads_phone_idx on leads (phone);
create index if not exists leads_created_at_idx on leads (created_at);
create index if not exists leads_status_idx on leads (status);
create index if not exists leads_converted_at_idx on leads (clinic_id, converted_at) where converted_to_client = true;
create index if not exists leads_contacto_futuro_idx on leads (clinic_id, contacto_futuro) where contacto_futuro is not null;
create index if not exists leads_whatsapp_blocked_idx on leads (clinic_id, whatsapp_blocked);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  retell_call_id text unique,
  lead_id uuid references leads(id) on delete set null,
  phone text,
  agent_id uuid,
  status call_status not null default 'in_progress',
  started_at timestamptz,
  ended_at timestamptz,
  duration_sec int,
  call_cost_eur numeric(10,4),
  outcome text,
  transcript text,
  summary text,
  extracted jsonb,
  recording_url text,
  created_at timestamptz default now()
);

create index if not exists calls_started_at_idx on calls (started_at);
create index if not exists calls_outcome_idx on calls (outcome);
create index if not exists calls_recording_url_idx on calls (clinic_id) where recording_url is not null;

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  lead_name text,
  lead_phone text,
  title text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status appointment_status not null default 'scheduled',
  reminder_2d_status reminder_delivery_status not null default 'no_enviado',
  reminder_1d_status reminder_delivery_status not null default 'no_enviado',
  reminder_1h_status reminder_delivery_status not null default 'no_enviado',
  notes text,
  gcal_event_id text,
  created_by text not null default 'staff',
  created_at timestamptz default now()
);

create index if not exists appointments_start_at_idx on appointments (start_at);
create index if not exists appointments_status_idx on appointments (status);
create index if not exists appointments_lead_phone_idx on appointments (clinic_id, lead_phone);
drop index if exists appointments_patient_phone_idx;

create table if not exists busy_blocks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  cal_block_group_id text,
  cal_booking_uids jsonb,
  created_at timestamptz default now(),
  created_by_user_id uuid references auth.users(id) on delete set null
);

create index if not exists busy_blocks_start_at_idx on busy_blocks (start_at);
create index if not exists busy_blocks_cal_block_group_idx on busy_blocks (clinic_id, cal_block_group_id);

create table if not exists calendar_connections (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references clinics(id) on delete cascade,
  google_refresh_token text not null,
  calendar_id text not null,
  sync_token text,
  created_at timestamptz default now()
);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  source text not null default 'google',
  gcal_event_id text,
  title text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text,
  updated_at timestamptz default now()
);

create unique index if not exists calendar_events_unique on calendar_events (clinic_id, gcal_event_id);
create index if not exists calendar_events_start_at_idx on calendar_events (start_at);

-- Backward-compatible upgrades for existing databases
alter table if exists appointments add column if not exists title text;
alter table if exists clinics add column if not exists avg_treatment_price_eur numeric(10,2) not null default 399;
update clinics
set avg_treatment_price_eur = 399
where avg_treatment_price_eur is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'patient_name'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'lead_name'
  ) then
    alter table appointments rename column patient_name to lead_name;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'patient_phone'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'lead_phone'
  ) then
    alter table appointments rename column patient_phone to lead_phone;
  end if;
end $$;

alter table if exists appointments
  add column if not exists lead_name text,
  add column if not exists lead_phone text;

alter table if exists appointments
  add column if not exists reminder_2d_status reminder_delivery_status not null default 'no_enviado',
  add column if not exists reminder_1d_status reminder_delivery_status not null default 'no_enviado',
  add column if not exists reminder_1h_status reminder_delivery_status not null default 'no_enviado';

alter table if exists leads
  add column if not exists converted_to_client boolean not null default false,
  add column if not exists converted_value_eur numeric(10,2),
  add column if not exists converted_at timestamptz,
  add column if not exists post_visit_outcome_reason text;

update leads
set
  converted_to_client = coalesce(converted_to_client, false)
where
  converted_to_client is null;

update appointments
set
  reminder_2d_status = coalesce(reminder_2d_status, 'no_enviado'::reminder_delivery_status),
  reminder_1d_status = coalesce(reminder_1d_status, 'no_enviado'::reminder_delivery_status),
  reminder_1h_status = coalesce(reminder_1h_status, 'no_enviado'::reminder_delivery_status)
where
  reminder_2d_status is null
  or reminder_1d_status is null
  or reminder_1h_status is null;
alter table if exists calendar_events add column if not exists title text;
alter table if exists leads
  add column if not exists contacto_futuro timestamptz,
  add column if not exists whatsapp_blocked boolean not null default false,
  add column if not exists whatsapp_blocked_reason text,
  add column if not exists whatsapp_blocked_at timestamptz,
  add column if not exists whatsapp_blocked_by_user_id uuid references auth.users(id) on delete set null;
alter table if exists busy_blocks
  add column if not exists cal_block_group_id text,
  add column if not exists cal_booking_uids jsonb;

update appointments a
set lead_name = coalesce(a.lead_name, l.full_name),
    lead_phone = coalesce(a.lead_phone, l.phone)
from leads l
where a.clinic_id = l.clinic_id
  and a.lead_id = l.id
  and (a.lead_name is null or a.lead_phone is null);

create table if not exists system_state (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references clinics(id) on delete cascade,
  current_call_retell_id text,
  current_call_lead_id uuid references leads(id) on delete set null,
  current_call_started_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists agent_runtime_controls (
  clinic_id uuid primary key references clinics(id) on delete cascade,
  calls_agent_active boolean not null default true,
  whatsapp_agent_active boolean not null default true,
  hitl_mode_active boolean not null default false,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  meta jsonb,
  created_at timestamptz default now()
);

-- A/B test support for contact strategy (Meta leads).
create table if not exists lead_ab_test_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references clinics(id) on delete cascade,
  is_enabled boolean not null default false,
  variant_a_weight int not null default 50 check (variant_a_weight between 0 and 100),
  variant_a_name text not null default 'Aviso WhatsApp + llamada',
  variant_b_name text not null default 'WhatsApp conversacional',
  variant_a_script text,
  variant_b_script text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists lead_ab_assignments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  variant text not null check (variant in ('A', 'B')),
  strategy text not null default 'weighted_hash',
  assigned_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (clinic_id, lead_id)
);

create index if not exists lead_ab_assignments_variant_idx on lead_ab_assignments (clinic_id, variant, assigned_at);

create table if not exists lead_ab_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  assignment_id uuid references lead_ab_assignments(id) on delete set null,
  variant text check (variant in ('A', 'B')),
  event_name text not null,
  channel text not null default 'unknown',
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists lead_ab_events_lookup_idx on lead_ab_events (clinic_id, event_name, created_at);
create index if not exists lead_ab_events_variant_idx on lead_ab_events (clinic_id, variant, created_at);

create table if not exists appointment_booking_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  idempotency_key text not null,
  lead_id uuid references leads(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  source text not null default 'n8n',
  created_at timestamptz default now(),
  unique (clinic_id, idempotency_key)
);

create or replace function public.rpc_assign_ab_variant(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_assignment_key text default null
)
returns table (
  assignment_id uuid,
  variant text,
  is_enabled boolean,
  variant_a_weight int,
  variant_a_name text,
  variant_b_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings lead_ab_test_settings%rowtype;
  v_existing lead_ab_assignments%rowtype;
  v_variant text;
  v_assignment_id uuid;
  v_hash_source text;
  v_bucket int;
begin
  if p_clinic_id is null or p_lead_id is null then
    raise exception 'clinic_id and lead_id are required';
  end if;

  insert into lead_ab_test_settings (clinic_id)
  values (p_clinic_id)
  on conflict (clinic_id) do nothing;

  select * into v_settings
  from lead_ab_test_settings
  where clinic_id = p_clinic_id;

  select * into v_existing
  from lead_ab_assignments
  where clinic_id = p_clinic_id
    and lead_id = p_lead_id
  limit 1;

  if found then
    return query
      select
        v_existing.id,
        v_existing.variant,
        v_settings.is_enabled,
        v_settings.variant_a_weight,
        v_settings.variant_a_name,
        v_settings.variant_b_name;
    return;
  end if;

  if not v_settings.is_enabled then
    v_variant := 'A';
  else
    v_hash_source := coalesce(nullif(trim(p_assignment_key), ''), p_lead_id::text);
    v_bucket := mod(((hashtext(p_clinic_id::text || ':' || v_hash_source)::bigint) & 2147483647), 100);
    v_variant := case when v_bucket < v_settings.variant_a_weight then 'A' else 'B' end;
  end if;

  insert into lead_ab_assignments (clinic_id, lead_id, variant)
  values (p_clinic_id, p_lead_id, v_variant)
  returning id into v_assignment_id;

  return query
    select
      v_assignment_id,
      v_variant,
      v_settings.is_enabled,
      v_settings.variant_a_weight,
      v_settings.variant_a_name,
      v_settings.variant_b_name;
end;
$$;

create or replace function public.rpc_find_nearest_slots(
  p_clinic_id uuid,
  p_requested_start timestamptz,
  p_window_hours int default 2,
  p_limit int default 3,
  p_timezone text default 'Europe/Madrid'
)
returns table (
  start_at timestamptz,
  end_at timestamptz,
  distance_minutes int,
  label text
)
language sql
security definer
set search_path = public
as $$
  with bounds as (
    select
      p_clinic_id as clinic_id,
      p_requested_start as requested_start,
      greatest(1, least(coalesce(p_window_hours, 2), 12)) as window_hours,
      greatest(1, least(coalesce(p_limit, 3), 10)) as wanted_limit,
      coalesce(nullif(p_timezone, ''), 'Europe/Madrid') as tz,
      ((p_requested_start at time zone coalesce(nullif(p_timezone, ''), 'Europe/Madrid'))::date::timestamp + interval '9 hour')
        at time zone coalesce(nullif(p_timezone, ''), 'Europe/Madrid') as day_open,
      ((p_requested_start at time zone coalesce(nullif(p_timezone, ''), 'Europe/Madrid'))::date::timestamp + interval '19 hour')
        at time zone coalesce(nullif(p_timezone, ''), 'Europe/Madrid') as day_close
  ),
  candidate_slots as (
    select
      gs as slot_start,
      gs + interval '30 minutes' as slot_end,
      b.requested_start,
      b.wanted_limit,
      b.tz,
      b.clinic_id
    from bounds b
    join lateral generate_series(
      b.day_open,
      b.day_close - interval '30 minutes',
      interval '30 minutes'
    ) gs on true
    where gs >= b.requested_start - make_interval(hours => b.window_hours)
      and gs <= b.requested_start + make_interval(hours => b.window_hours)
  ),
  free_slots as (
    select
      c.slot_start,
      c.slot_end,
      c.requested_start,
      c.wanted_limit,
      c.tz
    from candidate_slots c
    where not exists (
      select 1
      from appointments a
      where a.clinic_id = c.clinic_id
        and a.status = 'scheduled'
        and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(c.slot_start, c.slot_end, '[)')
    )
      and not exists (
      select 1
      from busy_blocks b
      where b.clinic_id = c.clinic_id
        and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(c.slot_start, c.slot_end, '[)')
    )
      and not exists (
      select 1
      from calendar_events ce
      where ce.clinic_id = c.clinic_id
        and coalesce(lower(ce.status), 'confirmed') <> 'cancelled'
        and tstzrange(ce.start_at, ce.end_at, '[)') && tstzrange(c.slot_start, c.slot_end, '[)')
    )
  )
  select
    f.slot_start as start_at,
    f.slot_end as end_at,
    abs(extract(epoch from (f.slot_start - f.requested_start)) / 60)::int as distance_minutes,
    to_char(f.slot_start at time zone f.tz, 'HH24:MI') as label
  from free_slots f
  order by
    abs(extract(epoch from (f.slot_start - f.requested_start))) asc,
    f.slot_start asc
  limit (select wanted_limit from bounds);
$$;

create or replace function public.rpc_book_appointment_slot(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_start_at timestamptz,
  p_title text default 'Cita Coco Clinics',
  p_notes text default null,
  p_created_by text default 'agent',
  p_idempotency_key text default null,
  p_source text default 'n8n'
)
returns table (
  ok boolean,
  appointment_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  error text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment_id uuid;
  v_start_at timestamptz := p_start_at;
  v_end_at timestamptz := p_start_at + interval '30 minutes';
  v_existing_id uuid;
begin
  if p_clinic_id is null or p_start_at is null then
    return query select false, null::uuid, null::timestamptz, null::timestamptz, 'clinic_id and start_at are required';
    return;
  end if;

  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select abr.appointment_id
    into v_existing_id
    from appointment_booking_requests abr
    where abr.clinic_id = p_clinic_id
      and abr.idempotency_key = p_idempotency_key
    limit 1;

    if v_existing_id is not null then
      return query
      select true, a.id, a.start_at, a.end_at, null::text
      from appointments a
      where a.id = v_existing_id;
      return;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    ((hashtext(p_clinic_id::text)::bigint) << 32)
    + (hashtext(to_char(p_start_at, 'YYYYMMDDHH24MI'))::bigint & 4294967295)
  );

  begin
    insert into appointments (
      clinic_id,
      lead_id,
      title,
      start_at,
      end_at,
      status,
      notes,
      created_by
    )
    values (
      p_clinic_id,
      p_lead_id,
      coalesce(nullif(trim(p_title), ''), 'Cita Coco Clinics'),
      v_start_at,
      v_end_at,
      'scheduled',
      nullif(trim(p_notes), ''),
      coalesce(nullif(trim(p_created_by), ''), 'agent')
    )
    returning id, start_at, end_at
    into v_appointment_id, v_start_at, v_end_at;
  exception
    when others then
      return query select false, null::uuid, null::timestamptz, null::timestamptz, sqlerrm;
      return;
  end;

  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    insert into appointment_booking_requests (
      clinic_id,
      idempotency_key,
      lead_id,
      appointment_id,
      source
    )
    values (
      p_clinic_id,
      p_idempotency_key,
      p_lead_id,
      v_appointment_id,
      coalesce(nullif(trim(p_source), ''), 'n8n')
    )
    on conflict (clinic_id, idempotency_key)
    do update set appointment_id = excluded.appointment_id;
  end if;

  if p_lead_id is not null then
    update leads
    set status = 'visit_scheduled',
        updated_at = now()
    where id = p_lead_id
      and clinic_id = p_clinic_id;
  end if;

  return query select true, v_appointment_id, v_start_at, v_end_at, null::text;
end;
$$;

create or replace function public.rpc_log_ab_event(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_event_name text,
  p_channel text default 'unknown',
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment lead_ab_assignments%rowtype;
  v_event_id uuid;
begin
  if p_clinic_id is null or p_event_name is null or trim(p_event_name) = '' then
    raise exception 'clinic_id and event_name are required';
  end if;

  if p_lead_id is not null then
    select *
    into v_assignment
    from lead_ab_assignments
    where clinic_id = p_clinic_id
      and lead_id = p_lead_id
    limit 1;
  end if;

  insert into lead_ab_events (
    clinic_id,
    lead_id,
    assignment_id,
    variant,
    event_name,
    channel,
    payload
  )
  values (
    p_clinic_id,
    p_lead_id,
    v_assignment.id,
    v_assignment.variant,
    p_event_name,
    coalesce(nullif(trim(p_channel), ''), 'unknown'),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function public.rpc_ab_test_metrics(
  p_clinic_id uuid,
  p_days int default 30
)
returns table (
  variant text,
  assigned_count int,
  contacted_count int,
  booked_count int,
  conversion_pct numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and p_clinic_id <> current_clinic_id() then
    raise exception 'Not allowed for this clinic';
  end if;

  return query
  with settings as (
    select greatest(1, least(coalesce(p_days, 30), 365)) as days_window
  ),
  variants as (
    select 'A'::text as variant
    union all
    select 'B'::text as variant
  ),
  assigned as (
    select a.variant, count(*)::int as count_value
    from lead_ab_assignments a
    where a.clinic_id = p_clinic_id
      and a.assigned_at >= now() - make_interval(days => (select days_window from settings))
    group by a.variant
  ),
  contacted as (
    select a.variant, count(distinct e.lead_id)::int as count_value
    from lead_ab_events e
    join lead_ab_assignments a
      on a.clinic_id = e.clinic_id
     and a.lead_id = e.lead_id
    where e.clinic_id = p_clinic_id
      and e.created_at >= now() - make_interval(days => (select days_window from settings))
      and e.event_name = 'contact_made'
    group by a.variant
  ),
  booked as (
    select a.variant, count(distinct ap.id)::int as count_value
    from appointments ap
    join lead_ab_assignments a
      on a.clinic_id = ap.clinic_id
     and a.lead_id = ap.lead_id
    where ap.clinic_id = p_clinic_id
      and ap.created_at >= now() - make_interval(days => (select days_window from settings))
      and ap.status in ('scheduled', 'done')
    group by a.variant
  )
  select
    v.variant,
    coalesce(asg.count_value, 0) as assigned_count,
    coalesce(ct.count_value, 0) as contacted_count,
    coalesce(bk.count_value, 0) as booked_count,
    case
      when coalesce(asg.count_value, 0) = 0 then 0
      else round((coalesce(bk.count_value, 0)::numeric / asg.count_value::numeric) * 100, 2)
    end as conversion_pct
  from variants v
  left join assigned asg on asg.variant = v.variant
  left join contacted ct on ct.variant = v.variant
  left join booked bk on bk.variant = v.variant
  order by v.variant;
end;
$$;

-- Scheduling guardrails:
-- - fixed slots of 30 minutes
-- - local clinic window from 09:00 to 19:00 (Europe/Madrid)
-- - no overlaps against appointments, busy blocks, or google busy cache
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

create or replace function public.populate_appointment_contact_fields()
returns trigger
language plpgsql
as $$
declare
  v_lead_name text;
  v_lead_phone text;
begin
  if new.lead_id is not null then
    select full_name, phone
      into v_lead_name, v_lead_phone
    from leads
    where id = new.lead_id
      and clinic_id = new.clinic_id
    limit 1;

    if (new.lead_name is null or trim(new.lead_name) = '') and v_lead_name is not null then
      new.lead_name := v_lead_name;
    end if;

    if (new.lead_phone is null or trim(new.lead_phone) = '') and v_lead_phone is not null then
      new.lead_phone := v_lead_phone;
    end if;
  end if;

  if new.lead_name is not null then
    new.lead_name := nullif(trim(new.lead_name), '');
  end if;

  if new.lead_phone is not null then
    new.lead_phone := nullif(trim(new.lead_phone), '');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_populate_appointment_contact_fields on appointments;
create trigger trg_populate_appointment_contact_fields
before insert or update of clinic_id, lead_id, lead_name, lead_phone
on appointments
for each row
execute function public.populate_appointment_contact_fields();

insert into agent_runtime_controls (clinic_id)
select c.id
from clinics c
where not exists (
  select 1
  from agent_runtime_controls arc
  where arc.clinic_id = c.id
);

create or replace function public.ensure_agent_runtime_controls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into agent_runtime_controls (clinic_id)
  values (new.id)
  on conflict (clinic_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_clinic_init_agent_runtime_controls on clinics;
create trigger trg_clinic_init_agent_runtime_controls
after insert on clinics
for each row
execute function public.ensure_agent_runtime_controls();

-- RLS helpers
create or replace function public.current_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select clinic_id from profiles where user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select role = 'admin' from profiles where user_id = auth.uid();
$$;

-- Enable RLS
alter table clinics enable row level security;
alter table profiles enable row level security;
alter table leads enable row level security;
alter table calls enable row level security;
alter table appointments enable row level security;
alter table busy_blocks enable row level security;
alter table calendar_connections enable row level security;
alter table calendar_events enable row level security;
alter table system_state enable row level security;
alter table agent_runtime_controls enable row level security;
alter table audit_log enable row level security;
alter table lead_ab_test_settings enable row level security;
alter table lead_ab_assignments enable row level security;
alter table lead_ab_events enable row level security;
alter table appointment_booking_requests enable row level security;

-- Policies
create policy "Clinics readable by members" on clinics
  for select using (id = current_clinic_id());

create policy "Profiles read own clinic" on profiles
  for select using (clinic_id = current_clinic_id());

create policy "Profiles insert self" on profiles
  for insert with check (user_id = auth.uid());

create policy "Leads select" on leads
  for select using (clinic_id = current_clinic_id());

create policy "Leads insert" on leads
  for insert with check (clinic_id = current_clinic_id());

create policy "Leads update" on leads
  for update using (clinic_id = current_clinic_id());

create policy "Calls select" on calls
  for select using (clinic_id = current_clinic_id());

create policy "Calls insert" on calls
  for insert with check (clinic_id = current_clinic_id());

create policy "Calls update" on calls
  for update using (clinic_id = current_clinic_id());

create policy "Appointments select" on appointments
  for select using (clinic_id = current_clinic_id());

create policy "Appointments insert" on appointments
  for insert with check (clinic_id = current_clinic_id());

create policy "Appointments update" on appointments
  for update using (clinic_id = current_clinic_id());

create policy "Busy blocks select" on busy_blocks
  for select using (clinic_id = current_clinic_id());

create policy "Busy blocks insert" on busy_blocks
  for insert with check (clinic_id = current_clinic_id());

create policy "Busy blocks update" on busy_blocks
  for update using (clinic_id = current_clinic_id());

create policy "Busy blocks delete" on busy_blocks
  for delete using (clinic_id = current_clinic_id());

create policy "Calendar connections admin" on calendar_connections
  for all using (is_admin()) with check (is_admin());

create policy "Calendar events select" on calendar_events
  for select using (clinic_id = current_clinic_id());

create policy "System state select" on system_state
  for select using (clinic_id = current_clinic_id());

create policy "System state update" on system_state
  for update using (clinic_id = current_clinic_id());

create policy "Agent runtime controls select" on agent_runtime_controls
  for select using (clinic_id = current_clinic_id());

create policy "Agent runtime controls admin insert" on agent_runtime_controls
  for insert with check (clinic_id = current_clinic_id() and is_admin());

create policy "Agent runtime controls admin update" on agent_runtime_controls
  for update using (clinic_id = current_clinic_id() and is_admin())
  with check (clinic_id = current_clinic_id() and is_admin());

create policy "Audit log select" on audit_log
  for select using (clinic_id = current_clinic_id());

create policy "Audit log insert" on audit_log
  for insert with check (clinic_id = current_clinic_id());

create policy "AB settings select" on lead_ab_test_settings
  for select using (clinic_id = current_clinic_id());

create policy "AB settings upsert admin" on lead_ab_test_settings
  for all using (is_admin()) with check (is_admin());

create policy "AB assignments select" on lead_ab_assignments
  for select using (clinic_id = current_clinic_id());

create policy "AB assignments insert" on lead_ab_assignments
  for insert with check (clinic_id = current_clinic_id());

create policy "AB assignments update" on lead_ab_assignments
  for update using (clinic_id = current_clinic_id());

create policy "AB events select" on lead_ab_events
  for select using (clinic_id = current_clinic_id());

create policy "AB events insert" on lead_ab_events
  for insert with check (clinic_id = current_clinic_id());

grant execute on function public.rpc_assign_ab_variant(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.rpc_find_nearest_slots(uuid, timestamptz, int, int, text) to authenticated, service_role;
grant execute on function public.rpc_book_appointment_slot(uuid, uuid, timestamptz, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.rpc_log_ab_event(uuid, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.rpc_ab_test_metrics(uuid, int) to authenticated, service_role;

-- Realtime publication
alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table calls;
alter publication supabase_realtime add table appointments;
alter publication supabase_realtime add table busy_blocks;
alter publication supabase_realtime add table system_state;
alter publication supabase_realtime add table agent_runtime_controls;
alter publication supabase_realtime add table calendar_events;

-- Seed data (replace user_id before running)
DO $$
declare
  clinic uuid := gen_random_uuid();
begin
  insert into clinics (id, name) values (clinic, 'Coco Clinics');
  insert into system_state (clinic_id) values (clinic);
  insert into agent_runtime_controls (clinic_id) values (clinic) on conflict (clinic_id) do nothing;
  -- Only insert profile if a real auth user exists with that id.
  if exists (select 1 from auth.users where id = '00000000-0000-0000-0000-000000000000') then
    insert into profiles (user_id, clinic_id, role, full_name)
    values ('00000000-0000-0000-0000-000000000000', clinic, 'admin', 'Admin Coco');
  end if;
end $$;


-- Journey pipeline extension (calls AI + WhatsApp AI)
-- Lead journey and multi-pipeline support for AI calls + WhatsApp escalation.

alter table if exists leads
  add column if not exists stage_key text,
  add column if not exists ab_variant text check (ab_variant in ('A', 'B')),
  add column if not exists last_contact_at timestamptz,
  add column if not exists next_action_at timestamptz;

alter table if exists calls
  add column if not exists attempt_no int not null default 1;

alter table if exists appointments
  add column if not exists source_channel text not null default 'staff';

create table if not exists lead_stage_catalog (
  stage_key text primary key,
  pipeline_key text not null,
  pipeline_label_es text not null,
  label_es text not null,
  description_es text,
  pipeline_order int not null default 1,
  order_index int not null,
  is_terminal boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

insert into lead_stage_catalog (
  stage_key,
  pipeline_key,
  pipeline_label_es,
  label_es,
  description_es,
  pipeline_order,
  order_index,
  is_terminal,
  is_active
)
values
  ('new_lead', 'calls_ai', 'Agentes de Llamada', 'Nuevo lead', 'Lead recién entrado desde Meta', 1, 10, false, true),
  ('first_call_in_progress', 'calls_ai', 'Agentes de Llamada', 'Primera llamada en curso', 'Retell AI realizando primera llamada outbound', 1, 20, false, true),
  ('no_answer_first_call', 'calls_ai', 'Agentes de Llamada', 'No contesta primera llamada', 'Sin respuesta en el primer intento', 1, 30, false, true),
  ('second_call_scheduled', 'calls_ai', 'Agentes de Llamada', 'Segunda llamada programada', 'Reintento pendiente en otra franja horaria', 1, 40, false, true),
  ('second_call_in_progress', 'calls_ai', 'Agentes de Llamada', 'Segunda llamada en curso', 'Retell AI realizando segundo intento', 1, 50, false, true),
  ('no_answer_second_call', 'calls_ai', 'Agentes de Llamada', 'No contesta segunda llamada', 'Escalado a canal WhatsApp', 1, 60, false, true),
  ('contacting_whatsapp', 'whatsapp_ai', 'Agentes de WhatsApp', 'Contactando por WhatsApp', 'Primer mensaje de WhatsApp enviado por el agente', 2, 10, false, true),
  ('whatsapp_conversation_active', 'whatsapp_ai', 'Agentes de WhatsApp', 'Conversación activa', 'Intercambio activo para detectar dolor y cerrar cita', 2, 20, false, true),
  ('whatsapp_followup_pending', 'whatsapp_ai', 'Agentes de WhatsApp', 'Seguimiento pendiente', 'Quedó pendiente respuesta del lead por WhatsApp', 2, 30, false, true),
  ('whatsapp_failed_team_review', 'whatsapp_ai', 'Agentes de WhatsApp', 'Revisión manual equipo', 'No se cerró por IA; se envía resumen al equipo', 2, 40, false, true),
  ('visit_scheduled', 'closed', 'Cerrados', 'Agendado', 'Cita confirmada en agenda', 3, 10, true, true),
  ('post_visit_pending_decision', 'closed', 'Cerrados', 'Pendiente decisión', 'Visitó la clínica y está valorando la propuesta', 3, 20, false, true),
  ('post_visit_follow_up', 'closed', 'Cerrados', 'Seguimiento post-visita', 'Requiere seguimiento comercial tras la visita', 3, 30, false, true),
  ('post_visit_not_closed', 'closed', 'Cerrados', 'No cerró tras visita', 'Hizo la visita pero no se cerró la venta', 3, 40, true, true),
  ('client_closed', 'closed', 'Cerrados', 'Cliente cerrado', 'Venta cerrada y cliente convertido', 3, 50, true, true),
  ('not_interested', 'closed', 'Cerrados', 'No interesado', 'Lead rechazó continuar', 3, 60, true, true),
  ('discarded', 'closed', 'Cerrados', 'Descartado', 'Lead descartado por criterio interno', 3, 70, true, true)
on conflict (stage_key) do update
set
  pipeline_key = excluded.pipeline_key,
  pipeline_label_es = excluded.pipeline_label_es,
  label_es = excluded.label_es,
  description_es = excluded.description_es,
  pipeline_order = excluded.pipeline_order,
  order_index = excluded.order_index,
  is_terminal = excluded.is_terminal,
  is_active = excluded.is_active;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_stage_key_fkey'
  ) then
    alter table leads
      add constraint leads_stage_key_fkey
      foreign key (stage_key) references lead_stage_catalog(stage_key);
  end if;
end $$;

update leads
set stage_key = case status
  when 'new' then 'new_lead'
  when 'whatsapp_sent' then 'contacting_whatsapp'
  when 'call_done' then 'first_call_in_progress'
  when 'contacted' then 'whatsapp_conversation_active'
  when 'visit_scheduled' then 'visit_scheduled'
  when 'no_response' then 'no_answer_second_call'
  when 'not_interested' then 'not_interested'
  else 'new_lead'
end
where stage_key is null;

alter table leads alter column stage_key set default 'new_lead';
update leads set stage_key = 'new_lead' where stage_key is null;
alter table leads alter column stage_key set not null;

create index if not exists leads_stage_key_idx on leads (stage_key);

create table if not exists lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  from_stage_key text references lead_stage_catalog(stage_key) on delete set null,
  to_stage_key text not null references lead_stage_catalog(stage_key),
  reason text,
  actor_type text not null default 'system',
  actor_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists lead_stage_history_lead_idx on lead_stage_history (lead_id, created_at desc);
create index if not exists lead_stage_history_stage_idx on lead_stage_history (clinic_id, to_stage_key, created_at desc);

create table if not exists lead_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null,
  attempt_no int not null default 1,
  status text not null default 'started',
  retell_call_id text,
  wa_message_id text,
  started_at timestamptz,
  ended_at timestamptz,
  outcome text,
  summary text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  check (channel in ('call_ai', 'whatsapp_ai', 'staff')),
  check (attempt_no > 0)
);

create unique index if not exists lead_contact_attempts_retell_uidx on lead_contact_attempts (clinic_id, retell_call_id);
create index if not exists lead_contact_attempts_lead_idx on lead_contact_attempts (lead_id, channel, created_at desc);

create table if not exists lead_next_actions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  action_type text not null,
  due_at timestamptz not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  processed_at timestamptz,
  created_at timestamptz default now(),
  check (action_type in ('retry_call', 'start_whatsapp_ai', 'notify_team')),
  check (status in ('pending', 'running', 'done', 'canceled', 'failed'))
);

create unique index if not exists lead_next_actions_idempotency_uidx on lead_next_actions (clinic_id, idempotency_key);
create index if not exists lead_next_actions_due_idx on lead_next_actions (clinic_id, status, due_at);

create table if not exists wa_threads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  phone_e164 text not null,
  state text not null default 'awaiting_reply',
  last_outbound_message_id uuid,
  hitl_active boolean not null default false,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (clinic_id, phone_e164)
);

create index if not exists wa_threads_lead_idx on wa_threads (lead_id, updated_at desc);

create table if not exists wa_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references wa_threads(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  provider_message_id text,
  direction text not null,
  role text not null,
  text text not null,
  intent text,
  ab_variant text check (ab_variant in ('A', 'B')),
  delivery_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  check (direction in ('inbound', 'outbound')),
  check (role in ('human', 'assistant', 'system'))
);

create unique index if not exists wa_messages_provider_uidx on wa_messages (clinic_id, provider_message_id);
create index if not exists wa_messages_thread_idx on wa_messages (thread_id, created_at desc);

alter table wa_threads
  drop constraint if exists wa_threads_last_outbound_fkey;

alter table wa_threads
  add constraint wa_threads_last_outbound_fkey
  foreign key (last_outbound_message_id) references wa_messages(id) on delete set null;

create table if not exists webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id) on delete cascade,
  source text not null,
  external_event_id text not null,
  payload_hash text,
  processed_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (source, external_event_id)
);

create index if not exists webhook_receipts_clinic_idx on webhook_receipts (clinic_id, processed_at desc);

create or replace function public.legacy_status_from_stage(p_stage_key text)
returns lead_status
language sql
stable
security definer
set search_path = public
as $$
  select case p_stage_key
    when 'new_lead' then 'new'::lead_status
    when 'first_call_in_progress' then 'call_done'::lead_status
    when 'no_answer_first_call' then 'no_response'::lead_status
    when 'second_call_scheduled' then 'no_response'::lead_status
    when 'second_call_in_progress' then 'no_response'::lead_status
    when 'no_answer_second_call' then 'no_response'::lead_status
    when 'contacting_whatsapp' then 'whatsapp_sent'::lead_status
    when 'whatsapp_conversation_active' then 'contacted'::lead_status
    when 'whatsapp_followup_pending' then 'whatsapp_sent'::lead_status
    when 'whatsapp_failed_team_review' then 'no_response'::lead_status
    when 'visit_scheduled' then 'visit_scheduled'::lead_status
    when 'post_visit_pending_decision' then 'contacted'::lead_status
    when 'post_visit_follow_up' then 'contacted'::lead_status
    when 'post_visit_not_closed' then 'not_interested'::lead_status
    when 'client_closed' then 'visit_scheduled'::lead_status
    when 'not_interested' then 'not_interested'::lead_status
    when 'discarded' then 'not_interested'::lead_status
    else 'call_done'::lead_status
  end;
$$;

create or replace function public.rpc_transition_lead_stage(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_to_stage_key text,
  p_reason text default null,
  p_actor_type text default 'system',
  p_actor_id text default null,
  p_meta jsonb default '{}'::jsonb
)
returns table (
  ok boolean,
  lead_id uuid,
  from_stage_key text,
  to_stage_key text,
  status lead_status,
  error text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead leads%rowtype;
  v_from_stage text;
  v_to_stage text := coalesce(nullif(trim(p_to_stage_key), ''), '');
  v_status lead_status;
begin
  if auth.uid() is not null and p_clinic_id <> current_clinic_id() then
    raise exception 'Not allowed for this clinic';
  end if;

  if p_clinic_id is null or p_lead_id is null or v_to_stage = '' then
    return query select false, p_lead_id, null::text, p_to_stage_key, null::lead_status, 'clinic_id, lead_id and to_stage_key are required';
    return;
  end if;

  if not exists (
    select 1
    from lead_stage_catalog
    where stage_key = v_to_stage
      and is_active = true
  ) then
    return query select false, p_lead_id, null::text, v_to_stage, null::lead_status, 'invalid or inactive stage_key';
    return;
  end if;

  select *
  into v_lead
  from leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
  for update;

  if not found then
    return query select false, p_lead_id, null::text, v_to_stage, null::lead_status, 'lead not found';
    return;
  end if;

  v_from_stage := coalesce(v_lead.stage_key, 'new_lead');
  v_status := legacy_status_from_stage(v_to_stage);

  if v_from_stage = v_to_stage then
    return query select true, v_lead.id, v_from_stage, v_to_stage, v_status, null::text;
    return;
  end if;

  update leads
  set stage_key = v_to_stage,
      status = v_status,
      updated_at = now(),
      next_action_at = coalesce((p_meta->>'next_action_at')::timestamptz, next_action_at)
  where id = v_lead.id;

  insert into lead_stage_history (
    clinic_id,
    lead_id,
    from_stage_key,
    to_stage_key,
    reason,
    actor_type,
    actor_id,
    meta
  )
  values (
    p_clinic_id,
    p_lead_id,
    v_from_stage,
    v_to_stage,
    p_reason,
    coalesce(nullif(trim(p_actor_type), ''), 'system'),
    nullif(trim(p_actor_id), ''),
    coalesce(p_meta, '{}'::jsonb)
  );

  insert into audit_log (
    clinic_id,
    entity_type,
    entity_id,
    action,
    meta
  )
  values (
    p_clinic_id,
    'lead',
    p_lead_id::text,
    'stage_changed',
    jsonb_build_object(
      'from_stage', v_from_stage,
      'to_stage', v_to_stage,
      'legacy_status', v_status,
      'reason', p_reason,
      'actor_type', coalesce(nullif(trim(p_actor_type), ''), 'system'),
      'actor_id', nullif(trim(p_actor_id), '')
    ) || coalesce(p_meta, '{}'::jsonb)
  );

  return query select true, v_lead.id, v_from_stage, v_to_stage, v_status, null::text;
end;
$$;

create or replace function public.stage_from_legacy_status(p_status lead_status)
returns text
language sql
immutable
as $$
  select case p_status
    when 'new' then 'new_lead'
    when 'whatsapp_sent' then 'contacting_whatsapp'
    when 'call_done' then 'first_call_in_progress'
    when 'contacted' then 'whatsapp_conversation_active'
    when 'visit_scheduled' then 'visit_scheduled'
    when 'no_response' then 'no_answer_first_call'
    when 'not_interested' then 'not_interested'
    else 'new_lead'
  end;
$$;

create or replace function public.sync_lead_stage_from_status()
returns trigger
language plpgsql
as $$
begin
  if new.stage_key is null or btrim(new.stage_key) = '' then
    new.stage_key := stage_from_legacy_status(new.status);
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and new.stage_key is not distinct from old.stage_key then
    new.stage_key := stage_from_legacy_status(new.status);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_lead_stage_from_status on leads;
create trigger trg_sync_lead_stage_from_status
before insert or update of status, stage_key
on leads
for each row
execute function public.sync_lead_stage_from_status();

create or replace function public.sync_lead_stage_from_calls()
returns trigger
language plpgsql
as $$
declare
  v_target_stage text;
begin
  if new.lead_id is null then
    return new;
  end if;

  if new.status = 'in_progress' and new.ended_at is null then
    v_target_stage := case
      when coalesce(new.attempt_no, 1) > 1 then 'second_call_in_progress'
      else 'first_call_in_progress'
    end;

    update leads
    set stage_key = v_target_stage,
        status = legacy_status_from_stage(v_target_stage),
        updated_at = now()
    where id = new.lead_id
      and clinic_id = new.clinic_id
      and (
        stage_key is distinct from v_target_stage
        or status is distinct from legacy_status_from_stage(v_target_stage)
      );

    return new;
  end if;

  if new.ended_at is not null or new.status = 'ended' then
    update leads
    set stage_key = case
        when status = 'visit_scheduled' then 'visit_scheduled'
        when status = 'not_interested' then 'not_interested'
        when status = 'no_response' then 'no_answer_first_call'
        when status = 'whatsapp_sent' then 'contacting_whatsapp'
        when status = 'contacted' then 'whatsapp_conversation_active'
        else 'second_call_scheduled'
      end,
        updated_at = now()
    where id = new.lead_id
      and clinic_id = new.clinic_id
      and stage_key in ('first_call_in_progress', 'second_call_in_progress');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_lead_stage_from_calls on calls;
create trigger trg_sync_lead_stage_from_calls
after insert or update of status, ended_at, attempt_no, lead_id
on calls
for each row
execute function public.sync_lead_stage_from_calls();

create or replace function public.sync_lead_stage_from_appointments()
returns trigger
language plpgsql
as $$
begin
  if new.lead_id is null then
    return new;
  end if;

  if new.status in ('scheduled', 'done') then
    update leads
    set stage_key = 'visit_scheduled',
        status = 'visit_scheduled',
        next_action_at = null,
        updated_at = now()
    where id = new.lead_id
      and clinic_id = new.clinic_id
      and (
        stage_key is distinct from 'visit_scheduled'
        or status is distinct from 'visit_scheduled'
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_lead_stage_from_appointments on appointments;
create trigger trg_sync_lead_stage_from_appointments
after insert or update of status, lead_id
on appointments
for each row
execute function public.sync_lead_stage_from_appointments();

alter table lead_stage_catalog enable row level security;
alter table lead_stage_history enable row level security;
alter table lead_contact_attempts enable row level security;
alter table lead_next_actions enable row level security;
alter table wa_threads enable row level security;
alter table wa_messages enable row level security;
alter table webhook_receipts enable row level security;

create policy "Stage catalog select" on lead_stage_catalog
  for select using (true);

create policy "Stage catalog admin write" on lead_stage_catalog
  for all using (is_admin()) with check (is_admin());

create policy "Lead stage history select" on lead_stage_history
  for select using (clinic_id = current_clinic_id());

create policy "Lead stage history insert" on lead_stage_history
  for insert with check (clinic_id = current_clinic_id());

create policy "Contact attempts select" on lead_contact_attempts
  for select using (clinic_id = current_clinic_id());

create policy "Contact attempts insert" on lead_contact_attempts
  for insert with check (clinic_id = current_clinic_id());

create policy "Contact attempts update" on lead_contact_attempts
  for update using (clinic_id = current_clinic_id());

create policy "Next actions select" on lead_next_actions
  for select using (clinic_id = current_clinic_id());

create policy "Next actions insert" on lead_next_actions
  for insert with check (clinic_id = current_clinic_id());

create policy "Next actions update" on lead_next_actions
  for update using (clinic_id = current_clinic_id());

create policy "WA threads select" on wa_threads
  for select using (clinic_id = current_clinic_id());

create policy "WA threads insert" on wa_threads
  for insert with check (clinic_id = current_clinic_id());

create policy "WA threads update" on wa_threads
  for update using (clinic_id = current_clinic_id());

create policy "WA messages select" on wa_messages
  for select using (clinic_id = current_clinic_id());

create policy "WA messages insert" on wa_messages
  for insert with check (clinic_id = current_clinic_id());

create policy "WA messages update" on wa_messages
  for update using (clinic_id = current_clinic_id());

create policy "Webhook receipts select" on webhook_receipts
  for select using (clinic_id = current_clinic_id());

create policy "Webhook receipts insert" on webhook_receipts
  for insert with check (clinic_id = current_clinic_id());

create policy "Webhook receipts update" on webhook_receipts
  for update using (clinic_id = current_clinic_id());

grant execute on function public.legacy_status_from_stage(text) to authenticated, service_role;
grant execute on function public.rpc_transition_lead_stage(uuid, uuid, text, text, text, text, jsonb) to authenticated, service_role;

alter publication supabase_realtime add table lead_stage_history;
alter publication supabase_realtime add table lead_contact_attempts;
alter publication supabase_realtime add table lead_next_actions;
alter publication supabase_realtime add table wa_threads;
alter publication supabase_realtime add table wa_messages;
