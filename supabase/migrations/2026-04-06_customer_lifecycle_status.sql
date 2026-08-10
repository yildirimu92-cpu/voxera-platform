-- Migration: Customer lifecycle status canonicalization
-- Date: 2026-04-06
-- Description: Normalize public.customers.status to canonical lifecycle values

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'onboarding';

ALTER TABLE public.customers
  ALTER COLUMN status SET DEFAULT 'onboarding';

UPDATE public.customers
SET status = CASE lower(trim(coalesce(status, '')))
  WHEN 'aktiv' THEN 'live'
  WHEN 'active' THEN 'live'
  WHEN 'pending' THEN 'onboarding'
  WHEN 'onboarding' THEN 'onboarding'
  WHEN 'ready' THEN 'ready'
  WHEN 'invited' THEN 'invited'
  WHEN 'activated' THEN 'activated'
  WHEN 'live' THEN 'live'
  WHEN 'paused' THEN 'paused'
  WHEN 'deleted' THEN 'deleted'
  ELSE 'onboarding'
END;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_status_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_status_check
  CHECK (status IN ('onboarding', 'ready', 'invited', 'activated', 'live', 'paused', 'deleted'));
