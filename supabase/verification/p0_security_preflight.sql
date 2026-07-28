-- READ ONLY: run before 2026-07-28_p0_security_foundation.sql.
-- Save the complete result as the rollback evidence. Do not share secret values.

select
  current_database() as database_name,
  current_user as execution_role,
  now() as captured_at;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.proacl as acl,
  p.proconfig as function_config,
  pg_catalog.pg_get_userbyid(p.proowner) as owner
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'delete_auth_user_data',
    'ensure_user_profile',
    'cleanup_old_notifications',
    'handle_auth_user_created',
    'current_customer_id',
    'is_admin',
    'is_super_admin',
    'next_customer_code'
  )
order by p.proname, identity_arguments;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'delete_auth_user_data',
    'ensure_user_profile',
    'cleanup_old_notifications',
    'handle_auth_user_created',
    'current_customer_id',
    'is_admin',
    'is_super_admin',
    'next_customer_code'
  )
order by p.proname, identity_arguments;

select
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where action_statement ilike any (array[
  '%handle_auth_user_created%',
  '%cleanup_old_notifications%',
  '%next_customer_code%'
])
order by event_object_schema, event_object_table, trigger_name;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('calls', 'notifications', 'ai_change_requests', 'system_config')
order by tablename, policyname;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('calls', 'notifications', 'ai_change_requests', 'system_config')
order by c.relname;

select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('calls', 'notifications', 'ai_change_requests', 'system_config')
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

select
  table_schema,
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('calls', 'notifications', 'ai_change_requests', 'system_config')
  and column_name in ('customer_id', 'elevenlabs_conversation_id', 'key', 'value')
order by table_name, ordinal_position;

select
  dep_ns.nspname as dependent_schema,
  dep_proc.proname as dependent_function,
  pg_catalog.pg_get_function_identity_arguments(dep_proc.oid) as dependent_arguments,
  ref_ns.nspname as referenced_schema,
  ref_proc.proname as referenced_function,
  pg_catalog.pg_get_function_identity_arguments(ref_proc.oid) as referenced_arguments
from pg_catalog.pg_depend d
join pg_catalog.pg_proc dep_proc on dep_proc.oid = d.objid
join pg_catalog.pg_namespace dep_ns on dep_ns.oid = dep_proc.pronamespace
join pg_catalog.pg_proc ref_proc on ref_proc.oid = d.refobjid
join pg_catalog.pg_namespace ref_ns on ref_ns.oid = ref_proc.pronamespace
where ref_ns.nspname = 'public'
  and ref_proc.proname in (
    'delete_auth_user_data', 'ensure_user_profile', 'cleanup_old_notifications',
    'handle_auth_user_created', 'current_customer_id', 'is_admin',
    'is_super_admin', 'next_customer_code'
  )
order by referenced_function, dependent_function;
