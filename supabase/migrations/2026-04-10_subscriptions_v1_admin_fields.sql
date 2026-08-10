-- Migration: Subscriptions V1 admin fields + constraints
-- Date: 2026-04-10
-- Purpose: Ensure minimal subscription fields for lifecycle + admin visibility

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_code text,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS renews_at timestamptz;

-- Backfill from legacy columns where possible
UPDATE public.subscriptions
SET
  plan_code = COALESCE(NULLIF(plan_code, ''), plan),
  subscription_status = COALESCE(
    NULLIF(subscription_status, ''),
    CASE
      WHEN status = 'active' THEN 'active'
      WHEN status = 'paused' THEN 'inactive'
      ELSE 'inactive'
    END
  ),
  starts_at = COALESCE(starts_at, (start_date::timestamptz))
WHERE
  plan_code IS NULL
  OR subscription_status IS NULL
  OR starts_at IS NULL;

-- Enforce allowed values for V1 lifecycle
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_billing_cycle_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'yearly'));

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_subscription_status_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_subscription_status_check
  CHECK (subscription_status IN ('inactive', 'active', 'cancelled'));

ALTER TABLE public.subscriptions
  ALTER COLUMN plan_code SET NOT NULL,
  ALTER COLUMN subscription_status SET NOT NULL,
  ALTER COLUMN subscription_status SET DEFAULT 'inactive';
