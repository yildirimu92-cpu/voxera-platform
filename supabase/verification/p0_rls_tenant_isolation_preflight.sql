-- READ ONLY: run before 2026-08-06_p0_rls_tenant_isolation_hardening.sql.
-- Save the complete result as rollback evidence. Do not share secret values.
-- Covers P0-1 (users.customer_id self-write), P0-2 (missing RLS on
-- contracts/subscriptions/invoices/offers/customer_addons) and P0-5
-- (column-unscoped UPDATE on customers/calls) from
-- SECURITY_BESTANDSAUFNAHME_2026-08-06.md.

select current_database() as database_name, current_user as execution_role, now() as captured_at;

-- (1) RLS enablement state for every table this migration touches.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('users', 'customers', 'calls', 'contracts', 'subscriptions', 'invoices', 'offers', 'customer_addons')
order by c.relname;

-- (2) All existing policies on these tables, verbatim (for rollback restoration).
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('users', 'customers', 'calls', 'contracts', 'subscriptions', 'invoices', 'offers', 'customer_addons')
order by tablename, policyname;

-- (3) Effective table-level grants for anon/authenticated (independent of RLS;
--     a table with RLS enabled but a broad GRANT is still exposed to any
--     future policy regression).
select table_schema, table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  and table_name in ('users', 'customers', 'calls', 'contracts', 'subscriptions', 'invoices', 'offers', 'customer_addons')
order by table_name, grantee, privilege_type;

-- (4) Column-level grants already in place for authenticated on customers/calls.
--     Non-empty rows here beyond what the migration re-grants indicate a live
--     dependency not found in the repository and must be investigated first.
select table_schema, table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('customers', 'calls')
  and grantee in ('anon', 'authenticated')
order by table_name, column_name, grantee;

-- (5) P0-2 dependency check: which of the five target tables are already
--     read directly from a browser client per the repository, and whether a
--     required column exists.
select table_schema, table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'customers' and column_name in ('id', 'status', 'ai_instructions', 'contact_first_name', 'in_app_notification_settings'))
    or (table_name = 'calls' and column_name in ('id', 'customer_id', 'duration_seconds', 'read_at', 'notes_customer_voxera', 'dashboard_status', 'transcript', 'call_summary'))
    or (table_name = 'contracts' and column_name = 'customer_id')
    or (table_name = 'subscriptions' and column_name = 'customer_id')
    or (table_name = 'invoices' and column_name in ('customer_id', 'status'))
    or (table_name = 'offers' and column_name = 'customer_id')
    or (table_name = 'customer_addons' and column_name = 'customer_id')
  )
order by table_name, column_name;

-- (6) Repository finding: customer_addons.customer_id is declared uuid while
--     customers.id is declared text. A non-empty result here confirms a live
--     FK/type mismatch that the migration's ::text cast is designed to survive,
--     but which should be corrected in a separate follow-up migration.
select
  kcu.table_name as referencing_table,
  kcu.column_name as referencing_column,
  c1.data_type as referencing_type,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column,
  c2.data_type as referenced_type
from information_schema.table_constraints as tc
join information_schema.key_column_usage as kcu
  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
join information_schema.constraint_column_usage as ccu
  on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
join information_schema.columns as c1
  on c1.table_schema = kcu.table_schema and c1.table_name = kcu.table_name and c1.column_name = kcu.column_name
join information_schema.columns as c2
  on c2.table_schema = ccu.table_schema and c2.table_name = ccu.table_name and c2.column_name = ccu.column_name
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and kcu.table_name = 'customer_addons'
  and kcu.column_name = 'customer_id';

-- (7) P0-1 dependency check: any row where users.customer_id differs from the
--     unique customers.auth_user_id binding. A large or growing count here
--     after deploy would indicate a legitimate write path to users.customer_id
--     that this migration's REVOKE would have blocked; investigate before
--     applying if this returns unexpected rows today.
select count(*) as users_customer_id_rows,
       count(*) filter (where customer_id is not null) as bound_rows
from public.users;

-- (8) Existing helper functions this migration depends on must already exist
--     with the expected signature.
select p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_admin', 'current_customer_id', 'is_customer_entitled')
order by p.proname;
