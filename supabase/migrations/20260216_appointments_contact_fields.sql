-- Store lead contact data directly on appointments
-- Final names required: appointments.lead_name / appointments.lead_phone

alter table if exists appointments add column if not exists title text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'patient_name'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'lead_name'
  ) then
    alter table appointments rename column patient_name to lead_name;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'patient_phone'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'lead_phone'
  ) then
    alter table appointments rename column patient_phone to lead_phone;
  end if;
end $$;

alter table if exists appointments
  add column if not exists lead_name text,
  add column if not exists lead_phone text;

create index if not exists appointments_lead_phone_idx
  on appointments (clinic_id, lead_phone);
drop index if exists appointments_patient_phone_idx;

update appointments a
set lead_name = coalesce(a.lead_name, l.full_name),
    lead_phone = coalesce(a.lead_phone, l.phone)
from leads l
where a.clinic_id = l.clinic_id
  and a.lead_id = l.id
  and (a.lead_name is null or a.lead_phone is null);

create or replace function public.populate_appointment_contact_fields()
returns trigger
language plpgsql
as $$
declare
  v_lead_name text;
  v_lead_phone text;
begin
  if new.lead_id is not null then
    select full_name, phone
      into v_lead_name, v_lead_phone
    from leads
    where id = new.lead_id
      and clinic_id = new.clinic_id
    limit 1;

    if (new.lead_name is null or trim(new.lead_name) = '') and v_lead_name is not null then
      new.lead_name := v_lead_name;
    end if;

    if (new.lead_phone is null or trim(new.lead_phone) = '') and v_lead_phone is not null then
      new.lead_phone := v_lead_phone;
    end if;
  end if;

  if new.lead_name is not null then
    new.lead_name := nullif(trim(new.lead_name), '');
  end if;

  if new.lead_phone is not null then
    new.lead_phone := nullif(trim(new.lead_phone), '');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_populate_appointment_contact_fields on appointments;
create trigger trg_populate_appointment_contact_fields
before insert or update of clinic_id, lead_id, lead_name, lead_phone
on appointments
for each row
execute function public.populate_appointment_contact_fields();
