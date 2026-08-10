-- Activation V2 customer state persistence
-- Purpose: Ensure customer-update-settings can persist/reset activation state without 500s

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS forwarding_status text,
  ADD COLUMN IF NOT EXISTS forwarding_mode text,
  ADD COLUMN IF NOT EXISTS activation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_test_mode text,
  ADD COLUMN IF NOT EXISTS activation_test_candidate_call_id text,
  ADD COLUMN IF NOT EXISTS last_confirmed_setup_device_type text,
  ADD COLUMN IF NOT EXISTS last_confirmed_forwarding_mode text,
  ADD COLUMN IF NOT EXISTS setup_device_type text;

UPDATE public.customers
SET forwarding_status = 'not_started'
WHERE forwarding_status IS NULL;

ALTER TABLE public.customers
  ALTER COLUMN forwarding_status SET DEFAULT 'not_started';

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_forwarding_status_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_forwarding_status_check
  CHECK (forwarding_status IN ('not_started', 'pending_test', 'active', 'inactive'));

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_forwarding_mode_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_forwarding_mode_check
  CHECK (forwarding_mode IS NULL OR forwarding_mode IN ('no_answer', 'unreachable', 'always', 'busy'));

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_activation_test_mode_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_activation_test_mode_check
  CHECK (activation_test_mode IS NULL OR activation_test_mode IN ('system_call', 'manual_call'));

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_last_confirmed_setup_device_type_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_last_confirmed_setup_device_type_check
  CHECK (
    last_confirmed_setup_device_type IS NULL
    OR last_confirmed_setup_device_type IN ('mobile', 'landline')
  );

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_last_confirmed_forwarding_mode_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_last_confirmed_forwarding_mode_check
  CHECK (
    last_confirmed_forwarding_mode IS NULL
    OR last_confirmed_forwarding_mode IN ('no_answer', 'unreachable', 'always', 'busy')
  );

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_setup_device_type_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_setup_device_type_check
  CHECK (
    setup_device_type IS NULL
    OR setup_device_type IN ('mobile', 'landline')
  );
