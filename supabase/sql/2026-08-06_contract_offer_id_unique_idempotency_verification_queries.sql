-- Verification queries for 2026-08-06_contract_offer_id_unique_idempotency.sql
-- Run manually in SQL editor/CI. Section 1 is a PREFLIGHT check -- run and clear it
-- BEFORE applying the migration. Sections 2-3 are POST-MIGRATION checks.

-- 1) PREFLIGHT: offer_id values with more than one contract row.
--    Must return zero rows before the migration can succeed.
SELECT offer_id, count(*) AS contract_count, array_agg(id ORDER BY created_at) AS contract_ids
FROM public.contracts
WHERE offer_id IS NOT NULL
GROUP BY offer_id
HAVING count(*) > 1;

-- 2) POST-MIGRATION: confirm the unique index exists.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'contracts'
  AND indexname = 'uq_contracts_offer_id';

-- 3) POST-MIGRATION: re-run the duplicate check; should still be zero rows
--    (defends against a concurrent insert landing between preflight and migration).
SELECT offer_id, count(*) AS contract_count
FROM public.contracts
WHERE offer_id IS NOT NULL
GROUP BY offer_id
HAVING count(*) > 1;
