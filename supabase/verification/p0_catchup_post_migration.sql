-- READ ONLY: nach 2026-08-08_p0_security_foundation_catchup.sql laufen lassen.
-- Jede FAIL-Zeile muss vor einem Produktions-Deploy geklaert sein.

with checks as (
  -- ── Autorisierung: Rolle UND Status ───────────────────────────────────
  select 'is_admin(uuid) prueft Rolle' as check_name,
         (select p.prosrc ~* 'role' from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='is_admin'
            and pg_get_function_identity_arguments(p.oid)='p_user_id uuid') as passed
  union all
  select 'is_admin(uuid) prueft Status',
         (select p.prosrc ~* 'status' from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='is_admin'
            and pg_get_function_identity_arguments(p.oid)='p_user_id uuid')
  union all
  select 'is_admin() leitet auf is_admin(auth.uid()) weiter',
         (select p.prosrc ~* 'is_admin\(\s*auth\.uid\(\)\s*\)' from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='is_admin'
            and pg_get_function_identity_arguments(p.oid)='')
  union all
  select 'is_super_admin() normalisiert die Rolle',
         (select p.prosrc ~* 'replace' and p.prosrc ~* 'status' from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='is_super_admin')
  union all
  -- Der Sprengsatz: is_admin(uuid) darf KEINEN DEFAULT bekommen, sonst wird
  -- jeder argumentlose Aufruf mehrdeutig und alle abhaengigen Policies fallen aus.
  select 'is_admin(uuid) hat KEINEN DEFAULT (Mehrdeutigkeit vermieden)',
         (select pg_get_function_identity_arguments(p.oid) = pg_get_function_arguments(p.oid)
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='is_admin'
            and pg_get_function_identity_arguments(p.oid)='p_user_id uuid')
  union all
  -- Der eigentliche Beweis, dass nichts mehrdeutig ist: der Aufruf geht durch.
  select 'argumentloser Aufruf is_admin() ist eindeutig aufloesbar',
         (select public.is_admin() is not null)
  union all
  select 'abhaengige Policies weiterhin vorhanden (OID erhalten)',
         (select pg_catalog.count(*) from pg_catalog.pg_policy p
          where coalesce(pg_get_expr(p.polqual,p.polrelid),'') ~ 'is_admin\(\)'
             or coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~ 'is_admin\(\)') >= 60
  union all
  select 'mindestens ein Admin besteht die neue Pruefung',
         exists (select 1 from public.admins a join auth.users au on au.id=a.id
                 where pg_catalog.replace(pg_catalog.lower(coalesce(a.role,'')),'_','-')
                         in ('super-admin','admin','support','owner','ops')
                   and pg_catalog.replace(pg_catalog.lower(coalesce(a.status,'active')),'_','-')
                         in ('active','enabled'))

  -- ── search_path gepinnt ───────────────────────────────────────────────
  union all
  select 'search_path gepinnt: ' || f.sig,
         (select p.proconfig is not null from pg_catalog.pg_proc p where p.oid = to_regprocedure(f.sig))
  from (values ('public.is_admin(uuid)'), ('public.is_admin()'), ('public.is_super_admin()'),
               ('public.current_customer_id()'), ('public.ensure_user_profile(text,text,text)'),
               ('public.delete_auth_user_data(uuid)'), ('public.handle_auth_user_created()'),
               ('public.cleanup_old_notifications()')) f(sig)
  where to_regprocedure(f.sig) is not null

  -- ── Funktionsrechte: anon draussen ────────────────────────────────────
  union all
  select 'anon ohne EXECUTE: ' || f.sig,
         not pg_catalog.has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE')
  from (values ('public.is_admin(uuid)'), ('public.is_admin()'), ('public.is_super_admin()'),
               ('public.current_customer_id()'), ('public.ensure_user_profile(text,text,text)'),
               ('public.delete_auth_user_data(uuid)'), ('public.handle_auth_user_created()'),
               ('public.cleanup_old_notifications()'), ('public.next_credit_note_number_v1()'),
               ('public.next_customer_code(integer)')) f(sig)
  where to_regprocedure(f.sig) is not null

  union all
  select 'authenticated ohne EXECUTE (nur Server): ' || f.sig,
         not pg_catalog.has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')
  from (values ('public.delete_auth_user_data(uuid)'), ('public.handle_auth_user_created()'),
               ('public.cleanup_old_notifications()'), ('public.next_credit_note_number_v1()'),
               ('public.next_customer_code(integer)')) f(sig)
  where to_regprocedure(f.sig) is not null

  union all
  -- Diese muss authenticated behalten, sonst brechen RLS-Praedikate und Login.
  select 'authenticated behaelt EXECUTE: ' || f.sig,
         pg_catalog.has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')
  from (values ('public.is_admin(uuid)'), ('public.is_admin()'), ('public.is_super_admin()'),
               ('public.current_customer_id()'), ('public.ensure_user_profile(text,text,text)')) f(sig)
  where to_regprocedure(f.sig) is not null

  union all
  select 'service_role behaelt EXECUTE: ' || f.sig,
         pg_catalog.has_function_privilege('service_role', to_regprocedure(f.sig), 'EXECUTE')
  from (values ('public.delete_auth_user_data(uuid)'), ('public.next_credit_note_number_v1()')) f(sig)
  where to_regprocedure(f.sig) is not null

  -- ── Tabellen ──────────────────────────────────────────────────────────
  union all
  select 'calls: authenticated INSERT zurueckgenommen',
         to_regclass('public.calls') is null
         or not pg_catalog.has_table_privilege('authenticated', 'public.calls', 'INSERT')
  union all
  select 'calls: anon INSERT zurueckgenommen',
         to_regclass('public.calls') is null
         or not pg_catalog.has_table_privilege('anon', 'public.calls', 'INSERT')
  union all
  select 'calls: service_role INSERT erhalten',
         to_regclass('public.calls') is null
         or pg_catalog.has_table_privilege('service_role', 'public.calls', 'INSERT')
  union all
  select 'calls: authenticated SELECT erhalten (Dashboard liest)',
         to_regclass('public.calls') is null
         or pg_catalog.has_table_privilege('authenticated', 'public.calls', 'SELECT')
  union all
  select 'system_config: anon SELECT zurueckgenommen',
         to_regclass('public.system_config') is null
         or not pg_catalog.has_table_privilege('anon', 'public.system_config', 'SELECT')
  union all
  select 'system_config: P0-Policy system_config_admin_select vorhanden',
         to_regclass('public.system_config') is null
         or exists (select 1 from pg_catalog.pg_policy
                    where polrelid='public.system_config'::regclass
                      and polname='system_config_admin_select')
  union all
  select 'system_config: keine Lese-Policy auf PUBLIC',
         to_regclass('public.system_config') is null
         or not exists (select 1 from pg_catalog.pg_policy p
                        where p.polrelid='public.system_config'::regclass
                          and p.polcmd in ('r','*') and 0 = any(p.polroles))

  -- ── Bereits erledigte Schritte duerfen nicht zurueckfallen ────────────
  union all
  select 'notifications weiterhin gehaertet (2026-08-08)',
         to_regclass('public.notifications') is null
         or exists (select 1 from pg_catalog.pg_policy p
                    where p.polrelid='public.notifications'::regclass
                      and p.polname='notifications_select'
                      and pg_get_expr(p.polqual,p.polrelid) like '%current_customer_id()%')
  union all
  select 'ai_change_requests weiterhin gehaertet (2026-08-08)',
         to_regclass('public.ai_change_requests') is null
         or exists (select 1 from pg_catalog.pg_policy
                    where polrelid='public.ai_change_requests'::regclass
                      and polname='ai_change_requests_customer_select_own')
  union all
  select 'ensure_user_profile(text,text) bleibt entfernt',
         to_regprocedure('public.ensure_user_profile(text,text)') is null
)
select
  case when passed then 'PASS' else 'FAIL' end as status,
  check_name
from checks
order by passed, check_name;
