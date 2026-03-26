alter table public.lead_no_reply_alerts
  add column if not exists origin text;

update public.lead_no_reply_alerts
set origin = 'auto'
where origin is null;

alter table public.lead_no_reply_alerts
  alter column origin set default 'auto';

alter table public.lead_no_reply_alerts
  alter column origin set not null;

alter table public.lead_no_reply_alerts
  drop constraint if exists lead_no_reply_alerts_origin_check;

alter table public.lead_no_reply_alerts
  add constraint lead_no_reply_alerts_origin_check
  check (origin in ('auto', 'backfill'));

create or replace function public.sync_lead_no_reply_alerts_from_lead()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(trim(new.phone), '') = '' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.created_at is not distinct from old.created_at
     and new.phone is distinct from old.phone then
    update public.lead_no_reply_alerts
    set
      lead_phone = new.phone,
      updated_at = now()
    where lead_id = new.id
      and anchor_created_at = new.created_at
      and status in ('pending', 'dispatched', 'error');

    return new;
  end if;

  update public.lead_no_reply_alerts
  set
    status = 'skipped_terminal',
    skipped_at = now(),
    updated_at = now(),
    last_error = 'Ciclo anterior sustituido por un nuevo alta del lead.'
  where lead_id = new.id
    and anchor_created_at is distinct from new.created_at
    and status in ('pending', 'dispatched', 'error');

  insert into public.lead_no_reply_alerts (
    clinic_id,
    lead_id,
    lead_phone,
    anchor_created_at,
    alert_key,
    send_at,
    status,
    origin,
    request_id,
    dispatched_at,
    sent_at,
    skipped_at,
    last_response_code,
    last_error,
    created_at,
    updated_at
  )
  select
    new.clinic_id,
    new.id,
    new.phone,
    new.created_at,
    alert_key,
    send_at,
    'pending',
    'auto',
    null,
    null,
    null,
    null,
    null,
    null,
    now(),
    now()
  from (
    values
      ('3h'::text, new.created_at + interval '3 hours'),
      ('24h'::text, new.created_at + interval '24 hours'),
      ('4d'::text, new.created_at + interval '4 days'),
      ('8d'::text, new.created_at + interval '8 days')
  ) as schedule(alert_key, send_at)
  on conflict (lead_id, alert_key, anchor_created_at) do update
  set
    clinic_id = excluded.clinic_id,
    lead_phone = excluded.lead_phone,
    send_at = excluded.send_at,
    updated_at = now(),
    origin = excluded.origin,
    status = case
      when lead_no_reply_alerts.status in ('sent', 'skipped_replied', 'skipped_terminal')
        then lead_no_reply_alerts.status
      else 'pending'
    end,
    request_id = case
      when lead_no_reply_alerts.status in ('sent', 'skipped_replied', 'skipped_terminal')
        then lead_no_reply_alerts.request_id
      else null
    end,
    dispatched_at = case
      when lead_no_reply_alerts.status in ('sent', 'skipped_replied', 'skipped_terminal')
        then lead_no_reply_alerts.dispatched_at
      else null
    end,
    sent_at = case
      when lead_no_reply_alerts.status in ('sent', 'skipped_replied', 'skipped_terminal')
        then lead_no_reply_alerts.sent_at
      else null
    end,
    skipped_at = case
      when lead_no_reply_alerts.status in ('sent', 'skipped_replied', 'skipped_terminal')
        then lead_no_reply_alerts.skipped_at
      else null
    end,
    last_response_code = case
      when lead_no_reply_alerts.status in ('sent', 'skipped_replied', 'skipped_terminal')
        then lead_no_reply_alerts.last_response_code
      else null
    end,
    last_error = case
      when lead_no_reply_alerts.status in ('sent', 'skipped_replied', 'skipped_terminal')
        then lead_no_reply_alerts.last_error
      else null
    end;

  return new;
end;
$$;

create or replace function public.dispatch_due_lead_no_reply_alerts(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_request_id bigint;
  v_count integer := 0;
  v_has_reply boolean;
begin
  for rec in
    select
      a.*,
      l.id as current_lead_id,
      l.created_at as lead_created_at,
      l.full_name,
      l.source as lead_source,
      l.stage_key,
      l.managed_by,
      l.whatsapp_blocked,
      l.has_scheduled_appointment,
      l.converted_to_client
    from public.lead_no_reply_alerts a
    left join public.leads l
      on l.id = a.lead_id
     and l.clinic_id = a.clinic_id
    where a.status = 'pending'
      and a.send_at <= now()
    order by a.send_at asc
    limit p_limit
    for update of a skip locked
  loop
    select exists (
      select 1
      from public.wa_messages wm
      left join public.wa_threads wt on wt.id = wm.thread_id
      where wm.clinic_id = rec.clinic_id
        and wm.direction = 'inbound'
        and wm.role = 'human'
        and wm.created_at >= rec.anchor_created_at
        and (
          (rec.lead_id is not null and wm.lead_id = rec.lead_id)
          or (rec.lead_phone is not null and wt.phone_e164 = rec.lead_phone)
          or (rec.lead_phone is not null and coalesce(wm.metadata->>'from', '') = rec.lead_phone)
        )
    )
    into v_has_reply;

    if v_has_reply then
      update public.lead_no_reply_alerts
      set
        status = 'skipped_replied',
        skipped_at = now(),
        updated_at = now(),
        last_error = 'Lead respondió antes de disparar el aviso.'
      where id = rec.id;
      continue;
    end if;

    if rec.current_lead_id is null
       or coalesce(rec.whatsapp_blocked, false)
       or coalesce(rec.managed_by::text, '') = 'humano'
       or coalesce(rec.has_scheduled_appointment, false)
       or coalesce(rec.converted_to_client, false)
       or coalesce(rec.stage_key, '') in (
         'visit_scheduled',
         'visit_canceled',
         'visit_no_show',
         'post_visit_pending_decision',
         'post_visit_follow_up',
         'post_visit_not_closed',
         'client_closed',
         'not_interested',
         'discarded'
       ) then
      update public.lead_no_reply_alerts
      set
        status = 'skipped_terminal',
        skipped_at = now(),
        updated_at = now(),
        last_error = 'Lead fuera de seguimiento automático o ya gestionado.'
      where id = rec.id;
      continue;
    end if;

    v_request_id := net.http_post(
      url := 'https://personal-n8n.brtnrr.easypanel.host/webhook/avisos-no-contestan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'alert_id', rec.id,
        'alert_key', rec.alert_key,
        'clinic_id', rec.clinic_id,
        'lead_id', rec.lead_id,
        'lead_name', rec.full_name,
        'lead_phone', rec.lead_phone,
        'lead_source', rec.lead_source,
        'lead_stage_key', rec.stage_key,
        'lead_managed_by', rec.managed_by,
        'lead_created_at', rec.lead_created_at,
        'anchor_created_at', rec.anchor_created_at,
        'origin', rec.origin,
        'send_at', rec.send_at,
        'source', 'supabase_no_reply_alerts'
      ),
      timeout_milliseconds := 5000
    );

    update public.lead_no_reply_alerts
    set
      status = 'dispatched',
      request_id = v_request_id,
      dispatched_at = now(),
      updated_at = now()
    where id = rec.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.rpc_backfill_existing_lead_no_reply_alerts(
  p_clinic_id uuid,
  p_first_send_at timestamptz
)
returns table (
  leads_evaluados integer,
  leads_insertados integer,
  leads_descartados integer,
  anchor_created_at timestamptz,
  first_send_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anchor_created_at timestamptz := now();
  v_leads_evaluados integer := 0;
  v_leads_insertados integer := 0;
begin
  if p_first_send_at is null then
    raise exception 'p_first_send_at es obligatorio';
  end if;

  if p_first_send_at <= v_anchor_created_at then
    raise exception 'p_first_send_at debe estar en el futuro';
  end if;

  with snapshot as (
    select
      l.id,
      l.clinic_id,
      l.phone,
      l.created_at,
      l.stage_key,
      l.managed_by,
      l.whatsapp_blocked,
      l.has_scheduled_appointment,
      l.converted_to_client
    from public.leads l
    where l.clinic_id = p_clinic_id
      and coalesce(trim(l.phone), '') <> ''
      and l.created_at <= v_anchor_created_at - interval '3 hours'
  ),
  eligible as (
    select s.*
    from snapshot s
    where not coalesce(s.whatsapp_blocked, false)
      and coalesce(s.managed_by::text, '') <> 'humano'
      and not coalesce(s.has_scheduled_appointment, false)
      and not coalesce(s.converted_to_client, false)
      and coalesce(s.stage_key, '') not in (
        'visit_scheduled',
        'visit_canceled',
        'visit_no_show',
        'post_visit_pending_decision',
        'post_visit_follow_up',
        'post_visit_not_closed',
        'client_closed',
        'not_interested',
        'discarded'
      )
      and not exists (
        select 1
        from public.lead_no_reply_alerts a
        where a.lead_id = s.id
      )
      and not exists (
        select 1
        from public.wa_messages wm
        left join public.wa_threads wt on wt.id = wm.thread_id
        where wm.clinic_id = s.clinic_id
          and wm.direction = 'inbound'
          and wm.role = 'human'
          and wm.created_at >= s.created_at
          and (
            wm.lead_id = s.id
            or (wt.phone_e164 is not null and wt.phone_e164 = s.phone)
            or coalesce(wm.metadata->>'from', '') = s.phone
          )
      )
  ),
  inserted as (
    insert into public.lead_no_reply_alerts (
      clinic_id,
      lead_id,
      lead_phone,
      anchor_created_at,
      alert_key,
      send_at,
      status,
      origin,
      request_id,
      dispatched_at,
      sent_at,
      skipped_at,
      last_response_code,
      last_error,
      created_at,
      updated_at
    )
    select
      e.clinic_id,
      e.id,
      e.phone,
      v_anchor_created_at,
      schedule.alert_key,
      schedule.send_at,
      'pending',
      'backfill',
      null,
      null,
      null,
      null,
      null,
      null,
      now(),
      now()
    from eligible e
    cross join lateral (
      values
        ('3h'::text, p_first_send_at),
        ('24h'::text, p_first_send_at + interval '21 hours'),
        ('4d'::text, p_first_send_at + interval '3 days 21 hours'),
        ('8d'::text, p_first_send_at + interval '7 days 21 hours')
    ) as schedule(alert_key, send_at)
    returning lead_id
  )
  select
    (select count(*) from snapshot),
    (select count(distinct lead_id) from inserted)
  into
    v_leads_evaluados,
    v_leads_insertados;

  leads_evaluados := coalesce(v_leads_evaluados, 0);
  leads_insertados := coalesce(v_leads_insertados, 0);
  leads_descartados := greatest(leads_evaluados - leads_insertados, 0);
  anchor_created_at := v_anchor_created_at;
  first_send_at := p_first_send_at;

  return next;
end;
$$;

grant execute on function public.rpc_backfill_existing_lead_no_reply_alerts(uuid, timestamptz) to authenticated, service_role;
