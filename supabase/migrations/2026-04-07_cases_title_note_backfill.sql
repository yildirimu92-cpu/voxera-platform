-- Launch-safe harmonization: backfill canonical case fields from legacy columns.
-- Only copies legacy values when canonical fields are NULL.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'title'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'type'
  ) THEN
    UPDATE public.cases
    SET title = type
    WHERE title IS NULL
      AND type IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'note'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'notes'
  ) THEN
    UPDATE public.cases
    SET note = notes
    WHERE note IS NULL
      AND notes IS NOT NULL;
  END IF;
END $$;
