alter table if exists public.customers
  add column if not exists in_app_notification_settings jsonb
  default '{"important_requests": true, "callbacks_and_tasks": true, "system": true}'::jsonb;
