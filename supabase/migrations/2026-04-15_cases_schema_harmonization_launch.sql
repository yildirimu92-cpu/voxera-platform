-- Launch harmonization: ensure canonical manual-task columns exist on public.cases
-- Canonical fields expected by runtime: title, note, due_at, phone
-- Safe for mixed environments with legacy columns (type, notes).

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS due_at date,
  ADD COLUMN IF NOT EXISTS phone text;

DO $$
BEGIN
  -- Backfill title from legacy type if needed.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'type'
  ) THEN
    UPDATE public.cases
    SET title = type
    WHERE title IS NULL
      AND type IS NOT NULL;
  END IF;

  -- Backfill note from legacy notes if needed.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'notes'
  ) THEN
    UPDATE public.cases
    SET note = notes
    WHERE note IS NULL
      AND notes IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cases_customer_due_open
  ON public.cases (customer_id, due_at)
  WHERE status <> 'done';
