create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  body text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists lead_notes_lead_idx
  on public.lead_notes (lead_id, created_at desc);

create index if not exists lead_notes_clinic_idx
  on public.lead_notes (clinic_id, created_at desc);

alter table public.lead_notes enable row level security;

drop policy if exists "Lead notes select" on public.lead_notes;
create policy "Lead notes select" on public.lead_notes
  for select using (clinic_id = public.current_clinic_id());

drop policy if exists "Lead notes insert" on public.lead_notes;
create policy "Lead notes insert" on public.lead_notes
  for insert with check (clinic_id = public.current_clinic_id());

drop policy if exists "Lead notes update" on public.lead_notes;
create policy "Lead notes update" on public.lead_notes
  for update using (clinic_id = public.current_clinic_id());

alter publication supabase_realtime add table public.lead_notes;
