-- Migration: Core status models canonicalization + constraints
-- Date: 2026-04-06
-- Scope: customers, onboarding, cases, calls

-- 1) customers.status add 'deleted'
ALTER TABLE public.customers
  ALTER COLUMN status SET DEFAULT 'onboarding';

UPDATE public.customers
SET status = CASE lower(trim(coalesce(status, '')))
  WHEN 'pending' THEN 'onboarding'
  WHEN 'active' THEN 'live'
  WHEN 'aktiv' THEN 'live'
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

-- 2) customers.invite_status canonicalize to access lifecycle values
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS invite_status text DEFAULT 'not_sent';

ALTER TABLE public.customers
  ALTER COLUMN invite_status SET DEFAULT 'not_sent';

UPDATE public.customers
SET invite_status = CASE lower(trim(coalesce(invite_status, '')))
  WHEN 'not_sent' THEN 'not_sent'
  WHEN 'pending' THEN 'not_sent'
  WHEN 'none' THEN 'not_sent'
  WHEN 'sent' THEN 'sent'
  WHEN 'invited' THEN 'sent'
  WHEN 'activated' THEN 'activated'
  ELSE 'not_sent'
END;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_invite_status_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_invite_status_check
  CHECK (invite_status IN ('not_sent', 'sent', 'activated'));

-- 3) onboarding.status canonicalization
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'onboarding'
  ) THEN
    UPDATE public.onboarding
    SET status = CASE lower(trim(coalesce(status, '')))
      WHEN 'not_started' THEN 'not_started'
      WHEN 'not started' THEN 'not_started'
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'in progress' THEN 'in_progress'
      WHEN 'blocked' THEN 'blocked'
      WHEN 'ready' THEN 'ready'
      WHEN 'completed' THEN 'completed'
      ELSE 'not_started'
    END;

    ALTER TABLE public.onboarding
      ALTER COLUMN status SET DEFAULT 'not_started';

    ALTER TABLE public.onboarding
      DROP CONSTRAINT IF EXISTS onboarding_status_check;

    ALTER TABLE public.onboarding
      ADD CONSTRAINT onboarding_status_check
      CHECK (status IN ('not_started', 'in_progress', 'blocked', 'ready', 'completed'));
  END IF;
END
$$;

-- 4) cases.status canonicalization
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cases'
  ) THEN
    UPDATE public.cases
    SET status = CASE lower(trim(coalesce(status, '')))
      WHEN 'open' THEN 'open'
      WHEN 'offen' THEN 'open'
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'in progress' THEN 'in_progress'
      WHEN 'in bearbeitung' THEN 'in_progress'
      WHEN 'waiting' THEN 'waiting'
      WHEN 'wartend' THEN 'waiting'
      WHEN 'done' THEN 'done'
      WHEN 'closed' THEN 'done'
      WHEN 'geschlossen' THEN 'done'
      ELSE 'open'
    END;

    ALTER TABLE public.cases
      ALTER COLUMN status SET DEFAULT 'open';

    ALTER TABLE public.cases
      DROP CONSTRAINT IF EXISTS cases_status_check;

    ALTER TABLE public.cases
      ADD CONSTRAINT cases_status_check
      CHECK (status IN ('open', 'in_progress', 'waiting', 'done'));
  END IF;
END
$$;

-- 5) calls.dashboard_status canonicalization
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'dashboard_status'
  ) THEN
    UPDATE public.calls
    SET dashboard_status = CASE lower(trim(coalesce(dashboard_status, '')))
      WHEN 'new' THEN 'new'
      WHEN 'neu' THEN 'new'
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'in bearbeitung' THEN 'in_progress'
      WHEN 'follow_up_scheduled' THEN 'follow_up_scheduled'
      WHEN 'follow-up geplant' THEN 'follow_up_scheduled'
      WHEN 'done' THEN 'closed'
      WHEN 'closed' THEN 'closed'
      WHEN 'abgeschlossen' THEN 'closed'
      WHEN 'erledigt' THEN 'closed'
      ELSE 'new'
    END;

    ALTER TABLE public.calls
      ALTER COLUMN dashboard_status SET DEFAULT 'new';

    ALTER TABLE public.calls
      DROP CONSTRAINT IF EXISTS calls_dashboard_status_check;

    ALTER TABLE public.calls
      ADD CONSTRAINT calls_dashboard_status_check
      CHECK (dashboard_status IN ('new', 'in_progress', 'follow_up_scheduled', 'closed'));
  END IF;
END
$$;
