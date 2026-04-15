-- Launch hardening: enforce non-null default for cases.priority.
-- "Nicht gesetzt" in UI must persist as medium, never NULL.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'priority'
  ) THEN
    UPDATE public.cases
    SET priority = 'medium'
    WHERE priority IS NULL;

    ALTER TABLE public.cases
      ALTER COLUMN priority SET DEFAULT 'medium';

    ALTER TABLE public.cases
      ALTER COLUMN priority SET NOT NULL;
  END IF;
END $$;
