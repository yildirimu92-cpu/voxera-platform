-- Verification queries for 2026-08-06_invoice_items_title_tax_rate_drift_fix.sql
-- Run manually in SQL editor/CI. Section 1 is a PREFLIGHT check -- run and clear it
-- BEFORE applying the migration. Sections 2-5 are POST-MIGRATION checks.

-- 1) PREFLIGHT: confirm the live table actually matches the drifted shape this migration
--    assumes (no title column, tax_rate present and NOT NULL with no default). If this
--    doesn't match -- e.g. title already exists, or tax_rate is gone -- STOP and re-diagnose
--    before applying; the migration's DO block will also abort if tax_rate is missing, but
--    everything else here is a silent no-op (ADD COLUMN IF NOT EXISTS / SET DEFAULT are both
--    idempotent), so it will not warn you about an already-fixed or differently-shaped table.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'invoice_items'
ORDER BY ordinal_position;

-- 1b) PREFLIGHT: row count, for context on backfill scope (title will be NULL on all
--     existing rows after this migration -- there is nothing to backfill it from).
SELECT count(*) AS invoice_items_row_count FROM public.invoice_items;

-- 2) POST-MIGRATION: confirm title exists and is nullable text.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'title';

-- 3) POST-MIGRATION: confirm tax_rate now has a default of 0, and is still NOT NULL.
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'tax_rate';

-- 4) POST-MIGRATION: an insert shaped exactly like the application's write path
--    (title + description supplied, tax_rate omitted) must now succeed. Run inside a
--    transaction and roll back -- this is a smoke test, not meant to leave data behind.
BEGIN;
  INSERT INTO public.invoices (id, invoice_number, customer_id, invoice_type, billing_provider, status)
  VALUES (gen_random_uuid(), 'VERIFY-TMP-0001', (SELECT id FROM public.customers LIMIT 1), 'manual', 'invoice', 'draft')
  RETURNING id \gset verify_
  INSERT INTO public.invoice_items (invoice_id, sort_order, item_type, title, description, quantity, unit_price, line_total, metadata)
  VALUES (:'verify_id', 1, 'manual', 'Verification Item', 'Smoke test row from post-migration verification', 1, 0, 0, '{}'::jsonb);
  SELECT tax_rate FROM public.invoice_items WHERE invoice_id = :'verify_id';
ROLLBACK;

-- 5) POST-MIGRATION: existing rows are still intact (row count unchanged from 1b, title is
--    NULL on all pre-existing rows since there is no source data to backfill it from).
SELECT count(*) AS invoice_items_row_count, count(title) AS rows_with_title
FROM public.invoice_items;
