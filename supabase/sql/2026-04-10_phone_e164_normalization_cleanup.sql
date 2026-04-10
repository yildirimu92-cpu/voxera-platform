-- One-time cleanup: normalize business phone numbers to E.164-like format (+digits, no spaces)
-- Targets:
--   customers.voxera_number
--   calls.called_number
--   calls.voxera_number

BEGIN;

UPDATE public.customers
SET voxera_number = CASE
  WHEN nullif(trim(coalesce(voxera_number, '')), '') IS NULL THEN NULL
  WHEN regexp_replace(regexp_replace(trim(voxera_number), '^\+', ''), '\D', '', 'g') = '' THEN NULL
  ELSE '+' || regexp_replace(regexp_replace(trim(voxera_number), '^\+', ''), '\D', '', 'g')
END,
updated_at = now()
WHERE voxera_number IS NOT NULL;

UPDATE public.calls
SET called_number = CASE
  WHEN nullif(trim(coalesce(called_number, '')), '') IS NULL THEN NULL
  WHEN regexp_replace(regexp_replace(trim(called_number), '^\+', ''), '\D', '', 'g') = '' THEN NULL
  ELSE '+' || regexp_replace(regexp_replace(trim(called_number), '^\+', ''), '\D', '', 'g')
END,
voxera_number = CASE
  WHEN nullif(trim(coalesce(voxera_number, '')), '') IS NULL THEN NULL
  WHEN regexp_replace(regexp_replace(trim(voxera_number), '^\+', ''), '\D', '', 'g') = '' THEN NULL
  ELSE '+' || regexp_replace(regexp_replace(trim(voxera_number), '^\+', ''), '\D', '', 'g')
END,
updated_at = now()
WHERE called_number IS NOT NULL
   OR voxera_number IS NOT NULL;

COMMIT;
