BEGIN;

-- Voxera uses Swiss QR invoices as the active payment flow.
-- Legacy payment-link columns remain in place for schema compatibility,
-- but their values are cleared so no new customer inherits an old link.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plan_config' AND column_name = 'monthly_payment_link'
  ) THEN
    EXECUTE 'UPDATE public.plan_config SET monthly_payment_link = NULL WHERE monthly_payment_link IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plan_config' AND column_name = 'yearly_payment_link'
  ) THEN
    EXECUTE 'UPDATE public.plan_config SET yearly_payment_link = NULL WHERE yearly_payment_link IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plan_config' AND column_name = 'setup_fee_payment_link'
  ) THEN
    EXECUTE 'UPDATE public.plan_config SET setup_fee_payment_link = NULL WHERE setup_fee_payment_link IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plan_config' AND column_name = 'setup_fee_link'
  ) THEN
    EXECUTE 'UPDATE public.plan_config SET setup_fee_link = NULL WHERE setup_fee_link IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'payment_link'
  ) THEN
    EXECUTE 'UPDATE public.customers SET payment_link = NULL WHERE payment_link IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_accounts' AND column_name = 'stripe_link_enabled'
  ) THEN
    EXECUTE 'UPDATE public.payment_accounts SET stripe_link_enabled = FALSE WHERE stripe_link_enabled IS DISTINCT FROM FALSE';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
