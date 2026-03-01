DO $$
BEGIN
  CREATE TYPE reminder_delivery_status AS ENUM ('no_enviado', 'enviado');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

alter table if exists appointments
  add column if not exists reminder_2d_status reminder_delivery_status not null default 'no_enviado',
  add column if not exists reminder_1d_status reminder_delivery_status not null default 'no_enviado',
  add column if not exists reminder_1h_status reminder_delivery_status not null default 'no_enviado';

update appointments
set
  reminder_2d_status = coalesce(reminder_2d_status, 'no_enviado'::reminder_delivery_status),
  reminder_1d_status = coalesce(reminder_1d_status, 'no_enviado'::reminder_delivery_status),
  reminder_1h_status = coalesce(reminder_1h_status, 'no_enviado'::reminder_delivery_status)
where
  reminder_2d_status is null
  or reminder_1d_status is null
  or reminder_1h_status is null;

drop function if exists claim_appointment_reminder(uuid, uuid, text, jsonb);
drop function if exists mark_appointment_reminder_sent(uuid, text);
drop function if exists mark_appointment_reminder_failed(uuid, text);

drop table if exists appointment_reminders cascade;
