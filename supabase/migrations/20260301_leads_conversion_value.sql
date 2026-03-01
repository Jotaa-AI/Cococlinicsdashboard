alter table if exists leads
  add column if not exists converted_to_client boolean not null default false,
  add column if not exists converted_value_eur numeric(10,2),
  add column if not exists converted_at timestamptz;

update leads
set converted_to_client = coalesce(converted_to_client, false)
where converted_to_client is null;
