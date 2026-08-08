-- READ ONLY: vor 2026-08-08_p0_security_foundation_catchup.sql laufen lassen.
-- Haelt den Ist-Zustand als Rollback-Evidenz fest.

-- 1. Autorisierungsfunktionen: Rumpf, search_path, Rechte.
select 'A_funktion' as sec,
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as detail,
  'prueft_rolle=' || (p.prosrc ~* 'role')::text
  || ' prueft_status=' || (p.prosrc ~* 'status')::text
  || ' search_path=' || coalesce(p.proconfig::text, 'NICHT GESETZT')
  || ' hat_default=' || (pg_get_function_identity_arguments(p.oid) <> pg_get_function_arguments(p.oid))::text as info
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_admin','is_super_admin','current_customer_id','ensure_user_profile',
                    'delete_auth_user_data','handle_auth_user_created','cleanup_old_notifications',
                    'next_credit_note_number_v1','next_customer_code','next_invoice_number_v1','next_offer_number_v1')

union all
-- 2. Wer darf diese Funktionen heute ausfuehren?
select 'B_funktionsrechte',
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
  'anon=' || pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')::text
  || ' authenticated=' || pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
  || ' service_role=' || pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')::text
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_admin','is_super_admin','current_customer_id','ensure_user_profile',
                    'delete_auth_user_data','handle_auth_user_created','cleanup_old_notifications',
                    'next_credit_note_number_v1','next_customer_code')

union all
-- 3. Tabellenrechte, die der Nachzug anfasst.
select 'C_tabellenrechte', t.tbl || ' / ' || t.rolle,
  'SELECT=' || pg_catalog.has_table_privilege(t.rolle, t.tbl, 'SELECT')::text
  || ' INSERT=' || pg_catalog.has_table_privilege(t.rolle, t.tbl, 'INSERT')::text
from (
  select tbl, rolle from
    (values ('public.calls'), ('public.system_config')) a(tbl),
    (values ('anon'), ('authenticated'), ('service_role')) b(rolle)
  where to_regclass(tbl) is not null
) t

union all
-- 4. Lese-Policies auf system_config (werden ersetzt).
select 'D_system_config_policy', p.polname,
  'cmd=' || p.polcmd::text || ' to_public=' || (0 = any(p.polroles))::text
  || ' using=' || coalesce(pg_catalog.left(pg_get_expr(p.polqual, p.polrelid), 80), '-')
from pg_catalog.pg_policy p
where to_regclass('public.system_config') is not null
  and p.polrelid = 'public.system_config'::regclass

union all
-- 5. Admin-Pfad: bestuende jemand die neue Rollen-/Statuspruefung? Wenn hier
--    keine Zeile mit bestuende_neue_pruefung=true steht, bricht die Migration
--    ab -- und das ist richtig so.
select 'E_admin_pfad', a.id::text,
  'role=' || coalesce(a.role, '(null)')
  || ' status=' || coalesce(a.status, '(null)')
  || ' hat_auth_user=' || (au.id is not null)::text
  || ' bestuende_neue_pruefung='
  || (pg_catalog.replace(pg_catalog.lower(coalesce(a.role, '')), '_', '-')
        in ('super-admin','admin','support','owner','ops')
      and pg_catalog.replace(pg_catalog.lower(coalesce(a.status, 'active')), '_', '-')
        in ('active','enabled'))::text
from public.admins a
left join auth.users au on au.id = a.id

union all
-- 6. Wie viele Policies haengen an is_admin()? Diese Zahl muss nach dem
--    Nachzug unveraendert sein -- create or replace erhaelt die OID.
select 'F_abhaengige_policies', 'nutzen is_admin() ohne Argument',
  pg_catalog.count(*)::text
from pg_catalog.pg_policy p
where coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'is_admin\(\)'
   or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'is_admin\(\)'

order by sec, detail;
