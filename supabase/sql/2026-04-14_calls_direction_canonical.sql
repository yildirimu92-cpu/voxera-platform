-- Canonicalize calls.direction as a first-class schema field.
-- Decision: keep direction in data model for future outbound product flows.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'calls'
  ) THEN
    -- 1) Ensure column exists.
    ALTER TABLE public.calls
      ADD COLUMN IF NOT EXISTS direction text;

    -- 2) Normalize legacy / unexpected values idempotently.
    UPDATE public.calls
    SET direction = CASE
      WHEN lower(trim(coalesce(direction, ''))) = 'outbound' THEN 'outbound'
      ELSE 'inbound'
    END
    WHERE direction IS NULL
       OR lower(trim(direction)) NOT IN ('inbound', 'outbound');

    -- 3) Set canonical default for standard call ingestion.
    ALTER TABLE public.calls
      ALTER COLUMN direction SET DEFAULT 'inbound';
    ALTER TABLE public.calls
      ALTER COLUMN direction SET NOT NULL;

    -- 4) Enforce domain constraint.
    ALTER TABLE public.calls
      DROP CONSTRAINT IF EXISTS calls_direction_check;

    ALTER TABLE public.calls
      ADD CONSTRAINT calls_direction_check
      CHECK (direction IN ('inbound', 'outbound'));
  END IF;
END
$$;
