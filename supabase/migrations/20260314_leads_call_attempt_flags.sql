alter table public.leads
  add column if not exists first_call_answered boolean,
  add column if not exists second_call_answered boolean,
  add column if not exists whatsapp_handoff_needed boolean not null default false;

create index if not exists leads_whatsapp_handoff_needed_idx
  on public.leads (clinic_id, whatsapp_handoff_needed)
  where whatsapp_handoff_needed = true;

update public.leads
set first_call_answered = false
where stage_key = 'no_answer_first_call'
  and first_call_answered is null;

update public.leads
set
  first_call_answered = coalesce(first_call_answered, false),
  second_call_answered = false,
  whatsapp_handoff_needed = true
where stage_key in (
  'no_answer_second_call',
  'contacting_whatsapp',
  'whatsapp_conversation_active',
  'whatsapp_followup_pending',
  'whatsapp_failed_team_review'
);
