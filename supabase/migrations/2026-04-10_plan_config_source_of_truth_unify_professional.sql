-- Source of truth migration: unify plan codes and derive customer billing defaults from plan_config

UPDATE public.plan_config
SET id = 'professional', updated_at = now()
WHERE id = 'pro'
  AND NOT EXISTS (SELECT 1 FROM public.plan_config pc2 WHERE pc2.id = 'professional');

UPDATE public.plan_config
SET updated_at = now(),
    name = COALESCE(NULLIF(name, ''), 'Professional'),
    setup_fee_payment_link = CASE id
      WHEN 'starter' THEN 'https://buy.stripe.com/28E9AVc5ObqygfY7eQ3cc01'
      WHEN 'business' THEN 'https://buy.stripe.com/cNicN74Dm52a8Nwbv63cc02'
      WHEN 'professional' THEN 'https://buy.stripe.com/eVq5kFgm452a6FoeHi3cc03'
      ELSE setup_fee_payment_link
    END
WHERE id IN ('starter','business','professional');

UPDATE public.customers
SET plan_code = CASE lower(trim(coalesce(plan_code, plan, '')))
  WHEN 'pro' THEN 'professional'
  WHEN 'kein plan' THEN 'kein_plan'
  WHEN 'no_plan' THEN 'kein_plan'
  WHEN 'noplan' THEN 'kein_plan'
  ELSE lower(trim(coalesce(plan_code, plan, '')))
END;

UPDATE public.customers c
SET plan = c.plan_code,
    setup_fee_amount = pc.setup_fee_amount,
    payment_link = pc.setup_fee_payment_link,
    updated_at = now()
FROM public.plan_config pc
WHERE c.plan_code = pc.id;

UPDATE public.subscriptions
SET plan_code = CASE lower(trim(coalesce(plan_code, plan, '')))
  WHEN 'pro' THEN 'professional'
  WHEN 'kein plan' THEN 'kein_plan'
  WHEN 'no_plan' THEN 'kein_plan'
  WHEN 'noplan' THEN 'kein_plan'
  ELSE lower(trim(coalesce(plan_code, plan, '')))
END,
plan = CASE lower(trim(coalesce(plan_code, plan, '')))
  WHEN 'pro' THEN 'professional'
  WHEN 'kein plan' THEN 'kein_plan'
  WHEN 'no_plan' THEN 'kein_plan'
  WHEN 'noplan' THEN 'kein_plan'
  ELSE lower(trim(coalesce(plan_code, plan, '')))
END,
updated_at = now();
