-- READ ONLY: run after 2026-07-28_p0_security_foundation.sql.
-- Every FAIL must be resolved before enabling a production deployment.

with checks as (
  select 'delete_auth_user_data exists' as check_name,
         to_regprocedure('public.delete_auth_user_data(uuid)') is not null as passed
  union all
  select 'delete_auth_user_data PUBLIC denied',
         not exists (
           select 1
           from pg_catalog.pg_proc p
           cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
           where p.oid = to_regprocedure('public.delete_auth_user_data(uuid)')
             and acl.grantee = 0
             and acl.privilege_type = 'EXECUTE'
         )
  union all
  select 'delete_auth_user_data anon denied',
         not pg_catalog.has_function_privilege('anon', to_regprocedure('public.delete_auth_user_data(uuid)'), 'EXECUTE')
  union all
  select 'delete_auth_user_data authenticated denied',
         not pg_catalog.has_function_privilege('authenticated', to_regprocedure('public.delete_auth_user_data(uuid)'), 'EXECUTE')
  union all
  select 'delete_auth_user_data service_role allowed',
         pg_catalog.has_function_privilege('service_role', to_regprocedure('public.delete_auth_user_data(uuid)'), 'EXECUTE')
  union all
  select 'ensure_user_profile(3) authenticated allowed',
         pg_catalog.has_function_privilege('authenticated', to_regprocedure('public.ensure_user_profile(text,text,text)'), 'EXECUTE')
  union all
  select 'ensure_user_profile(3) anon denied',
         not pg_catalog.has_function_privilege('anon', to_regprocedure('public.ensure_user_profile(text,text,text)'), 'EXECUTE')
  union all
  select 'legacy ensure_user_profile(2) authenticated denied or absent',
         to_regprocedure('public.ensure_user_profile(text,text)') is null
         or not pg_catalog.has_function_privilege('authenticated', to_regprocedure('public.ensure_user_profile(text,text)'), 'EXECUTE')
  union all
  select 'current_customer_id authenticated allowed',
         pg_catalog.has_function_privilege('authenticated', to_regprocedure('public.current_customer_id()'), 'EXECUTE')
  union all
  select 'is_admin(uuid) authenticated allowed',
         pg_catalog.has_function_privilege('authenticated', to_regprocedure('public.is_admin(uuid)'), 'EXECUTE')
  union all
  select 'calls anon INSERT denied or table absent',
         to_regclass('public.calls') is null
         or not pg_catalog.has_table_privilege('anon', 'public.calls', 'INSERT')
  union all
  select 'calls authenticated INSERT denied or table absent',
         to_regclass('public.calls') is null
         or not pg_catalog.has_table_privilege('authenticated', 'public.calls', 'INSERT')
  union all
  select 'notifications anon INSERT denied or table absent',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_table_privilege('anon', 'public.notifications', 'INSERT')
  union all
  select 'notifications authenticated INSERT denied or table absent',
         to_regclass('public.notifications') is null
         or not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'INSERT')
  union all
  select 'ai_change_requests RLS enabled or table absent',
         to_regclass('public.ai_change_requests') is null
         or exists (
           select 1 from pg_catalog.pg_class c
           where c.oid = to_regclass('public.ai_change_requests') and c.relrowsecurity
         )
  union all
  select 'ai_change_requests canonical policies present or table absent',
         to_regclass('public.ai_change_requests') is null
         or 5 = (
           select count(*) from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'ai_change_requests'
             and policyname in (
               'ai_change_requests_admin_all',
               'ai_change_requests_customer_select_own',
               'ai_change_requests_customer_insert_own',
               'ai_change_requests_customer_update_own',
               'ai_change_requests_customer_delete_own'
             )
         )
  union all
  select 'ai_change_requests authenticated_read_all removed or table absent',
         to_regclass('public.ai_change_requests') is null
         or not exists (
           select 1 from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'ai_change_requests'
             and policyname = 'authenticated_read_all'
         )
  union all
  select 'system_config admin-only SELECT policy or table absent',
         to_regclass('public.system_config') is null
         or exists (
           select 1 from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'system_config'
             and policyname = 'system_config_admin_select'
             and cmd = 'SELECT'
         )
  union all
  select 'system_config has no additional SELECT/ALL policies or table absent',
         to_regclass('public.system_config') is null
         or not exists (
           select 1 from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'system_config'
             and cmd in ('SELECT', 'ALL')
             and policyname <> 'system_config_admin_select'
         )
)
select check_name, case when passed then 'PASS' else 'FAIL' end as result
from checks
order by check_name;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('calls', 'notifications', 'ai_change_requests', 'system_config')
order by tablename, policyname;

select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('calls', 'notifications', 'ai_change_requests', 'system_config')
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;
