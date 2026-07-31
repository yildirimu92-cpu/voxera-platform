-- Migration: Mail dispatch idempotency
-- Date: 2026-07-31
-- Prevents duplicate Make webhook executions when the same UI request is retried
-- because of a timeout, browser retry, or repeated network submission.

ALTER TABLE public.outbox_events
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_events_mail_dispatch_dedupe
  ON public.outbox_events (event_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND event_type IN (
      'offer_email',
      'subscription_payment_email',
      'setup_fee_email',
      'invoice_email',
      'reminder_email',
      'reminder_final_email'
    );
