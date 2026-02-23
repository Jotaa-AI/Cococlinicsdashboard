-- Ensure call recordings can be stored and queried efficiently.

alter table if exists calls
  add column if not exists recording_url text;

create index if not exists calls_recording_url_idx
  on calls (clinic_id)
  where recording_url is not null;
