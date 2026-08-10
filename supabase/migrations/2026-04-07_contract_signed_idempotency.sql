-- Migration: contract-signed idempotency hardening
-- Date: 2026-04-07
-- Description: Adds deterministic dedupe key support for outbox events and enforces one contract-signed notification per contract.

ALTER TABLE public.outbox_events
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_events_contract_signed_dedupe
  ON public.outbox_events (event_type, dedupe_key)
  WHERE event_type = 'contract_signed_notification' AND dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_events_event_type_dedupe_key
  ON public.outbox_events (event_type, dedupe_key);
