-- Persist per-call cost for dashboard/detail metrics.

alter table if exists calls
  add column if not exists call_cost_eur numeric(10,4);

create index if not exists calls_cost_idx
  on calls (clinic_id)
  where call_cost_eur is not null;
