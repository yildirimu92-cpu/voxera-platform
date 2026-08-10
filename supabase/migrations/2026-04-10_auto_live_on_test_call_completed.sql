-- Auto-promote customer lifecycle to LIVE after successful test-call signal.
-- Current runtime signal for "test call completed" is the existence of a call row.
-- This trigger keeps customers/onboarding in sync at the data layer (not UI-only).

CREATE OR REPLACE FUNCTION public.fn_customer_auto_live_after_test_call()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status text;
  onboarding_status text;
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(trim(coalesce(c.status, '')))
    INTO current_status
  FROM public.customers c
  WHERE c.id = NEW.customer_id
  FOR UPDATE;

  SELECT lower(trim(coalesce(o.status, '')))
    INTO onboarding_status
  FROM public.onboarding o
  WHERE o.customer_id = NEW.customer_id
  FOR UPDATE;

  -- Guard rail: auto-live is only for the initial go-live window.
  -- It may only run while customer is in "activated" and onboarding is still "ready".
  IF current_status = 'activated' AND onboarding_status = 'ready' THEN
    UPDATE public.customers
    SET
      status = 'live',
      activated_at = coalesce(activated_at, now()),
      updated_at = now()
    WHERE id = NEW.customer_id;

    UPDATE public.onboarding
    SET
      status = 'completed',
      progress = 100,
      next_step = 'live',
      blocker = NULL,
      updated_at = now()
    WHERE customer_id = NEW.customer_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_auto_live_after_test_call ON public.calls;

CREATE TRIGGER trg_customer_auto_live_after_test_call
AFTER INSERT ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.fn_customer_auto_live_after_test_call();
