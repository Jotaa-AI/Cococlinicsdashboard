do $$
begin
  create type lead_intent as enum ('1', '2');
exception
  when duplicate_object then null;
end $$;

alter table public.leads
  add column if not exists intents lead_intent;

create index if not exists leads_status_intents_idx
  on public.leads (clinic_id, status, intents);
