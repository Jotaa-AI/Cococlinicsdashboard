alter table if exists leads
  add column if not exists converted_service_name text;
