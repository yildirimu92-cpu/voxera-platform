-- READ ONLY: vor 2026-08-08_ai_change_requests_tenant_isolation_reassert.sql
-- laufen lassen. Hält den Ist-Zustand als Rollback-Evidenz fest und zeigt das
-- Ausmass der Abweichung zwischen den Migrationsdateien und der Datenbank.

-- 1. Policies auf ai_change_requests, mit Rollenbindung und Prädikaten.
--    Erwartet vor der Migration: authenticated_read_all und
--    customer_own_requests, beide TO PUBLIC.
select
  'policy' as section,
  p.polname as name,
  case p.polcmd
    when 'r' then 'SELECT' when 'a' then 'INSERT'
    when 'w' then 'UPDATE' when 'd' then 'DELETE' when '*' then 'ALL'
  end as cmd,
  (0 = any(p.polroles)) as applies_to_public,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr,
  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_catalog.pg_policy p
where p.polrelid = 'public.ai_change_requests'::regclass
order by p.polname;

-- 2. Effektive Rechte je browser-erreichbarer Rolle.
select
  'grant' as section,
  role_name,
  pg_catalog.has_table_privilege(role_name, 'public.ai_change_requests', 'SELECT') as sel,
  pg_catalog.has_table_privilege(role_name, 'public.ai_change_requests', 'INSERT') as ins,
  pg_catalog.has_table_privilege(role_name, 'public.ai_change_requests', 'UPDATE') as upd,
  pg_catalog.has_table_privilege(role_name, 'public.ai_change_requests', 'DELETE') as del
from (values ('anon'), ('authenticated'), ('service_role')) as t(role_name);

-- 3. Admin-Pfad: die neue Policy hängt an is_admin(). Wenn hier keine Zeile
--    would_pass_is_admin = true liefert, verliert das Admin-Panel nach der
--    Migration den Zugriff -- dann NICHT anwenden.
select
  'admin_path' as section,
  a.id,
  a.role,
  a.status,
  (au.id is not null) as has_matching_auth_user,
  (pg_catalog.replace(pg_catalog.lower(coalesce(a.role, '')), '_', '-')
     in ('super-admin', 'admin', 'support', 'owner', 'ops')
   and pg_catalog.replace(pg_catalog.lower(coalesce(a.status, 'active')), '_', '-')
     in ('active', 'enabled')) as would_pass_is_admin
from public.admins a
left join auth.users au on au.id = a.id
order by a.role;

-- 4. Kundenpfad: Zeilen je Mandant. Nach der Migration sieht ein Kunde nur
--    noch die eigenen; die Summe pro Mandant muss unverändert bleiben.
select 'rows_per_tenant' as section, customer_id, count(*) as rows
from public.ai_change_requests
group by customer_id
order by customer_id;

-- 5. Zeilen ohne passenden Mandanten -- weder vorher noch nachher lesbar,
--    hier festgehalten, damit die Zahl später nicht für eine Regression
--    gehalten wird.
select 'orphan_rows' as section, r.customer_id, count(*) as rows
from public.ai_change_requests r
where not exists (select 1 from public.customers c where c.id = r.customer_id)
group by r.customer_id
order by r.customer_id;

-- 6. Umfang der Abweichung: was P0 (2026-07-28) anlegen bzw. zurücknehmen
--    sollte und was davon live ist. Alles, was hier false zeigt, ist auf der
--    Datenbank nicht wirksam -- unabhängig davon, dass die Migration im
--    Repository liegt und gelaufen sein muss (ihre Funktionen existieren).
select 'p0_drift' as section, kind, obj, live from (
  select 'function' as kind, 'current_customer_id' as obj,
         (to_regprocedure('public.current_customer_id()') is not null) as live
  union all select 'function', 'ensure_user_profile',
         to_regprocedure('public.ensure_user_profile(text,text,text)') is not null
  union all select 'function', 'is_admin',
         to_regprocedure('public.is_admin(uuid)') is not null
  union all select 'policy', 'ai_change_requests_admin_all',
         exists (select 1 from pg_catalog.pg_policy
                 where polrelid = 'public.ai_change_requests'::regclass
                   and polname = 'ai_change_requests_admin_all')
  union all select 'policy', 'ai_change_requests_customer_select_own',
         exists (select 1 from pg_catalog.pg_policy
                 where polrelid = 'public.ai_change_requests'::regclass
                   and polname = 'ai_change_requests_customer_select_own')
  union all select 'policy', 'system_config_admin_select',
         exists (select 1 from pg_catalog.pg_policy
                 where polrelid = 'public.system_config'::regclass
                   and polname = 'system_config_admin_select')
  union all select 'revoke', 'anon INSERT ai_change_requests revoked',
         not pg_catalog.has_table_privilege('anon', 'public.ai_change_requests', 'INSERT')
  union all select 'revoke', 'anon INSERT notifications revoked',
         not pg_catalog.has_table_privilege('anon', 'public.notifications', 'INSERT')
  union all select 'revoke', 'anon SELECT system_config revoked',
         not pg_catalog.has_table_privilege('anon', 'public.system_config', 'SELECT')
  union all select 'revoke', 'authenticated INSERT calls revoked',
         not pg_catalog.has_table_privilege('authenticated', 'public.calls', 'INSERT')
) d
order by kind, obj;
