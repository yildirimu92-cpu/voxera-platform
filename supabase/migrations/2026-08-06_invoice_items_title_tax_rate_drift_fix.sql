-- Migration: Fix invoice_items schema drift (title, tax_rate) blocking every invoice-item insert
-- Date: 2026-08-06
--
-- Diagnosis (see conversation, no ticket on file): the live public.invoice_items table does
-- NOT match the only tracked migration that created it (2026-04-11_invoice_system_v1.sql,
-- which defines item_type/title NOT NULL, description nullable, no tax_rate). The live table
-- was confirmed (information_schema query against production) to instead have:
--   - no title column at all
--   - description text NOT NULL
--   - tax_rate <numeric> NOT NULL, no default
--   - item_type nullable
-- No file in supabase/migrations or supabase/sql alters invoice_items into that shape, so it
-- was applied out-of-band (manual SQL editor / dashboard) and never committed back. This
-- migration does not attempt to reverse-engineer *why* -- it only unblocks the app, which is
-- entirely and consistently built around `title` as the primary line-item label (9+ write
-- sites across admin-panel/netlify/functions, plus the Swiss QR-bill PDF renderer reads
-- item.title as the primary printed line) and never references `tax_rate` anywhere in the
-- codebase.
--
-- Fixes applied:
--   1. Re-add invoice_items.title (text, nullable -- existing live rows have no value to
--      backfill from; every reachable code path supplies it going forward, see
--      _lib/invoice-service.js createInvoiceWithItems/ensureDraftInvoiceWithItems and the
--      direct-insert sites in daily-billing-runner.js, customer-billing-update.js,
--      admin-overage-invoice.js). Not NOT NULL: unlike the original v1 migration, this table
--      already has rows in production and an unconditional NOT NULL would fail immediately
--      without a backfill value that doesn't exist for historical rows.
--   2. Give invoice_items.tax_rate a DEFAULT of 0. No code path in this repo has ever
--      populated a per-line tax rate (grep for `tax_rate` across the whole repo returns
--      nothing besides this migration), so every current insert omits it -- with the column
--      NOT NULL and no default, that fails outright. Defaulting to 0 is not a functional
--      change (nothing reads or bills based on it today); it only lets existing inserts
--      succeed again. The NOT NULL constraint itself is left in place.
--
-- item_type's live nullability (documented as a drift in the diagnosis above) is
-- intentionally NOT touched here: every current write site already supplies item_type
-- explicitly, so it is not blocking anything, and re-tightening it is out of scope for this
-- fix.
--
-- Preflight: run 2026-08-06_invoice_items_title_tax_rate_drift_fix_verification_queries.sql
--   section "1) PREFLIGHT" first to confirm the live table actually matches the drifted shape
--   assumed above before applying (title missing, tax_rate present and NOT NULL).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'tax_rate'
  ) THEN
    RAISE EXCEPTION
      'Aborting: public.invoice_items has no tax_rate column. This migration assumes the drifted live shape described above; re-check the current schema (see preflight query) before proceeding.';
  END IF;
END;
$$;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS title text;

ALTER TABLE public.invoice_items
  ALTER COLUMN tax_rate SET DEFAULT 0;
