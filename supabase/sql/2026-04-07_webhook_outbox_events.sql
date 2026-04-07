-- Migration: Webhook Outbox Events (launch hardening)
-- Date: 2026-04-07
-- Description: Persist webhook-dependent events to prevent silent operational loss.

CREATE TABLE IF NOT EXISTS public.outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,
  payload         jsonb,
  payload_summary text,
  status          text NOT NULL DEFAULT 'pending',
  retry_count     integer NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_status_created_at
  ON public.outbox_events (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbox_events_event_type_created_at
  ON public.outbox_events (event_type, created_at DESC);
