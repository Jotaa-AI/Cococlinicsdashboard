-- A/B test support for Meta lead contact strategy.
-- Keeps orchestration in n8n and decision/state in Supabase.

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

-- Assigns a lead to A/B deterministically and persists the decision.
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

-- Suggests nearest available 30-minute slots for the requested time.
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

-- Books a 30-minute slot with idempotency for n8n retries.
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

alter table lead_ab_test_settings enable row level security;
alter table lead_ab_assignments enable row level security;
alter table lead_ab_events enable row level security;
alter table appointment_booking_requests enable row level security;

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

