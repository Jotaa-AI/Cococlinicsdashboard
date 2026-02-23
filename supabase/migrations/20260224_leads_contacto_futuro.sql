-- Fecha/hora objetivo para recontactar leads en el futuro.

alter table if exists leads
  add column if not exists contacto_futuro timestamptz;

create index if not exists leads_contacto_futuro_idx
  on leads (clinic_id, contacto_futuro)
  where contacto_futuro is not null;
