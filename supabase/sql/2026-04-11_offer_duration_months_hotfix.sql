-- Hotfix: restore missing offers.duration_months column expected by admin + acceptance flows
-- Date: 2026-04-11

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS duration_months integer;

UPDATE public.offers
SET duration_months = 12
WHERE duration_months IS NULL OR duration_months < 1;

ALTER TABLE public.offers
  ALTER COLUMN duration_months SET DEFAULT 12,
  ALTER COLUMN duration_months SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'offers_duration_months_check'
      AND conrelid = 'public.offers'::regclass
  ) THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT offers_duration_months_check CHECK (duration_months >= 1);
  END IF;
END;
$$;
