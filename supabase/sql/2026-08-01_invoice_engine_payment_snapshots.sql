BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'bank_transfer',
  ADD COLUMN IF NOT EXISTS payment_terms_days integer,
  ADD COLUMN IF NOT EXISTS customer_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS line_items_snapshot jsonb;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_payment_method_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_payment_method_check
  CHECK (payment_method IN ('bank_transfer','stripe','cash','other'));

CREATE INDEX IF NOT EXISTS idx_invoices_payment_account_id
  ON public.invoices(payment_account_id);

CREATE INDEX IF NOT EXISTS idx_invoices_due_status
  ON public.invoices(status, due_at);

COMMIT;
