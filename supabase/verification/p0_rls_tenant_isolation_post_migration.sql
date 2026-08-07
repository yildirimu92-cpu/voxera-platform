-- READ ONLY: run after 2026-08-06_p0_rls_tenant_isolation_hardening.sql and
-- 2026-08-07_customers_onboarding_completed_column_grant.sql (the latter
-- extended the customers column allowlist by one column that the original
-- hardening migration's grep-based audit missed -- see that migration's
-- header comment for the incident it fixes).
-- Every FAIL must be resolved before enabling a production deployment.

with checks as (
  select 'users_self_update policy removed' as check_name,
         not exists (
           select 1 from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'users' and policyname = 'users_self_update'
         ) as passed
  union all
  select 'users authenticated UPDATE denied',
         to_regclass('public.users') is null
         or not pg_catalog.has_table_privilege('authenticated', 'public.users', 'UPDATE')
  union all
  select 'users authenticated SELECT still allowed (own row read must survive)',
         to_regclass('public.users') is null
         or pg_catalog.has_table_privilege('authenticated', 'public.users', 'SELECT')
  union all
  select 'customers table-wide authenticated UPDATE denied',
         to_regclass('public.customers') is null
         or not pg_catalog.has_table_privilege('authenticated', 'public.customers', 'UPDATE')
  union all
  select 'customers authenticated column UPDATE allowlist matches exactly 4 columns',
         to_regclass('public.customers') is null
         or 4 = (
           select count(*) from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'customers'
             and grantee = 'authenticated' and privilege_type = 'UPDATE'
             and column_name in ('contact_first_name', 'in_app_notification_settings', 'updated_at', 'onboarding_completed')
         )
  union all
  select 'customers.ai_instructions not authenticated-updatable',
         to_regclass('public.customers') is null
         or not pg_catalog.has_column_privilege('authenticated', 'public.customers', 'ai_instructions', 'UPDATE')
  union all
  select 'customers.status not authenticated-updatable',
         to_regclass('public.customers') is null
         or not pg_catalog.has_column_privilege('authenticated', 'public.customers', 'status', 'UPDATE')
  union all
  select 'calls table-wide authenticated UPDATE denied',
         to_regclass('public.calls') is null
         or not pg_catalog.has_table_privilege('authenticated', 'public.calls', 'UPDATE')
  union all
  select 'calls authenticated column UPDATE allowlist matches exactly 4 columns',
         to_regclass('public.calls') is null
         or 4 = (
           select count(*) from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'calls'
             and grantee = 'authenticated' and privilege_type = 'UPDATE'
             and column_name in ('read_at', 'notes_customer_voxera', 'dashboard_status', 'updated_at')
         )
  union all
  select 'calls.duration_seconds not authenticated-updatable',
         to_regclass('public.calls') is null
         or not pg_catalog.has_column_privilege('authenticated', 'public.calls', 'duration_seconds', 'UPDATE')
  union all
  select 'calls.transcript not authenticated-updatable',
         to_regclass('public.calls') is null
         or not pg_catalog.has_column_privilege('authenticated', 'public.calls', 'transcript', 'UPDATE')
  union all
  select 'calls.call_summary not authenticated-updatable',
         to_regclass('public.calls') is null
         or not pg_catalog.has_column_privilege('authenticated', 'public.calls', 'call_summary', 'UPDATE')
  union all
  select 'contracts RLS enabled or table absent',
         to_regclass('public.contracts') is null
         or exists (select 1 from pg_catalog.pg_class where oid = to_regclass('public.contracts') and relrowsecurity)
  union all
  select 'contracts anon has no privileges',
         to_regclass('public.contracts') is null
         or not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'contracts' and grantee = 'anon'
         )
  union all
  select 'contracts admin + own-tenant policies present',
         to_regclass('public.contracts') is null
         or 2 = (
           select count(*) from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'contracts'
             and policyname in ('contracts_admin_all', 'contracts_customer_select_own')
         )
  union all
  select 'subscriptions RLS enabled or table absent',
         to_regclass('public.subscriptions') is null
         or exists (select 1 from pg_catalog.pg_class where oid = to_regclass('public.subscriptions') and relrowsecurity)
  union all
  select 'subscriptions anon has no privileges',
         to_regclass('public.subscriptions') is null
         or not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'subscriptions' and grantee = 'anon'
         )
  union all
  select 'subscriptions admin + own-tenant policies present',
         to_regclass('public.subscriptions') is null
         or 2 = (
           select count(*) from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'subscriptions'
             and policyname in ('subscriptions_admin_all', 'subscriptions_customer_select_own')
         )
  union all
  select 'offers RLS enabled or table absent',
         to_regclass('public.offers') is null
         or exists (select 1 from pg_catalog.pg_class where oid = to_regclass('public.offers') and relrowsecurity)
  union all
  select 'offers anon has no privileges',
         to_regclass('public.offers') is null
         or not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'offers' and grantee = 'anon'
         )
  union all
  select 'offers admin + own-tenant policies present',
         to_regclass('public.offers') is null
         or 2 = (
           select count(*) from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'offers'
             and policyname in ('offers_admin_all', 'offers_customer_select_own')
         )
  union all
  select 'invoices RLS enabled or table absent',
         to_regclass('public.invoices') is null
         or exists (select 1 from pg_catalog.pg_class where oid = to_regclass('public.invoices') and relrowsecurity)
  union all
  select 'invoices anon has no privileges',
         to_regclass('public.invoices') is null
         or not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'invoices' and grantee = 'anon'
         )
  union all
  select 'invoices authenticated UPDATE still allowed (admin mail-dispatch dependency)',
         to_regclass('public.invoices') is null
         or pg_catalog.has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
  union all
  select 'invoices admin + own-tenant policies present',
         to_regclass('public.invoices') is null
         or 2 = (
           select count(*) from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'invoices'
             and policyname in ('invoices_admin_all', 'invoices_customer_select_own')
         )
  union all
  select 'customer_addons RLS enabled or table absent',
         to_regclass('public.customer_addons') is null
         or exists (select 1 from pg_catalog.pg_class where oid = to_regclass('public.customer_addons') and relrowsecurity)
  union all
  select 'customer_addons anon has no privileges',
         to_regclass('public.customer_addons') is null
         or not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'customer_addons' and grantee = 'anon'
         )
  union all
  select 'customer_addons admin + own-tenant policies present',
         to_regclass('public.customer_addons') is null
         or 2 = (
           select count(*) from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'customer_addons'
             and policyname in ('customer_addons_admin_all', 'customer_addons_customer_select_own')
         )
)
select check_name, case when passed then 'PASS' else 'FAIL' end as result
from checks
order by check_name;

-- Full policy listing for manual review alongside the PASS/FAIL summary.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('users', 'customers', 'calls', 'contracts', 'subscriptions', 'invoices', 'offers', 'customer_addons')
order by tablename, policyname;

-- Full grant listing for manual review alongside the PASS/FAIL summary.
select table_schema, table_name, grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('customers', 'calls')
  and grantee in ('anon', 'authenticated')
union all
select table_schema, table_name, grantee, privilege_type, null as column_name
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('users', 'contracts', 'subscriptions', 'invoices', 'offers', 'customer_addons')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee, privilege_type;
