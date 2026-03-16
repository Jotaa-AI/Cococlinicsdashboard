alter table if exists public.leads
  add column if not exists has_scheduled_appointment boolean not null default false;

create index if not exists leads_has_scheduled_appointment_idx
  on public.leads (clinic_id, has_scheduled_appointment);

create or replace function public.refresh_lead_has_scheduled_appointment(
  p_clinic_id uuid,
  p_lead_id uuid
)
returns void
language plpgsql
as $$
begin
  if p_clinic_id is null or p_lead_id is null then
    return;
  end if;

  update public.leads l
  set has_scheduled_appointment = exists (
    select 1
    from public.appointments a
    where a.clinic_id = p_clinic_id
      and a.lead_id = p_lead_id
      and a.status = 'scheduled'
  ),
      updated_at = now()
  where l.clinic_id = p_clinic_id
    and l.id = p_lead_id;
end;
$$;

create or replace function public.sync_lead_has_scheduled_appointment_from_appointments()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.refresh_lead_has_scheduled_appointment(new.clinic_id, new.lead_id);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.lead_id is distinct from new.lead_id and old.lead_id is not null then
      perform public.refresh_lead_has_scheduled_appointment(old.clinic_id, old.lead_id);
    end if;

    perform public.refresh_lead_has_scheduled_appointment(new.clinic_id, new.lead_id);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.refresh_lead_has_scheduled_appointment(old.clinic_id, old.lead_id);
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sync_lead_has_scheduled_appointment on public.appointments;
create trigger trg_sync_lead_has_scheduled_appointment
after insert or update of lead_id, status or delete
on public.appointments
for each row
execute function public.sync_lead_has_scheduled_appointment_from_appointments();

update public.leads l
set has_scheduled_appointment = exists (
  select 1
  from public.appointments a
  where a.clinic_id = l.clinic_id
    and a.lead_id = l.id
    and a.status = 'scheduled'
);
