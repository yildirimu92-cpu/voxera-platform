-- Canonicalize cases.priority values and enforce a stable check constraint.
-- Canonical storage values: low, medium, high (or NULL).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cases'
  ) THEN
    -- Ensure priority column exists.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'priority'
    ) THEN
      ALTER TABLE public.cases ADD COLUMN priority text;
    END IF;

    -- Normalize known legacy aliases.
    UPDATE public.cases
    SET priority = CASE
      WHEN lower(trim(priority)) IN ('urgent', 'dringend', 'critical', 'hoch') THEN 'high'
      WHEN lower(trim(priority)) IN ('normal', 'mittel') THEN 'medium'
      WHEN lower(trim(priority)) IN ('niedrig') THEN 'low'
      ELSE lower(trim(priority))
    END
    WHERE priority IS NOT NULL;

    -- Recreate canonical constraint.
    ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_priority_check;
    ALTER TABLE public.cases
      ADD CONSTRAINT cases_priority_check
      CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high'));
  END IF;
END $$;
