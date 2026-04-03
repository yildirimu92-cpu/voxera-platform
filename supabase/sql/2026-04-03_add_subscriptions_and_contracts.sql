-- Migration: SaaS Activation Workflow
-- Date: 2026-04-03
-- Description: Add subscriptions and contracts tables; extend customers table

-- ─── subscriptions ────────────────────────────────────────────────────────────
-- NOTE: customer_id is UNIQUE for PR 1 (one active subscription per customer).
-- Future PRs can add an end_date column and query active subscriptions by
-- filtering on status = 'active' AND (end_date IS NULL OR end_date > now()),
-- which allows subscription history without changing the schema fundamentally.
-- At that point the UNIQUE constraint on customer_id should be dropped.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    text        NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,
  plan           text        NOT NULL,
  billing_cycle  text        NOT NULL,
  price_monthly  decimal,
  price_yearly   decimal,
  start_date     date        NOT NULL,
  -- allowed values: 'active', 'paused'
  status         text        NOT NULL DEFAULT 'active',
  created_at     timestamp   DEFAULT now(),
  updated_at     timestamp   DEFAULT now()
);

-- ─── contracts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contracts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      text        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  subscription_id  uuid        REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  start_date       date        NOT NULL,
  duration_months  int,
  -- allowed values: 'draft', 'active', 'expired'
  status           text        NOT NULL DEFAULT 'draft',
  file_url         text,
  created_at       timestamp   DEFAULT now()
);

-- ─── extend customers ─────────────────────────────────────────────────────────
-- allowed values: 'pending', 'active'
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS status          text    DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS subscription_id uuid    REFERENCES public.subscriptions(id),
  ADD COLUMN IF NOT EXISTS activated_at    timestamp;
