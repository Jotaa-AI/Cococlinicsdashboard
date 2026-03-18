do $$
begin
  create type lead_managed_by as enum ('humano', 'IA');
exception
  when duplicate_object then null;
end $$;

alter table public.leads
  add column if not exists managed_by lead_managed_by;

create index if not exists leads_managed_by_idx
  on public.leads (clinic_id, managed_by);
