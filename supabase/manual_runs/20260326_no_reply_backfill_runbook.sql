-- RUNBOOK MANUAL
-- No-reply alerts + backfill controlado de leads existentes
-- Proyecto: Coco Clinics
-- Fecha preparada: 2026-03-26
--
-- COMO USAR ESTE ARCHIVO
-- 1. Ejecuta los bloques en orden en el SQL Editor de Supabase.
-- 2. Los pasos 1 y 2 son de infraestructura y solo se ejecutan una vez.
-- 3. El paso 4 es solo preview para revisar cuántos leads entrarían.
-- 4. El paso 5 es el disparo real del backfill para mañana a las 09:00.
--
-- IMPORTANTE
-- - Si alguna migración ya la ejecutaste antes, ese bloque debería ser idempotente o no hacer nada.
-- - El webhook destino es:
--   https://personal-n8n.brtnrr.easypanel.host/webhook/avisos-no-contestan


-- ============================================================
-- PASO 1. CREAR INFRAESTRUCTURA BASE DE ALERTAS
-- Ejecuta TODO este bloque una sola vez.
-- Fuente original:
--   supabase/migrations/20260326_lead_no_reply_alerts.sql
-- ============================================================
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.lead_no_reply_alerts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  lead_phone text,
  anchor_created_at timestamptz not null,
  alert_key text not null check (alert_key in ('3h', '24h', '4d', '8d')),
  send_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'dispatched', 'sent', 'skipped_replied', 'skipped_terminal', 'error')
  ),
  request_id bigint,
  dispatched_at timestamptz,
  sent_at timestamptz,
  skipped_at timestamptz,
  last_response_code integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, alert_key, anchor_created_at)
);

create index if not exists lead_no_reply_alerts_due_idx
  on public.lead_no_reply_alerts (status, send_at);

create index if not exists lead_no_reply_alerts_lead_idx
  on public.lead_no_reply_alerts (lead_id, anchor_created_at desc);

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

drop trigger if exists trg_sync_lead_no_reply_alerts on public.leads;
create trigger trg_sync_lead_no_reply_alerts
after insert or update of created_at, phone
on public.leads
for each row
execute function public.sync_lead_no_reply_alerts_from_lead();

create or replace function public.mark_lead_no_reply_alerts_replied_from_message()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_thread_phone text;
begin
  if new.direction <> 'inbound' or new.role <> 'human' then
    return new;
  end if;

  select phone_e164
  into v_thread_phone
  from public.wa_threads
  where id = new.thread_id;

  update public.lead_no_reply_alerts
  set
    status = 'skipped_replied',
    skipped_at = now(),
    updated_at = now(),
    last_error = 'Lead respondió por WhatsApp antes del aviso.'
  where clinic_id = new.clinic_id
    and status in ('pending', 'dispatched', 'error')
    and anchor_created_at <= new.created_at
    and (
      (new.lead_id is not null and lead_id = new.lead_id)
      or (v_thread_phone is not null and lead_phone = v_thread_phone)
    );

  return new;
end;
$$;

drop trigger if exists trg_mark_lead_no_reply_alerts_replied on public.wa_messages;
create trigger trg_mark_lead_no_reply_alerts_replied
after insert on public.wa_messages
for each row
execute function public.mark_lead_no_reply_alerts_replied_from_message();

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
        'lead_created_at', rec.anchor_created_at,
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

create or replace function public.finalize_dispatched_lead_no_reply_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  update public.lead_no_reply_alerts a
  set
    status = case
      when resp.status_code between 200 and 299 then 'sent'
      else 'error'
    end,
    sent_at = case
      when resp.status_code between 200 and 299 then now()
      else a.sent_at
    end,
    last_response_code = resp.status_code,
    last_error = coalesce(
      resp.error_msg,
      case when resp.status_code >= 400 then resp.content else null end
    ),
    updated_at = now()
  from net._http_response resp
  where a.status = 'dispatched'
    and a.request_id = resp.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'lead-no-reply-alerts-dispatch',
  'lead-no-reply-alerts-finalize'
);

select cron.schedule(
  'lead-no-reply-alerts-dispatch',
  '* * * * *',
  $$select public.dispatch_due_lead_no_reply_alerts(50);$$
);

select cron.schedule(
  'lead-no-reply-alerts-finalize',
  '* * * * *',
  $$select public.finalize_dispatched_lead_no_reply_alerts();$$
);


-- ============================================================
-- PASO 2. AÑADIR SOPORTE DE BACKFILL MANUAL
-- Ejecuta TODO este bloque una sola vez, después del paso 1.
-- Fuente original:
--   supabase/migrations/20260326_lead_no_reply_backfill.sql
-- ============================================================
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


-- ============================================================
-- PASO 3. VERIFICACIÓN RÁPIDA DE OBJETOS CREADOS
-- No muta datos. Sirve para comprobar que todo quedó listo.
-- ============================================================
select to_regclass('public.lead_no_reply_alerts') as tabla_alertas;

select proname
from pg_proc
where proname in (
  'sync_lead_no_reply_alerts_from_lead',
  'mark_lead_no_reply_alerts_replied_from_message',
  'dispatch_due_lead_no_reply_alerts',
  'finalize_dispatched_lead_no_reply_alerts',
  'rpc_backfill_existing_lead_no_reply_alerts'
)
order by proname;

select jobname
from cron.job
where jobname in (
  'lead-no-reply-alerts-dispatch',
  'lead-no-reply-alerts-finalize'
)
order by jobname;


-- ============================================================
-- PASO 4. PREVIEW DEL BACKFILL
-- No crea alertas. Solo enseña cuántos leads entrarían hoy.
-- Alcance: solo leads elegibles y con más de 3 horas desde created_at.
-- ============================================================
with snapshot as (
  select
    l.id,
    l.full_name,
    l.phone,
    l.source,
    l.created_at,
    l.stage_key,
    l.managed_by,
    l.whatsapp_blocked,
    l.has_scheduled_appointment,
    l.converted_to_client
  from public.leads l
  where l.clinic_id = '38bdef88-b4da-483d-a03b-6043e4707659'::uuid
    and coalesce(trim(l.phone), '') <> ''
    and l.created_at <= now() - interval '3 hours'
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
      where wm.clinic_id = '38bdef88-b4da-483d-a03b-6043e4707659'::uuid
        and wm.direction = 'inbound'
        and wm.role = 'human'
        and wm.created_at >= s.created_at
        and (
          wm.lead_id = s.id
          or (wt.phone_e164 is not null and wt.phone_e164 = s.phone)
          or coalesce(wm.metadata->>'from', '') = s.phone
        )
    )
)
select
  (select count(*) from snapshot) as leads_evaluados,
  (select count(*) from eligible) as leads_que_entran,
  (select count(*) from snapshot) - (select count(*) from eligible) as leads_descartados;

-- Muestra una muestra de leads que entrarían
with snapshot as (
  select
    l.id,
    l.full_name,
    l.phone,
    l.source,
    l.created_at,
    l.stage_key,
    l.managed_by,
    l.whatsapp_blocked,
    l.has_scheduled_appointment,
    l.converted_to_client
  from public.leads l
  where l.clinic_id = '38bdef88-b4da-483d-a03b-6043e4707659'::uuid
    and coalesce(trim(l.phone), '') <> ''
    and l.created_at <= now() - interval '3 hours'
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
      where wm.clinic_id = '38bdef88-b4da-483d-a03b-6043e4707659'::uuid
        and wm.direction = 'inbound'
        and wm.role = 'human'
        and wm.created_at >= s.created_at
        and (
          wm.lead_id = s.id
          or (wt.phone_e164 is not null and wt.phone_e164 = s.phone)
          or coalesce(wm.metadata->>'from', '') = s.phone
        )
    )
)
select id, full_name, phone, source, created_at, stage_key, managed_by
from eligible
order by created_at asc
limit 50;


-- ============================================================
-- PASO 5. LANZAR EL BACKFILL REAL
-- Esto SI crea las alertas para los leads actuales elegibles.
-- Programación elegida:
--   primer aviso equivalente al de 3h -> mañana 2026-03-27 a las 09:00 Europe/Madrid
-- ============================================================
select *
from public.rpc_backfill_existing_lead_no_reply_alerts(
  '38bdef88-b4da-483d-a03b-6043e4707659'::uuid,
  '2026-03-27T09:00:00+01:00'::timestamptz
);


-- ============================================================
-- PASO 6. COMPROBAR QUÉ SE HA CREADO
-- ============================================================
select
  origin,
  alert_key,
  status,
  count(*) as total
from public.lead_no_reply_alerts
where clinic_id = '38bdef88-b4da-483d-a03b-6043e4707659'::uuid
group by origin, alert_key, status
order by origin, alert_key, status;

select
  l.full_name,
  l.phone,
  a.origin,
  a.alert_key,
  a.status,
  a.anchor_created_at,
  a.send_at
from public.lead_no_reply_alerts a
join public.leads l on l.id = a.lead_id
where a.clinic_id = '38bdef88-b4da-483d-a03b-6043e4707659'::uuid
  and a.origin = 'backfill'
order by a.send_at asc, l.full_name asc
limit 200;


-- ============================================================
-- PASO 7. COMPROBAR EL DISPARO / RESPUESTA DEL WEBHOOK
-- Ejecuta esto mañana, después de las 09:00, para revisar qué pasó.
-- ============================================================
select
  alert_key,
  status,
  count(*) as total
from public.lead_no_reply_alerts
where clinic_id = '38bdef88-b4da-483d-a03b-6043e4707659'::uuid
  and origin = 'backfill'
group by alert_key, status
order by alert_key, status;

select
  id,
  alert_key,
  status,
  request_id,
  last_response_code,
  last_error,
  send_at,
  dispatched_at,
  sent_at,
  skipped_at
from public.lead_no_reply_alerts
where clinic_id = '38bdef88-b4da-483d-a03b-6043e4707659'::uuid
  and origin = 'backfill'
order by send_at asc, alert_key asc;
