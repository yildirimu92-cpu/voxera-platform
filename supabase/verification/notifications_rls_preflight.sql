-- READ ONLY: run before 2026-08-08_notifications_rls_current_customer_id.sql.
-- Captures the pre-migration state of public.notifications as rollback
-- evidence. Nothing here needs to "pass" -- it records what is there.

-- 1. Current policies, with the role scope that matters (TO PUBLIC vs a
--    concrete role) and the predicates being replaced.
select
  'policy' as section,
  p.polname as name,
  case p.polcmd
    when 'r' then 'SELECT' when 'a' then 'INSERT'
    when 'w' then 'UPDATE' when 'd' then 'DELETE' when '*' then 'ALL'
  end as cmd,
  (0 = any(p.polroles)) as applies_to_public,
  coalesce(
    (select string_agg(r.rolname, ',' order by r.rolname)
       from pg_catalog.pg_roles r where r.oid = any(p.polroles)),
    '(public)'
  ) as roles,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr,
  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_catalog.pg_policy p
where p.polrelid = 'public.notifications'::regclass;

-- 2. Effective table privileges per browser-reachable role.
select
  'grant' as section,
  role_name,
  pg_catalog.has_table_privilege(role_name, 'public.notifications', 'SELECT') as sel,
  pg_catalog.has_table_privilege(role_name, 'public.notifications', 'INSERT') as ins,
  pg_catalog.has_table_privilege(role_name, 'public.notifications', 'UPDATE') as upd,
  pg_catalog.has_table_privilege(role_name, 'public.notifications', 'DELETE') as del
from (values ('anon'), ('authenticated'), ('service_role')) as t(role_name);

-- 3. Column-level UPDATE grants (post-migration this must be read_at only).
select 'column_grant' as section, grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'notifications'
  and grantee in ('anon', 'authenticated')
order by grantee, column_name, privilege_type;

-- 4. Row visibility baseline: how many rows each tenant owns, and whether
--    the old and new predicates agree for every customer that has an auth
--    binding. rows_old <> rows_new anywhere means the migration would change
--    who can read what -- investigate before applying.
select
  'visibility' as section,
  c.id as customer_id,
  c.auth_user_id,
  (select u.customer_id from public.users u where u.id = c.auth_user_id limit 1) as resolved_by_current_customer_id,
  (select count(*) from public.notifications n
     where exists (select 1 from public.customers c2
                    where c2.id = n.customer_id and c2.auth_user_id = c.auth_user_id)) as rows_old_predicate,
  (select count(*) from public.notifications n
     where n.customer_id = (select u.customer_id from public.users u where u.id = c.auth_user_id limit 1)) as rows_new_predicate
from public.customers c
where c.auth_user_id is not null
order by c.id;

-- 5. Orphan rows: notifications whose customer_id has no customers row.
--    Unreadable under both the old and the new predicate; listed so the
--    count is not mistaken for a regression afterwards.
select 'orphan_rows' as section, n.customer_id, count(*) as rows
from public.notifications n
where not exists (select 1 from public.customers c where c.id = n.customer_id)
group by n.customer_id
order by n.customer_id;
