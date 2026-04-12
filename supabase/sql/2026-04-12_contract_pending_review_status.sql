-- Migration: Ensure contracts support pending_review workflow stage
-- Date: 2026-04-12

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contracts_status_check'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts DROP CONSTRAINT contracts_status_check;
  END IF;
END $$;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('draft', 'pending_review', 'pending', 'active', 'signed', 'expired', 'cancelled'));
