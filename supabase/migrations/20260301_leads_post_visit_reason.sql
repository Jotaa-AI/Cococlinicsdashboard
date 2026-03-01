alter table if exists leads
  add column if not exists post_visit_outcome_reason text;
