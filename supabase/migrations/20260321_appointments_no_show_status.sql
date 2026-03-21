alter type public.appointment_status
  add value if not exists 'no_show';

create or replace function public.sync_lead_stage_from_appointments()
returns trigger
language plpgsql
as $$
begin
  if new.lead_id is null then
    return new;
  end if;

  if new.status = 'no_show'::appointment_status then
    update public.leads
    set stage_key = 'visit_no_show',
        status = 'contacted',
        next_action_at = null,
        updated_at = now()
    where id = new.lead_id
      and clinic_id = new.clinic_id
      and (
        stage_key is distinct from 'visit_no_show'
        or status is distinct from 'contacted'
      );
  elsif new.status in ('scheduled'::appointment_status, 'done'::appointment_status) then
    update public.leads
    set stage_key = 'visit_scheduled',
        status = 'visit_scheduled',
        next_action_at = null,
        updated_at = now()
    where id = new.lead_id
      and clinic_id = new.clinic_id
      and (
        stage_key is distinct from 'visit_scheduled'
        or status is distinct from 'visit_scheduled'
      );
  end if;

  return new;
end;
$$;

update public.appointments
set status = 'no_show'::public.appointment_status
where status <> 'no_show'::public.appointment_status
  and (
    lower(coalesce(notes, '')) like '%[no_show]%'
    or lower(coalesce(notes, '')) like '%no asistió a la cita%'
  );
