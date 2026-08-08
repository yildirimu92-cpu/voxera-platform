-- READ ONLY: run after 2026-08-08_notifications_rls_current_customer_id.sql.
-- Every FAIL must be resolved before enabling a production deployment.

with checks as (
  select 'notifications RLS enabled' as check_name,
         to_regclass('public.notifications') is null
         or (select c.relrowsecurity from pg_catalog.pg_class c
              where c.oid = 'public.notifications'::regclass) as passed
  union all
  -- The reported bug: the read path must not depend on a direct grant on
  -- public.customers any more.
  select 'notifications_select resolves tenant via current_customer_id()',
         to_regclass('public.notifications') is null
         or exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.notifications'::regclass
             and p.polname = 'notifications_select'
             and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%current_customer_id()%'
         )
  union all
  select 'notifications_select no longer reads public.customers directly',
         to_regclass('public.notifications') is null
         or not exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.notifications'::regclass
             and p.polname = 'notifications_select'
             and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%customers%'
         )
  union all
  select 'notifications_update resolves tenant via current_customer_id()',
         to_regclass('public.notifications') is null
         or exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.notifications'::regclass
             and p.polname = 'notifications_update'
             and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%current_customer_id()%'
         )
  union all
  -- with check (true) let a caller hand their own row to another tenant.
  select 'notifications_update with check is tenant-bound, not true',
         to_regclass('public.notifications') is null
         or exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.notifications'::regclass
             and p.polname = 'notifications_update'
             and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) like '%current_customer_id()%'
         )
  union all
  -- The injection hole: no policy on this table may apply to PUBLIC.
  select 'no notifications policy applies to PUBLIC',
         to_regclass('public.notifications') is null
         or not exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.notifications'::regclass
             and 0 = any(p.polroles)
         )
  union all
  select 'notifications INSERT policy scoped to service_role only',
         to_regclass('public.notifications') is null
         or not exists (
           select 1 from pg_catalog.pg_policy p
           where p.polrelid = 'public.notifications'::regclass
             and p.polcmd in ('a', '*')
             and exists (
               select 1 from pg_catalog.unnest(p.polroles) as assigned(role_oid)
               left join pg_catalog.pg_roles r on r.oid = assigned.role_oid
               where assigned.role_oid = 0 or r.rolname in ('anon', 'authenticated')
             )
         )
  union all
  select 'anon INSERT on notifications denied',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_table_privilege('anon', 'public.notifications', 'INSERT')
  union all
  select 'authenticated INSERT on notifications denied',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'INSERT')
  union all
  select 'anon SELECT on notifications denied',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_table_privilege('anon', 'public.notifications', 'SELECT')
  union all
  select 'anon UPDATE on notifications denied',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_table_privilege('anon', 'public.notifications', 'UPDATE')
  union all
  select 'anon DELETE on notifications denied',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_table_privilege('anon', 'public.notifications', 'DELETE')
  union all
  select 'authenticated DELETE on notifications denied',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'DELETE')
  union all
  -- The browser must keep exactly the two things it actually does: read its
  -- own rows, and mark them read.
  select 'authenticated SELECT on notifications still allowed',
         to_regclass('public.notifications') is null
         or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'SELECT')
  union all
  select 'notifications table-wide authenticated UPDATE denied',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
  union all
  select 'notifications authenticated column UPDATE allowlist is read_at only',
         to_regclass('public.notifications') is null
         or 1 = (
           select count(*) from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'notifications'
             and grantee = 'authenticated' and privilege_type = 'UPDATE'
         )
  union all
  select 'notifications.read_at is authenticated-updatable',
         to_regclass('public.notifications') is null
         or pg_catalog.has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE')
  union all
  select 'notifications.title not authenticated-updatable',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE')
  union all
  select 'notifications.customer_id not authenticated-updatable',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_column_privilege('authenticated', 'public.notifications', 'customer_id', 'UPDATE')
  union all
  -- Server insert path must survive.
  select 'service_role INSERT on notifications still allowed',
         to_regclass('public.notifications') is null
         or pg_catalog.has_table_privilege('service_role', 'public.notifications', 'INSERT')
  union all
  select 'current_customer_id() helper present',
         to_regprocedure('public.current_customer_id()') is not null
)
select
  case when passed then 'PASS' else 'FAIL' end as status,
  check_name
from checks
order by passed, check_name;
