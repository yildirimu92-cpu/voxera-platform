BEGIN;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_snapshot jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS line_items_snapshot jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'bank_transfer';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_terms_days integer;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS pdf_path text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS pdf_version integer NOT NULL DEFAULT 0;

COMMIT;
