-- READ ONLY: nach 2026-08-08_ai_change_requests_tenant_isolation_reassert.sql
-- laufen lassen. Jede FAIL-Zeile muss vor einem Produktions-Deploy geklärt sein.

with checks as (
  select 'ai_change_requests RLS enabled' as check_name,
         to_regclass('public.ai_change_requests') is null
         or (select c.relrowsecurity from pg_catalog.pg_class c
              where c.oid = 'public.ai_change_requests'::regclass) as passed
  union all
  -- Der eigentliche Befund: die Vor-P0-Policies dürfen nicht überleben.
  select 'stale policy authenticated_read_all removed',
         to_regclass('public.ai_change_requests') is null
         or not exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.ai_change_requests'::regclass
             and p.polname = 'authenticated_read_all'
         )
  union all
  select 'stale policy customer_own_requests removed',
         to_regclass('public.ai_change_requests') is null
         or not exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.ai_change_requests'::regclass
             and p.polname = 'customer_own_requests'
         )
  union all
  -- Keine Policy auf dieser Tabelle darf auf PUBLIC zielen.
  select 'no ai_change_requests policy applies to PUBLIC',
         to_regclass('public.ai_change_requests') is null
         or not exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.ai_change_requests'::regclass
             and 0 = any(p.polroles)
         )
  union all
  -- Keine Policy darf den Mandanten noch über auth.role() statt über die
  -- Mandanten-ID entscheiden -- das war die Lücke.
  select 'no policy authorises by auth.role() alone',
         to_regclass('public.ai_change_requests') is null
         or not exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.ai_change_requests'::regclass
             and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%auth.role()%'
         )
  union all
  select 'admin policy present and scoped to is_admin()',
         to_regclass('public.ai_change_requests') is null
         or exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.ai_change_requests'::regclass
             and p.polname = 'ai_change_requests_admin_all'
             and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%is_admin%'
         )
  union all
  select 'customer select policy is tenant-bound',
         to_regclass('public.ai_change_requests') is null
         or exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.ai_change_requests'::regclass
             and p.polname = 'ai_change_requests_customer_select_own'
             and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%current_customer_id()%'
         )
  union all
  select 'customer insert policy is tenant-bound',
         to_regclass('public.ai_change_requests') is null
         or exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.ai_change_requests'::regclass
             and p.polname = 'ai_change_requests_customer_insert_own'
             and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) like '%current_customer_id()%'
         )
  union all
  select 'customer update policy is tenant-bound on both sides',
         to_regclass('public.ai_change_requests') is null
         or exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.ai_change_requests'::regclass
             and p.polname = 'ai_change_requests_customer_update_own'
             and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%current_customer_id()%'
             and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) like '%current_customer_id()%'
         )
  union all
  select 'customer delete policy is tenant-bound',
         to_regclass('public.ai_change_requests') is null
         or exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.ai_change_requests'::regclass
             and p.polname = 'ai_change_requests_customer_delete_own'
             and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%current_customer_id()%'
         )
  union all
  select 'anon has no access to ai_change_requests',
         to_regclass('public.ai_change_requests') is null
         or not (
           pg_catalog.has_table_privilege('anon', 'public.ai_change_requests', 'SELECT')
           or pg_catalog.has_table_privilege('anon', 'public.ai_change_requests', 'INSERT')
           or pg_catalog.has_table_privilege('anon', 'public.ai_change_requests', 'UPDATE')
           or pg_catalog.has_table_privilege('anon', 'public.ai_change_requests', 'DELETE')
         )
  union all
  -- Kunden- und Admin-Oberfläche laufen beide über authenticated; die Zeilen
  -- werden von den Policies begrenzt, nicht vom Grant.
  select 'authenticated keeps table grants (rows constrained by RLS)',
         to_regclass('public.ai_change_requests') is null
         or (pg_catalog.has_table_privilege('authenticated', 'public.ai_change_requests', 'SELECT')
             and pg_catalog.has_table_privilege('authenticated', 'public.ai_change_requests', 'INSERT'))
  union all
  select 'service_role keeps full access',
         to_regclass('public.ai_change_requests') is null
         or (pg_catalog.has_table_privilege('service_role', 'public.ai_change_requests', 'SELECT')
             and pg_catalog.has_table_privilege('service_role', 'public.ai_change_requests', 'INSERT')
             and pg_catalog.has_table_privilege('service_role', 'public.ai_change_requests', 'DELETE'))
  union all
  select 'is_admin() helper present',
         to_regprocedure('public.is_admin(uuid)') is not null
  union all
  select 'current_customer_id() helper present',
         to_regprocedure('public.current_customer_id()') is not null
  union all
  -- Wäre kein Admin mehr admin, hätte das Admin-Panel keinen Lesepfad mehr.
  select 'at least one admin still satisfies is_admin()',
         to_regclass('public.admins') is null
         or exists (
           select 1 from public.admins a
           join auth.users au on au.id = a.id
           where pg_catalog.replace(pg_catalog.lower(coalesce(a.role, '')), '_', '-')
                   in ('super-admin', 'admin', 'support', 'owner', 'ops')
             and pg_catalog.replace(pg_catalog.lower(coalesce(a.status, 'active')), '_', '-')
                   in ('active', 'enabled')
         )
)
select
  case when passed then 'PASS' else 'FAIL' end as status,
  check_name
from checks
order by passed, check_name;
