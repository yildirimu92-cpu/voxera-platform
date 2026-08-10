-- Migration: Offer status model + send metadata upgrade
-- Date: 2026-04-11

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS email_subject text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'offers_status_check'
      AND conrelid = 'public.offers'::regclass
  ) THEN
    ALTER TABLE public.offers DROP CONSTRAINT offers_status_check;
  END IF;
END;
$$;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_status_check
  CHECK (status IN ('draft','sent','in_review','revision_requested','accepted','rejected','expired'));
