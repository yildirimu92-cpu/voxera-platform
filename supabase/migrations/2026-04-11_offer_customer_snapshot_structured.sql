-- Migration: Offer customer snapshot structured fields
-- Date: 2026-04-11
-- Goal: align offers.customer snapshot with customers master structure while keeping legacy compatibility

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS contact_first_name text,
  ADD COLUMN IF NOT EXISTS contact_last_name text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text;

-- Backfill first/last name from legacy contact_name where possible.
UPDATE public.offers
SET
  contact_first_name = COALESCE(contact_first_name, NULLIF(split_part(trim(contact_name), ' ', 1), '')),
  contact_last_name = COALESCE(
    contact_last_name,
    NULLIF(trim(regexp_replace(trim(contact_name), '^\\S+\\s*', '')), '')
  )
WHERE contact_name IS NOT NULL
  AND (contact_first_name IS NULL OR contact_last_name IS NULL);

-- Backfill structured snapshot from linked customer for existing offers when empty.
UPDATE public.offers o
SET
  company_name = COALESCE(o.company_name, c.customer_name),
  email = COALESCE(o.email, c.email),
  phone = COALESCE(o.phone, c.tel_nr),
  contact_first_name = COALESCE(o.contact_first_name, c.contact_first_name),
  contact_last_name = COALESCE(o.contact_last_name, c.contact_last_name),
  contact_name = COALESCE(
    o.contact_name,
    NULLIF(trim(concat_ws(' ', c.contact_first_name, c.contact_last_name)), ''),
    c.contact_name
  ),
  street = COALESCE(o.street, c.street),
  postal_code = COALESCE(o.postal_code, c.zip),
  city = COALESCE(o.city, c.city),
  country = COALESCE(o.country, c.country),
  address = COALESCE(
    o.address,
    NULLIF(trim(concat_ws(', ', c.street, c.zip, c.city, c.country)), '')
  )
FROM public.customers c
WHERE o.customer_id = c.id;
