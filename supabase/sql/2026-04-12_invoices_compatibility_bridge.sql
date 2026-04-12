-- Migration: invoices compatibility bridge (production-safe, idempotent)
-- Date: 2026-04-12
-- Purpose:
--   Heal schema drift between legacy invoice fields and newer billing writes
--   without replacing public.invoices or removing data.

BEGIN;

-- 1) Safe helper table for deterministic invoice numbering.
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  year integer PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Safe helper function for invoice numbers (no max(uuid), race-safe).
CREATE OR REPLACE FUNCTION public.next_invoice_number_v1()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  current_year integer := EXTRACT(YEAR FROM now())::integer;
  next_value integer;
BEGIN
  LOOP
    UPDATE public.invoice_sequences
       SET last_value = last_value + 1,
           updated_at = now()
     WHERE year = current_year
     RETURNING last_value INTO next_value;

    IF FOUND THEN
      EXIT;
    END IF;

    BEGIN
      INSERT INTO public.invoice_sequences(year, last_value, updated_at)
      VALUES (current_year, 1, now())
      RETURNING last_value INTO next_value;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- another session created the row first; retry loop
    END;
  END LOOP;

  RETURN format('VX-%s-%s', current_year, lpad(next_value::text, 6, '0'));
END;
$$;

-- 3) Add missing compatibility columns expected by current runtime code paths.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS billing_provider text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_type text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS issued_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_source text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS subscription_id uuid;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS subtotal_amount numeric(12,2);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS pdf_url text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS period_end timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS external_reference text;

-- 4) Normalize defaults for legacy NOT NULL-sensitive columns.
ALTER TABLE public.invoices ALTER COLUMN invoice_date SET DEFAULT now()::date;
ALTER TABLE public.invoices ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.invoices ALTER COLUMN currency SET DEFAULT 'CHF';
ALTER TABLE public.invoices ALTER COLUMN billing_provider SET DEFAULT 'invoice';
ALTER TABLE public.invoices ALTER COLUMN invoice_type SET DEFAULT 'manual';
ALTER TABLE public.invoices ALTER COLUMN subtotal_amount SET DEFAULT 0;

-- 5) Compatibility trigger: keep legacy/new column pairs coherent both directions.
CREATE OR REPLACE FUNCTION public.invoices_compat_normalize_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- issued_at <-> invoice_date
  IF NEW.issued_at IS NULL AND NEW.invoice_date IS NOT NULL THEN
    NEW.issued_at := NEW.invoice_date::timestamp AT TIME ZONE 'UTC';
  END IF;

  IF NEW.invoice_date IS NULL AND NEW.issued_at IS NOT NULL THEN
    NEW.invoice_date := (NEW.issued_at AT TIME ZONE 'UTC')::date;
  END IF;

  IF NEW.invoice_date IS NULL THEN
    NEW.invoice_date := now()::date;
  END IF;

  IF NEW.issued_at IS NULL THEN
    NEW.issued_at := NEW.invoice_date::timestamp AT TIME ZONE 'UTC';
  END IF;

  -- due_at <-> due_date
  IF NEW.due_at IS NULL AND NEW.due_date IS NOT NULL THEN
    NEW.due_at := NEW.due_date::timestamp AT TIME ZONE 'UTC';
  END IF;

  IF NEW.due_date IS NULL AND NEW.due_at IS NOT NULL THEN
    NEW.due_date := (NEW.due_at AT TIME ZONE 'UTC')::date;
  END IF;

  -- subtotal_amount <-> subtotal
  IF NEW.subtotal_amount IS NULL AND NEW.subtotal IS NOT NULL THEN
    NEW.subtotal_amount := NEW.subtotal;
  END IF;

  IF NEW.subtotal IS NULL AND NEW.subtotal_amount IS NOT NULL THEN
    NEW.subtotal := NEW.subtotal_amount;
  END IF;

  IF NEW.subtotal_amount IS NULL THEN
    NEW.subtotal_amount := 0;
  END IF;

  IF NEW.subtotal IS NULL THEN
    NEW.subtotal := NEW.subtotal_amount;
  END IF;

  -- total_amount <-> total/amount
  IF NEW.total_amount IS NULL THEN
    NEW.total_amount := COALESCE(NEW.total, NEW.amount, NEW.subtotal_amount + COALESCE(NEW.tax_amount, 0));
  END IF;

  IF NEW.total IS NULL AND NEW.total_amount IS NOT NULL THEN
    NEW.total := NEW.total_amount;
  END IF;

  IF NEW.amount IS NULL AND NEW.total_amount IS NOT NULL THEN
    NEW.amount := NEW.total_amount;
  END IF;

  IF NEW.status IS NULL OR btrim(NEW.status) = '' THEN
    NEW.status := 'draft';
  END IF;

  IF NEW.currency IS NULL OR btrim(NEW.currency) = '' THEN
    NEW.currency := 'CHF';
  END IF;

  IF NEW.billing_provider IS NULL OR btrim(NEW.billing_provider) = '' THEN
    NEW.billing_provider := 'invoice';
  END IF;

  IF NEW.invoice_type IS NULL OR btrim(NEW.invoice_type) = '' THEN
    NEW.invoice_type := 'manual';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_compat_normalize_v1 ON public.invoices;
CREATE TRIGGER trg_invoices_compat_normalize_v1
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.invoices_compat_normalize_v1();

-- 6) Backfill existing rows defensively once, preserving existing values.
UPDATE public.invoices
   SET issued_at = COALESCE(issued_at, invoice_date::timestamp AT TIME ZONE 'UTC'),
       invoice_date = COALESCE(invoice_date, (issued_at AT TIME ZONE 'UTC')::date, now()::date),
       due_at = COALESCE(due_at, due_date::timestamp AT TIME ZONE 'UTC'),
       due_date = COALESCE(due_date, (due_at AT TIME ZONE 'UTC')::date),
       subtotal_amount = COALESCE(subtotal_amount, subtotal, 0),
       subtotal = COALESCE(subtotal, subtotal_amount, 0),
       total_amount = COALESCE(total_amount, total, amount, COALESCE(subtotal_amount, subtotal, 0) + COALESCE(tax_amount, 0)),
       total = COALESCE(total, total_amount, amount, COALESCE(subtotal_amount, subtotal, 0) + COALESCE(tax_amount, 0)),
       amount = COALESCE(amount, total_amount, total, COALESCE(subtotal_amount, subtotal, 0) + COALESCE(tax_amount, 0)),
       status = COALESCE(NULLIF(btrim(status), ''), 'draft'),
       currency = COALESCE(NULLIF(btrim(currency), ''), 'CHF'),
       billing_provider = COALESCE(NULLIF(btrim(billing_provider), ''), 'invoice'),
       invoice_type = COALESCE(NULLIF(btrim(invoice_type), ''), 'manual')
 WHERE issued_at IS NULL
    OR invoice_date IS NULL
    OR due_at IS NULL
    OR due_date IS NULL
    OR subtotal_amount IS NULL
    OR subtotal IS NULL
    OR total_amount IS NULL
    OR total IS NULL
    OR amount IS NULL
    OR status IS NULL OR btrim(status) = ''
    OR currency IS NULL OR btrim(currency) = ''
    OR billing_provider IS NULL OR btrim(billing_provider) = ''
    OR invoice_type IS NULL OR btrim(invoice_type) = '';

-- Keep invoice_date safe for legacy NOT NULL insert paths.
UPDATE public.invoices
   SET invoice_date = now()::date
 WHERE invoice_date IS NULL;

-- 7) Compatibility checks/constraints with defensive replacement.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('setup_fee', 'subscription', 'recurring', 'manual', 'credit_note')) NOT VALID;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_billing_provider_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_billing_provider_check
  CHECK (billing_provider IN ('stripe', 'invoice')) NOT VALID;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_paid_source_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_paid_source_check
  CHECK (paid_source IS NULL OR paid_source IN ('stripe', 'bank_transfer', 'manual')) NOT VALID;

-- 8) Idempotency/index compatibility for external_reference.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_external_reference
ON public.invoices(external_reference)
WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_subscription_id ON public.invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due_at ON public.invoices(status, due_at);

COMMIT;
