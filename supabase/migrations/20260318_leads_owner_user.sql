alter table public.leads
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

create index if not exists leads_owner_user_idx
  on public.leads (clinic_id, owner_user_id);
