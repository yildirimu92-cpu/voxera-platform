-- Verification queries for core-table schema governance.
-- Run manually in SQL editor/CI to verify PK/FK/nullability/uniques.

-- 1) Column-level nullability/type snapshot for core tables
SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('customers', 'users', 'calls', 'cases', 'onboarding', 'admins')
ORDER BY table_name, ordinal_position;

-- 2) Constraints (PK/FK/UNIQUE/CHECK)
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
 AND tc.table_schema = ccu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('customers', 'users', 'calls', 'cases', 'onboarding', 'admins')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- 3) FK validation status (validated / not validated)
SELECT
  conrelid::regclass AS table_name,
  conname AS constraint_name,
  confrelid::regclass AS references_table,
  convalidated
FROM pg_constraint
WHERE contype = 'f'
  AND connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN ('customers', 'users', 'calls', 'cases', 'onboarding', 'admins')
ORDER BY conrelid::regclass::text, conname;

-- 4) Potential FK orphans (data quality checks)
SELECT 'users.customer_id -> customers.id' AS relation, count(*) AS orphan_count
FROM public.users u
LEFT JOIN public.customers c ON c.id = u.customer_id
WHERE u.customer_id IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'calls.customer_id -> customers.id', count(*)
FROM public.calls cl
LEFT JOIN public.customers c ON c.id = cl.customer_id
WHERE cl.customer_id IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'cases.customer_id -> customers.id', count(*)
FROM public.cases cs
LEFT JOIN public.customers c ON c.id = cs.customer_id
WHERE cs.customer_id IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'onboarding.customer_id -> customers.id', count(*)
FROM public.onboarding ob
LEFT JOIN public.customers c ON c.id = ob.customer_id
WHERE ob.customer_id IS NOT NULL AND c.id IS NULL;

-- 5) Required field nullability violations (business-critical)
SELECT 'customers.id' AS field, count(*) AS null_rows FROM public.customers WHERE id IS NULL
UNION ALL
SELECT 'customers.customer_name', count(*) FROM public.customers WHERE customer_name IS NULL
UNION ALL
SELECT 'users.id', count(*) FROM public.users WHERE id IS NULL
UNION ALL
SELECT 'calls.customer_id', count(*) FROM public.calls WHERE customer_id IS NULL
UNION ALL
SELECT 'cases.customer_id', count(*) FROM public.cases WHERE customer_id IS NULL
UNION ALL
SELECT 'onboarding.customer_id', count(*) FROM public.onboarding WHERE customer_id IS NULL
UNION ALL
SELECT 'admins.id', count(*) FROM public.admins WHERE id IS NULL;
