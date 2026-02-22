-- Lead journey and multi-pipeline support for AI calls + WhatsApp escalation.

alter table if exists leads
  add column if not exists stage_key text,
  add column if not exists ab_variant text check (ab_variant in ('A', 'B')),
  add column if not exists last_contact_at timestamptz,
  add column if not exists next_action_at timestamptz;

alter table if exists calls
  add column if not exists attempt_no int not null default 1;

alter table if exists appointments
  add column if not exists source_channel text not null default 'staff';

create table if not exists lead_stage_catalog (
  stage_key text primary key,
  pipeline_key text not null,
  pipeline_label_es text not null,
  label_es text not null,
  description_es text,
  pipeline_order int not null default 1,
  order_index int not null,
  is_terminal boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

insert into lead_stage_catalog (
  stage_key,
  pipeline_key,
  pipeline_label_es,
  label_es,
  description_es,
  pipeline_order,
  order_index,
  is_terminal,
  is_active
)
values
  ('new_lead', 'calls_ai', 'Agentes de Llamada', 'Nuevo lead', 'Lead recién entrado desde Meta', 1, 10, false, true),
  ('first_call_in_progress', 'calls_ai', 'Agentes de Llamada', 'Primera llamada en curso', 'Retell AI realizando primera llamada outbound', 1, 20, false, true),
  ('no_answer_first_call', 'calls_ai', 'Agentes de Llamada', 'No contesta primera llamada', 'Sin respuesta en el primer intento', 1, 30, false, true),
  ('second_call_scheduled', 'calls_ai', 'Agentes de Llamada', 'Segunda llamada programada', 'Reintento pendiente en otra franja horaria', 1, 40, false, true),
  ('second_call_in_progress', 'calls_ai', 'Agentes de Llamada', 'Segunda llamada en curso', 'Retell AI realizando segundo intento', 1, 50, false, true),
  ('no_answer_second_call', 'calls_ai', 'Agentes de Llamada', 'No contesta segunda llamada', 'Escalado a canal WhatsApp', 1, 60, false, true),
  ('contacting_whatsapp', 'whatsapp_ai', 'Agentes de WhatsApp', 'Contactando por WhatsApp', 'Primer mensaje de WhatsApp enviado por el agente', 2, 10, false, true),
  ('whatsapp_conversation_active', 'whatsapp_ai', 'Agentes de WhatsApp', 'Conversación activa', 'Intercambio activo para detectar dolor y cerrar cita', 2, 20, false, true),
  ('whatsapp_followup_pending', 'whatsapp_ai', 'Agentes de WhatsApp', 'Seguimiento pendiente', 'Quedó pendiente respuesta del lead por WhatsApp', 2, 30, false, true),
  ('whatsapp_failed_team_review', 'whatsapp_ai', 'Agentes de WhatsApp', 'Revisión manual equipo', 'No se cerró por IA; se envía resumen al equipo', 2, 40, false, true),
  ('visit_scheduled', 'closed', 'Cerrados', 'Agendado', 'Cita confirmada en agenda', 3, 10, true, true),
  ('not_interested', 'closed', 'Cerrados', 'No interesado', 'Lead rechazó continuar', 3, 20, true, true),
  ('discarded', 'closed', 'Cerrados', 'Descartado', 'Lead descartado por criterio interno', 3, 30, true, true)
on conflict (stage_key) do update
set
  pipeline_key = excluded.pipeline_key,
  pipeline_label_es = excluded.pipeline_label_es,
  label_es = excluded.label_es,
  description_es = excluded.description_es,
  pipeline_order = excluded.pipeline_order,
  order_index = excluded.order_index,
  is_terminal = excluded.is_terminal,
  is_active = excluded.is_active;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_stage_key_fkey'
  ) then
    alter table leads
      add constraint leads_stage_key_fkey
      foreign key (stage_key) references lead_stage_catalog(stage_key);
  end if;
end $$;

update leads
set stage_key = case status
  when 'new' then 'new_lead'
  when 'whatsapp_sent' then 'contacting_whatsapp'
  when 'call_done' then 'first_call_in_progress'
  when 'contacted' then 'whatsapp_conversation_active'
  when 'visit_scheduled' then 'visit_scheduled'
  when 'no_response' then 'no_answer_second_call'
  when 'not_interested' then 'not_interested'
  else 'new_lead'
end
where stage_key is null;

alter table leads alter column stage_key set default 'new_lead';
update leads set stage_key = 'new_lead' where stage_key is null;
alter table leads alter column stage_key set not null;

create index if not exists leads_stage_key_idx on leads (stage_key);

create table if not exists lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  from_stage_key text references lead_stage_catalog(stage_key) on delete set null,
  to_stage_key text not null references lead_stage_catalog(stage_key),
  reason text,
  actor_type text not null default 'system',
  actor_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists lead_stage_history_lead_idx on lead_stage_history (lead_id, created_at desc);
create index if not exists lead_stage_history_stage_idx on lead_stage_history (clinic_id, to_stage_key, created_at desc);

create table if not exists lead_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null,
  attempt_no int not null default 1,
  status text not null default 'started',
  retell_call_id text,
  wa_message_id text,
  started_at timestamptz,
  ended_at timestamptz,
  outcome text,
  summary text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  check (channel in ('call_ai', 'whatsapp_ai', 'staff')),
  check (attempt_no > 0)
);

create unique index if not exists lead_contact_attempts_retell_uidx on lead_contact_attempts (clinic_id, retell_call_id);
create index if not exists lead_contact_attempts_lead_idx on lead_contact_attempts (lead_id, channel, created_at desc);

create table if not exists lead_next_actions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  action_type text not null,
  due_at timestamptz not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  processed_at timestamptz,
  created_at timestamptz default now(),
  check (action_type in ('retry_call', 'start_whatsapp_ai', 'notify_team')),
  check (status in ('pending', 'running', 'done', 'canceled', 'failed'))
);

create unique index if not exists lead_next_actions_idempotency_uidx on lead_next_actions (clinic_id, idempotency_key);
create index if not exists lead_next_actions_due_idx on lead_next_actions (clinic_id, status, due_at);

create table if not exists wa_threads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  phone_e164 text not null,
  state text not null default 'awaiting_reply',
  last_outbound_message_id uuid,
  hitl_active boolean not null default false,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (clinic_id, phone_e164)
);

create index if not exists wa_threads_lead_idx on wa_threads (lead_id, updated_at desc);

create table if not exists wa_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references wa_threads(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  provider_message_id text,
  direction text not null,
  role text not null,
  text text not null,
  intent text,
  ab_variant text check (ab_variant in ('A', 'B')),
  delivery_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  check (direction in ('inbound', 'outbound')),
  check (role in ('human', 'assistant', 'system'))
);

create unique index if not exists wa_messages_provider_uidx on wa_messages (clinic_id, provider_message_id);
create index if not exists wa_messages_thread_idx on wa_messages (thread_id, created_at desc);

alter table wa_threads
  drop constraint if exists wa_threads_last_outbound_fkey;

alter table wa_threads
  add constraint wa_threads_last_outbound_fkey
  foreign key (last_outbound_message_id) references wa_messages(id) on delete set null;

create table if not exists webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id) on delete cascade,
  source text not null,
  external_event_id text not null,
  payload_hash text,
  processed_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (source, external_event_id)
);

create index if not exists webhook_receipts_clinic_idx on webhook_receipts (clinic_id, processed_at desc);

create or replace function public.legacy_status_from_stage(p_stage_key text)
returns lead_status
language sql
stable
security definer
set search_path = public
as $$
  select case p_stage_key
    when 'new_lead' then 'new'::lead_status
    when 'first_call_in_progress' then 'call_done'::lead_status
    when 'no_answer_first_call' then 'no_response'::lead_status
    when 'second_call_scheduled' then 'no_response'::lead_status
    when 'second_call_in_progress' then 'no_response'::lead_status
    when 'no_answer_second_call' then 'no_response'::lead_status
    when 'contacting_whatsapp' then 'whatsapp_sent'::lead_status
    when 'whatsapp_conversation_active' then 'contacted'::lead_status
    when 'whatsapp_followup_pending' then 'whatsapp_sent'::lead_status
    when 'whatsapp_failed_team_review' then 'no_response'::lead_status
    when 'visit_scheduled' then 'visit_scheduled'::lead_status
    when 'not_interested' then 'not_interested'::lead_status
    when 'discarded' then 'not_interested'::lead_status
    else 'call_done'::lead_status
  end;
$$;

create or replace function public.rpc_transition_lead_stage(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_to_stage_key text,
  p_reason text default null,
  p_actor_type text default 'system',
  p_actor_id text default null,
  p_meta jsonb default '{}'::jsonb
)
returns table (
  ok boolean,
  lead_id uuid,
  from_stage_key text,
  to_stage_key text,
  status lead_status,
  error text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead leads%rowtype;
  v_from_stage text;
  v_to_stage text := coalesce(nullif(trim(p_to_stage_key), ''), '');
  v_status lead_status;
begin
  if auth.uid() is not null and p_clinic_id <> current_clinic_id() then
    raise exception 'Not allowed for this clinic';
  end if;

  if p_clinic_id is null or p_lead_id is null or v_to_stage = '' then
    return query select false, p_lead_id, null::text, p_to_stage_key, null::lead_status, 'clinic_id, lead_id and to_stage_key are required';
    return;
  end if;

  if not exists (
    select 1
    from lead_stage_catalog
    where stage_key = v_to_stage
      and is_active = true
  ) then
    return query select false, p_lead_id, null::text, v_to_stage, null::lead_status, 'invalid or inactive stage_key';
    return;
  end if;

  select *
  into v_lead
  from leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
  for update;

  if not found then
    return query select false, p_lead_id, null::text, v_to_stage, null::lead_status, 'lead not found';
    return;
  end if;

  v_from_stage := coalesce(v_lead.stage_key, 'new_lead');
  v_status := legacy_status_from_stage(v_to_stage);

  if v_from_stage = v_to_stage then
    return query select true, v_lead.id, v_from_stage, v_to_stage, v_status, null::text;
    return;
  end if;

  update leads
  set stage_key = v_to_stage,
      status = v_status,
      updated_at = now(),
      next_action_at = coalesce((p_meta->>'next_action_at')::timestamptz, next_action_at)
  where id = v_lead.id;

  insert into lead_stage_history (
    clinic_id,
    lead_id,
    from_stage_key,
    to_stage_key,
    reason,
    actor_type,
    actor_id,
    meta
  )
  values (
    p_clinic_id,
    p_lead_id,
    v_from_stage,
    v_to_stage,
    p_reason,
    coalesce(nullif(trim(p_actor_type), ''), 'system'),
    nullif(trim(p_actor_id), ''),
    coalesce(p_meta, '{}'::jsonb)
  );

  insert into audit_log (
    clinic_id,
    entity_type,
    entity_id,
    action,
    meta
  )
  values (
    p_clinic_id,
    'lead',
    p_lead_id::text,
    'stage_changed',
    jsonb_build_object(
      'from_stage', v_from_stage,
      'to_stage', v_to_stage,
      'legacy_status', v_status,
      'reason', p_reason,
      'actor_type', coalesce(nullif(trim(p_actor_type), ''), 'system'),
      'actor_id', nullif(trim(p_actor_id), '')
    ) || coalesce(p_meta, '{}'::jsonb)
  );

  return query select true, v_lead.id, v_from_stage, v_to_stage, v_status, null::text;
end;
$$;

alter table lead_stage_catalog enable row level security;
alter table lead_stage_history enable row level security;
alter table lead_contact_attempts enable row level security;
alter table lead_next_actions enable row level security;
alter table wa_threads enable row level security;
alter table wa_messages enable row level security;
alter table webhook_receipts enable row level security;

create policy "Stage catalog select" on lead_stage_catalog
  for select using (true);

create policy "Stage catalog admin write" on lead_stage_catalog
  for all using (is_admin()) with check (is_admin());

create policy "Lead stage history select" on lead_stage_history
  for select using (clinic_id = current_clinic_id());

create policy "Lead stage history insert" on lead_stage_history
  for insert with check (clinic_id = current_clinic_id());

create policy "Contact attempts select" on lead_contact_attempts
  for select using (clinic_id = current_clinic_id());

create policy "Contact attempts insert" on lead_contact_attempts
  for insert with check (clinic_id = current_clinic_id());

create policy "Contact attempts update" on lead_contact_attempts
  for update using (clinic_id = current_clinic_id());

create policy "Next actions select" on lead_next_actions
  for select using (clinic_id = current_clinic_id());

create policy "Next actions insert" on lead_next_actions
  for insert with check (clinic_id = current_clinic_id());

create policy "Next actions update" on lead_next_actions
  for update using (clinic_id = current_clinic_id());

create policy "WA threads select" on wa_threads
  for select using (clinic_id = current_clinic_id());

create policy "WA threads insert" on wa_threads
  for insert with check (clinic_id = current_clinic_id());

create policy "WA threads update" on wa_threads
  for update using (clinic_id = current_clinic_id());

create policy "WA messages select" on wa_messages
  for select using (clinic_id = current_clinic_id());

create policy "WA messages insert" on wa_messages
  for insert with check (clinic_id = current_clinic_id());

create policy "WA messages update" on wa_messages
  for update using (clinic_id = current_clinic_id());

create policy "Webhook receipts select" on webhook_receipts
  for select using (clinic_id = current_clinic_id());

create policy "Webhook receipts insert" on webhook_receipts
  for insert with check (clinic_id = current_clinic_id());

create policy "Webhook receipts update" on webhook_receipts
  for update using (clinic_id = current_clinic_id());

grant execute on function public.legacy_status_from_stage(text) to authenticated, service_role;
grant execute on function public.rpc_transition_lead_stage(uuid, uuid, text, text, text, text, jsonb) to authenticated, service_role;

alter publication supabase_realtime add table lead_stage_history;
alter publication supabase_realtime add table lead_contact_attempts;
alter publication supabase_realtime add table lead_next_actions;
alter publication supabase_realtime add table wa_threads;
alter publication supabase_realtime add table wa_messages;
