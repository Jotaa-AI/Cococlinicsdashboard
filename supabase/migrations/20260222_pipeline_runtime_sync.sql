-- Keep pipeline stages synced when n8n writes directly in leads/calls/appointments.
-- Rules requested:
-- - call in_progress -> Primera llamada en curso
-- - call ended_at populated -> leave "llamada en curso"
-- - appointment scheduled/done -> Agendado
-- - lead.status no_response -> No contesta primera llamada
-- - lead.status not_interested -> No interesado

create or replace function public.stage_from_legacy_status(p_status lead_status)
returns text
language sql
immutable
as $$
  select case p_status
    when 'new' then 'new_lead'
    when 'whatsapp_sent' then 'contacting_whatsapp'
    when 'call_done' then 'first_call_in_progress'
    when 'contacted' then 'whatsapp_conversation_active'
    when 'visit_scheduled' then 'visit_scheduled'
    when 'no_response' then 'no_answer_first_call'
    when 'not_interested' then 'not_interested'
    else 'new_lead'
  end;
$$;

create or replace function public.sync_lead_stage_from_status()
returns trigger
language plpgsql
as $$
begin
  if new.stage_key is null or btrim(new.stage_key) = '' then
    new.stage_key := stage_from_legacy_status(new.status);
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and new.stage_key is not distinct from old.stage_key then
    new.stage_key := stage_from_legacy_status(new.status);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_lead_stage_from_status on leads;
create trigger trg_sync_lead_stage_from_status
before insert or update of status, stage_key
on leads
for each row
execute function public.sync_lead_stage_from_status();

create or replace function public.sync_lead_stage_from_calls()
returns trigger
language plpgsql
as $$
declare
  v_target_stage text;
begin
  if new.lead_id is null then
    return new;
  end if;

  if new.status = 'in_progress' and new.ended_at is null then
    v_target_stage := case
      when coalesce(new.attempt_no, 1) > 1 then 'second_call_in_progress'
      else 'first_call_in_progress'
    end;

    update leads
    set stage_key = v_target_stage,
        status = legacy_status_from_stage(v_target_stage),
        updated_at = now()
    where id = new.lead_id
      and clinic_id = new.clinic_id
      and (
        stage_key is distinct from v_target_stage
        or status is distinct from legacy_status_from_stage(v_target_stage)
      );

    return new;
  end if;

  if new.ended_at is not null or new.status = 'ended' then
    update leads
    set stage_key = case
        when status = 'visit_scheduled' then 'visit_scheduled'
        when status = 'not_interested' then 'not_interested'
        when status = 'no_response' then 'no_answer_first_call'
        when status = 'whatsapp_sent' then 'contacting_whatsapp'
        when status = 'contacted' then 'whatsapp_conversation_active'
        else 'second_call_scheduled'
      end,
        updated_at = now()
    where id = new.lead_id
      and clinic_id = new.clinic_id
      and stage_key in ('first_call_in_progress', 'second_call_in_progress');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_lead_stage_from_calls on calls;
create trigger trg_sync_lead_stage_from_calls
after insert or update of status, ended_at, attempt_no, lead_id
on calls
for each row
execute function public.sync_lead_stage_from_calls();

create or replace function public.sync_lead_stage_from_appointments()
returns trigger
language plpgsql
as $$
begin
  if new.lead_id is null then
    return new;
  end if;

  if new.status in ('scheduled', 'done') then
    update leads
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

drop trigger if exists trg_sync_lead_stage_from_appointments on appointments;
create trigger trg_sync_lead_stage_from_appointments
after insert or update of status, lead_id
on appointments
for each row
execute function public.sync_lead_stage_from_appointments();
