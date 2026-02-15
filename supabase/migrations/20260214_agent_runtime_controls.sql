-- Runtime controls for AI agents + per-lead WhatsApp block

alter table if exists leads
  add column if not exists whatsapp_blocked boolean not null default false,
  add column if not exists whatsapp_blocked_reason text,
  add column if not exists whatsapp_blocked_at timestamptz,
  add column if not exists whatsapp_blocked_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists leads_whatsapp_blocked_idx
  on leads (clinic_id, whatsapp_blocked);

create table if not exists agent_runtime_controls (
  clinic_id uuid primary key references clinics(id) on delete cascade,
  calls_agent_active boolean not null default true,
  whatsapp_agent_active boolean not null default true,
  hitl_mode_active boolean not null default false,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

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

alter table agent_runtime_controls enable row level security;

drop policy if exists "Agent runtime controls select" on agent_runtime_controls;
create policy "Agent runtime controls select" on agent_runtime_controls
  for select using (clinic_id = current_clinic_id());

drop policy if exists "Agent runtime controls admin insert" on agent_runtime_controls;
create policy "Agent runtime controls admin insert" on agent_runtime_controls
  for insert with check (clinic_id = current_clinic_id() and is_admin());

drop policy if exists "Agent runtime controls admin update" on agent_runtime_controls;
create policy "Agent runtime controls admin update" on agent_runtime_controls
  for update using (clinic_id = current_clinic_id() and is_admin())
  with check (clinic_id = current_clinic_id() and is_admin());


do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agent_runtime_controls'
  ) then
    alter publication supabase_realtime add table agent_runtime_controls;
  end if;
exception
  when undefined_object then null;
end
$$;
