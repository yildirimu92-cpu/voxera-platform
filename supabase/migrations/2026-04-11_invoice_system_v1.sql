-- Migration: Invoice System V1 (minimal + robust)
-- Date: 2026-04-11
-- Scope: invoices, invoice_items, invoice_sequences, invoice numbering function

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  year integer PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  customer_id text NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  invoice_type text NOT NULL,
  billing_provider text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'CHF',
  subtotal_amount numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  period_start timestamptz,
  period_end timestamptz,
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  paid_source text,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  stripe_invoice_id text,
  external_reference text,
  notes text,
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_invoice_type_check CHECK (invoice_type IN ('setup_fee', 'subscription', 'manual')),
  CONSTRAINT invoices_billing_provider_check CHECK (billing_provider IN ('stripe', 'invoice')),
  CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  CONSTRAINT invoices_paid_source_check CHECK (paid_source IS NULL OR paid_source IN ('stripe', 'bank_transfer', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription_id ON public.invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due_at ON public.invoices(status, due_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_external_reference ON public.invoices(external_reference) WHERE external_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 1,
  item_type text NOT NULL,
  title text NOT NULL,
  description text,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_items_item_type_check CHECK (item_type IN ('setup_fee', 'subscription_base', 'overage', 'discount', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id_sort ON public.invoice_items(invoice_id, sort_order);

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
      -- retry optimistic insert race
    END;
  END LOOP;

  RETURN format('VX-%s-%s', current_year, lpad(next_value::text, 6, '0'));
END;
$$;
