-- Verification queries for 2026-08-06_offer_acceptance_idempotency_lock.sql
-- Run manually in SQL editor/CI. Section 1 is a PREFLIGHT check -- run and clear it
-- BEFORE applying the migration. Sections 2-4 are POST-MIGRATION checks.

-- 1) PREFLIGHT: any status values currently on public.offers that would NOT be covered
--    by the new (superset) constraint. Must return zero rows -- if it doesn't, the
--    widened list below needs to include whatever unexpected value shows up here
--    before the migration is applied.
SELECT DISTINCT status
FROM public.offers
WHERE status NOT IN (
  'draft', 'sent', 'in_review', 'revision_requested', 'viewed', 'declined', 'active',
  'accepted', 'rejected', 'expired', 'contract_failed'
);

-- 2) POST-MIGRATION: confirm the new constraint definition.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'offers_status_check'
  AND conrelid = 'public.offers'::regclass;

-- 3) POST-MIGRATION: confirm accept_claim_key column exists and is nullable text.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'accept_claim_key';

-- 4) POST-MIGRATION: offers stuck in 'contract_failed' -- operational follow-up list,
--    useful right after deploy and going forward as a manual health check.
SELECT id, offer_number, customer_id, accepted_at, updated_at
FROM public.offers
WHERE status = 'contract_failed'
ORDER BY updated_at DESC;
