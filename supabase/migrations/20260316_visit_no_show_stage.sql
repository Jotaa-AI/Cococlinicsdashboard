insert into public.lead_stage_catalog (
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
values (
  'visit_no_show',
  'closed',
  'Cerrados',
  'No asistió a cita',
  'Lead con cita agendada que no acudió',
  3,
  35,
  false,
  true
)
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
    when 'post_visit_pending_decision' then 'contacted'::lead_status
    when 'post_visit_follow_up' then 'contacted'::lead_status
    when 'visit_no_show' then 'contacted'::lead_status
    when 'post_visit_not_closed' then 'not_interested'::lead_status
    when 'client_closed' then 'visit_scheduled'::lead_status
    when 'not_interested' then 'not_interested'::lead_status
    when 'discarded' then 'not_interested'::lead_status
    else 'call_done'::lead_status
  end;
$$;
