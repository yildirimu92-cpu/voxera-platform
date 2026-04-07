-- Migration: Outbox Retry Worker Support
-- Date: 2026-04-07
-- Description: Adds small schema additions for retry scheduling and terminal dead-letter state.

ALTER TABLE public.outbox_events
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_outbox_events_retry_scan
  ON public.outbox_events (status, retry_count, last_attempt_at, created_at);
