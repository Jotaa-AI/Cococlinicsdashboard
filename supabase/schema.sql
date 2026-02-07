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

-- Core tables
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists leads_phone_unique on leads (clinic_id, phone);
create index if not exists leads_phone_idx on leads (phone);
create index if not exists leads_created_at_idx on leads (created_at);
create index if not exists leads_status_idx on leads (status);

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
  outcome text,
  transcript text,
  summary text,
  extracted jsonb,
  recording_url text,
  created_at timestamptz default now()
);

create index if not exists calls_started_at_idx on calls (started_at);
create index if not exists calls_outcome_idx on calls (outcome);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  title text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status appointment_status not null default 'scheduled',
  notes text,
  gcal_event_id text,
  created_by text not null default 'staff',
  created_at timestamptz default now()
);

create index if not exists appointments_start_at_idx on appointments (start_at);
create index if not exists appointments_status_idx on appointments (status);

create table if not exists busy_blocks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz default now(),
  created_by_user_id uuid references auth.users(id) on delete set null
);

create index if not exists busy_blocks_start_at_idx on busy_blocks (start_at);

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
alter table if exists calendar_events add column if not exists title text;

create table if not exists system_state (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references clinics(id) on delete cascade,
  current_call_retell_id text,
  current_call_lead_id uuid references leads(id) on delete set null,
  current_call_started_at timestamptz,
  updated_at timestamptz default now()
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
alter table audit_log enable row level security;

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

create policy "Audit log select" on audit_log
  for select using (clinic_id = current_clinic_id());

create policy "Audit log insert" on audit_log
  for insert with check (clinic_id = current_clinic_id());

-- Realtime publication
alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table calls;
alter publication supabase_realtime add table appointments;
alter publication supabase_realtime add table busy_blocks;
alter publication supabase_realtime add table system_state;
alter publication supabase_realtime add table calendar_events;

-- Seed data (replace user_id before running)
DO $$
declare
  clinic uuid := gen_random_uuid();
begin
  insert into clinics (id, name) values (clinic, 'Coco Clinics');
  insert into system_state (clinic_id) values (clinic);
  -- Only insert profile if a real auth user exists with that id.
  if exists (select 1 from auth.users where id = '00000000-0000-0000-0000-000000000000') then
    insert into profiles (user_id, clinic_id, role, full_name)
    values ('00000000-0000-0000-0000-000000000000', clinic, 'admin', 'Admin Coco');
  end if;
end $$;
