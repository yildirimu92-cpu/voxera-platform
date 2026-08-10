BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name text NOT NULL DEFAULT 'Voxera CHF',
  creditor_name text NOT NULL,
  creditor_street text NOT NULL,
  creditor_house_number text,
  creditor_postal_code text NOT NULL,
  creditor_city text NOT NULL,
  creditor_country char(2) NOT NULL DEFAULT 'CH',
  bank_name text,
  iban text NOT NULL,
  qr_iban text,
  bic text,
  currency char(3) NOT NULL DEFAULT 'CHF',
  reference_type text NOT NULL DEFAULT 'NON',
  payment_terms_days integer NOT NULL DEFAULT 30,
  billing_email text,
  vat_number text,
  default_message text,
  qr_enabled boolean NOT NULL DEFAULT true,
  stripe_link_enabled boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_accounts_currency_check CHECK (currency IN ('CHF','EUR')),
  CONSTRAINT payment_accounts_reference_type_check CHECK (reference_type IN ('QRR','SCOR','NON')),
  CONSTRAINT payment_accounts_terms_check CHECK (payment_terms_days BETWEEN 0 AND 365),
  CONSTRAINT payment_accounts_country_check CHECK (creditor_country ~ '^[A-Z]{2}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_accounts_default_currency
ON public.payment_accounts(currency)
WHERE is_default = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_payment_accounts_active
ON public.payment_accounts(is_active, currency, is_default DESC);

ALTER TABLE public.payment_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_accounts FROM anon;
REVOKE ALL ON public.payment_accounts FROM authenticated;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_account_id uuid REFERENCES public.payment_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_account_snapshot jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_reference_type text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS qr_payload text;

COMMIT;
