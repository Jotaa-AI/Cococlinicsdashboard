-- Track Cal.com bookings created for manual busy blocks.

alter table if exists busy_blocks
  add column if not exists cal_block_group_id text,
  add column if not exists cal_booking_uids jsonb;

create index if not exists busy_blocks_cal_block_group_idx
  on busy_blocks (clinic_id, cal_block_group_id);
