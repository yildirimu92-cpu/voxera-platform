-- Migration: public customer offer acceptance (tokenized)
-- Date: 2026-04-11

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS public_token text,
  ADD COLUMN IF NOT EXISTS public_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by_name text,
  ADD COLUMN IF NOT EXISTS accepted_by_email text,
  ADD COLUMN IF NOT EXISTS accepted_ip text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_offers_public_token
  ON public.offers(public_token)
  WHERE public_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offers_public_token_expires
  ON public.offers(public_token, public_expires_at);
