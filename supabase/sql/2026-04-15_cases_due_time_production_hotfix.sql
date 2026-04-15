-- Production hotfix: add optional due_time for manual tasks on public.cases.
-- Real production SoT keeps due_at as DATE; due_time is nullable HH:MM text.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS due_time text;

UPDATE public.cases
SET due_time = NULL
WHERE due_time IS NOT NULL
  AND btrim(due_time) = '';

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_due_time_check;

ALTER TABLE public.cases
  ADD CONSTRAINT cases_due_time_check
  CHECK (
    due_time IS NULL
    OR due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  );

CREATE INDEX IF NOT EXISTS idx_cases_customer_due_time_open
  ON public.cases (customer_id, due_at, due_time)
  WHERE status <> 'done';
