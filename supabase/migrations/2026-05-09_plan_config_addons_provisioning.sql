BEGIN;

CREATE TABLE IF NOT EXISTS public.plan_config (
  plan_code TEXT PRIMARY KEY,
  price_monthly_chf NUMERIC(10,2) NOT NULL,
  price_annual_monthly_chf NUMERIC(10,2) NOT NULL,
  setup_fee_chf NUMERIC(10,2) NOT NULL,
  included_minutes INTEGER NOT NULL,
  overage_rate_chf NUMERIC(6,4) NOT NULL,
  languages TEXT[] NOT NULL,
  allow_custom_name BOOLEAN NOT NULL DEFAULT FALSE,
  allow_custom_voice BOOLEAN NOT NULL DEFAULT FALSE,
  allow_voice_clone BOOLEAN NOT NULL DEFAULT FALSE,
  elevenlabs_default_voice_id TEXT,
  sms_wa_notify_included BOOLEAN NOT NULL DEFAULT FALSE,
  support_level TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.plan_config (
  plan_code, price_monthly_chf, price_annual_monthly_chf, setup_fee_chf,
  included_minutes, overage_rate_chf, languages,
  allow_custom_name, allow_custom_voice, allow_voice_clone, elevenlabs_default_voice_id,
  sms_wa_notify_included, support_level, display_name, created_at, updated_at
) VALUES
  ('starter', 149.00, 134.00, 199.00, 60, 0.3500, ARRAY['de'], FALSE, FALSE, FALSE, NULL, FALSE, 'email', 'Starter', now(), now()),
  ('business', 249.00, 224.00, 299.00, 150, 0.2500, ARRAY['de','fr'], TRUE, FALSE, FALSE, NULL, FALSE, 'email_chat', 'Business', now(), now()),
  ('professional', 399.00, 359.00, 499.00, 350, 0.1800, ARRAY['de','fr','it','en'], TRUE, TRUE, TRUE, NULL, TRUE, 'priority', 'Professional', now(), now())
ON CONFLICT (plan_code) DO UPDATE SET
  price_monthly_chf = EXCLUDED.price_monthly_chf,
  price_annual_monthly_chf = EXCLUDED.price_annual_monthly_chf,
  setup_fee_chf = EXCLUDED.setup_fee_chf,
  included_minutes = EXCLUDED.included_minutes,
  overage_rate_chf = EXCLUDED.overage_rate_chf,
  languages = EXCLUDED.languages,
  allow_custom_name = EXCLUDED.allow_custom_name,
  allow_custom_voice = EXCLUDED.allow_custom_voice,
  allow_voice_clone = EXCLUDED.allow_voice_clone,
  elevenlabs_default_voice_id = COALESCE(public.plan_config.elevenlabs_default_voice_id, EXCLUDED.elevenlabs_default_voice_id),
  sms_wa_notify_included = EXCLUDED.sms_wa_notify_included,
  support_level = EXCLUDED.support_level,
  display_name = EXCLUDED.display_name,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.customer_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  addon_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  price_chf NUMERIC(10,2),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_id, addon_code)
);

CREATE INDEX IF NOT EXISTS idx_customer_addons_customer ON public.customer_addons(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_addons_status ON public.customer_addons(status);

CREATE OR REPLACE FUNCTION public.customer_has_addon(p_customer_id UUID, p_addon_code TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_addons
    WHERE customer_id = p_customer_id
      AND addon_code = p_addon_code
      AND status = 'active'
  );
$$ LANGUAGE SQL STABLE;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS subscription_plan_code TEXT REFERENCES public.plan_config(plan_code),
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS elevenlabs_agent_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_display_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS assistant_name TEXT DEFAULT 'Lara';

COMMIT;
