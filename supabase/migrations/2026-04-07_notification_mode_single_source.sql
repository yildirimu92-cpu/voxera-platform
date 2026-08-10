-- Migration: 2026-04-07_notification_mode_single_source.sql
-- Goal: make customers.notification_mode the canonical notification setting.
-- Notes:
--   * Backfills notification_mode from legacy booleans for existing records.
--   * Keeps legacy columns for compatibility, but sets a deterministic baseline.

BEGIN;

UPDATE public.customers
SET notification_mode = CASE
  WHEN new_log_email_active IS TRUE THEN 'all_calls'
  WHEN notification_active IS TRUE OR missed_call_email_active IS TRUE THEN 'callback_only'
  ELSE 'none'
END
WHERE notification_mode IS NULL
   OR notification_mode NOT IN ('none', 'callback_only', 'all_calls');

UPDATE public.customers
SET
  notification_active = CASE WHEN notification_mode IN ('callback_only', 'all_calls') THEN TRUE ELSE FALSE END,
  new_log_email_active = CASE WHEN notification_mode = 'all_calls' THEN TRUE ELSE FALSE END,
  missed_call_email_active = CASE WHEN notification_mode IN ('callback_only', 'all_calls') THEN TRUE ELSE FALSE END
WHERE notification_mode IN ('none', 'callback_only', 'all_calls');

ALTER TABLE public.customers
  ALTER COLUMN notification_mode SET DEFAULT 'none';

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_notification_mode_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_notification_mode_check
  CHECK (notification_mode IN ('none', 'callback_only', 'all_calls'));

COMMIT;
