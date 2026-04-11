-- Migration: subscription billing runner state fields
-- Date: 2026-04-10

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS billing_state text,
  ADD COLUMN IF NOT EXISTS next_reminder_at timestamptz;

UPDATE public.subscriptions
SET payment_status = CASE lower(trim(coalesce(payment_status, '')))
  WHEN 'pending' THEN 'pending'
  WHEN 'paid' THEN 'paid'
  ELSE 'none'
END
WHERE payment_status IS NULL
  OR lower(trim(coalesce(payment_status, ''))) NOT IN ('none', 'pending', 'paid');

ALTER TABLE public.subscriptions
  ALTER COLUMN payment_status SET DEFAULT 'none';

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_payment_status_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_payment_status_check
  CHECK (payment_status IN ('none', 'pending', 'paid'));
