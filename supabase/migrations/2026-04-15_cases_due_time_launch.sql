-- Launch: optional local due-time for manual tasks (no timezone conversion).
-- Keep due_at as DATE and store HH:MM in a separate nullable column.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS due_time text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'due_time'
  ) THEN
    -- Normalize legacy empty values.
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
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cases_customer_due_time_open
  ON public.cases (customer_id, due_at, due_time)
  WHERE status <> 'done';
