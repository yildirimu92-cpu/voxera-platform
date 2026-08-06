-- Migration: Unique constraint on contracts.offer_id to close the double-accept race window
-- Date: 2026-08-06
-- Preflight: run 2026-08-06_contract_offer_id_unique_idempotency_verification_queries.sql
--   section "1) PREFLIGHT" first. If it returns rows, merge/resolve the duplicate contracts
--   before running this migration -- otherwise it aborts with guidance below instead of a
--   bare 23505 unique_violation.

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT offer_id
    FROM public.contracts
    WHERE offer_id IS NOT NULL
    GROUP BY offer_id
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Aborting: % offer_id value(s) in public.contracts already have more than one contract row. Resolve duplicates first (see verification_queries.sql section 1) PREFLIGHT), then re-run this migration.',
      dup_count;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_offer_id
  ON public.contracts (offer_id)
  WHERE offer_id IS NOT NULL;
