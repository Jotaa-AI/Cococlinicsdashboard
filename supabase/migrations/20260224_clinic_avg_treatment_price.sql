-- Configurable average treatment price used for revenue KPI on successful calls.

alter table if exists clinics
  add column if not exists avg_treatment_price_eur numeric(10,2) not null default 399;

update clinics
set avg_treatment_price_eur = 399
where avg_treatment_price_eur is null;
