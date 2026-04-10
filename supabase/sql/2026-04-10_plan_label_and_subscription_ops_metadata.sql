-- Migration: plan_label support + minimal subscription ops metadata
-- Date: 2026-04-10

ALTER TABLE public.plan_config
  ADD COLUMN IF NOT EXISTS plan_label text;

UPDATE public.plan_config
SET plan_label = COALESCE(NULLIF(plan_label, ''), NULLIF(name, ''), id)
WHERE plan_label IS NULL OR plan_label = '';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_billing_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_billing_link text;
