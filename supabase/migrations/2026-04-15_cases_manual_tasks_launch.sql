-- Launch: manual tasks in customer dashboard
-- Minimal extension of existing cases model (no parallel table)

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS due_at date,
  ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_cases_customer_due_open
  ON public.cases (customer_id, due_at)
  WHERE status <> 'done';
