-- V1 Billing Gate: setup fee/payment link/payment status on customers

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS setup_fee_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS payment_link text,
  ADD COLUMN IF NOT EXISTS payment_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_received_at timestamptz;

UPDATE public.customers
SET payment_status = CASE lower(trim(coalesce(payment_status, '')))
  WHEN 'pending' THEN 'pending'
  WHEN 'paid' THEN 'paid'
  ELSE 'none'
END
WHERE payment_status IS NULL
   OR lower(trim(coalesce(payment_status, ''))) NOT IN ('none', 'pending', 'paid');

ALTER TABLE public.customers
  ALTER COLUMN payment_status SET DEFAULT 'none';

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_payment_status_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_payment_status_check
  CHECK (payment_status IN ('none', 'pending', 'paid'));
