-- Migration: Offer / Quote System V1
-- Date: 2026-04-11

CREATE TABLE IF NOT EXISTS public.offer_sequences (
  year integer PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.next_offer_number_v1()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  current_year integer := EXTRACT(YEAR FROM now())::integer;
  next_value integer;
BEGIN
  LOOP
    UPDATE public.offer_sequences
    SET last_value = last_value + 1,
        updated_at = now()
    WHERE year = current_year
    RETURNING last_value INTO next_value;

    IF FOUND THEN EXIT; END IF;

    BEGIN
      INSERT INTO public.offer_sequences(year,last_value,updated_at)
      VALUES (current_year,1,now())
      RETURNING last_value INTO next_value;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
    END;
  END LOOP;

  RETURN format('OFF-%s-%s', current_year, lpad(next_value::text, 6, '0'));
END;
$$;

CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_number text NOT NULL UNIQUE DEFAULT public.next_offer_number_v1(),
  status text NOT NULL DEFAULT 'draft',
  customer_id text REFERENCES public.customers(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  company_name text,
  contact_name text,
  email text,
  phone text,
  address text,
  plan text NOT NULL DEFAULT 'professional',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  setup_fee numeric(12,2) NOT NULL DEFAULT 0,
  monthly_price numeric(12,2) NOT NULL DEFAULT 0,
  yearly_price numeric(12,2) NOT NULL DEFAULT 0,
  included_minutes integer NOT NULL DEFAULT 0,
  extra_per_minute numeric(12,2) NOT NULL DEFAULT 0,
  number_count integer NOT NULL DEFAULT 1,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  discount_percent numeric(8,2) NOT NULL DEFAULT 0,
  add_ons jsonb NOT NULL DEFAULT '{}'::jsonb,
  offer_text jsonb NOT NULL DEFAULT '{}'::jsonb,
  total numeric(12,2) NOT NULL DEFAULT 0,
  valid_until date,
  sent_to_email text,
  sent_at timestamptz,
  sent_by text,
  delivery_status text,
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offers_status_check CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  CONSTRAINT offers_billing_cycle_check CHECK (billing_cycle IN ('monthly','yearly'))
);

CREATE INDEX IF NOT EXISTS idx_offers_customer_id ON public.offers(customer_id);
CREATE INDEX IF NOT EXISTS idx_offers_contract_id ON public.offers(contract_id);
CREATE INDEX IF NOT EXISTS idx_offers_status_valid_until ON public.offers(status, valid_until);

ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_offer_id ON public.contracts(offer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_offer_id ON public.invoices(offer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contract_id ON public.invoices(contract_id);
