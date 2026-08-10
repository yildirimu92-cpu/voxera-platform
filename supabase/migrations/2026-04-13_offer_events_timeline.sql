-- Migration: Offer events timeline + tracking fields
-- Date: 2026-04-13

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

CREATE TABLE IF NOT EXISTS public.offer_events (
  id bigserial PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  actor_type text,
  actor_id text,
  recipient_email text,
  subject text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_events_event_type_check CHECK (event_type IN ('created','saved','sent','resend','send_failed','opened','accepted','declined','expired'))
);

CREATE INDEX IF NOT EXISTS idx_offer_events_offer_event_at ON public.offer_events(offer_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_events_event_type ON public.offer_events(event_type);
