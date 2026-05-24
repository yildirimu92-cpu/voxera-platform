-- Add canonical notification target fields without destructive schema changes.
alter table if exists public.notifications
  add column if not exists target_type text;

alter table if exists public.notifications
  add column if not exists target_id text;

create index if not exists idx_notifications_customer_target
  on public.notifications (customer_id, target_type, target_id)
  where target_id is not null;
