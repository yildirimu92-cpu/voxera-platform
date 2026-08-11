-- READ ONLY. Katalogseitige Security-Invarianten der Produktions-DB.
--
-- Laeuft als voxera_ci_verifier gegen die echte Datenbank (siehe
-- scripts/verify-db-security-invariants.mjs). Prueft, was im Katalog steht --
-- Policies, Grants, Funktionssignaturen, search_path. Das Laufzeitverhalten
-- prueft db_security_invariants_behavior.sql.
--
-- Ausgabekontrakt: jede Zeile ist genau
--     STATUS <tab> GRUPPE <tab> NAME <tab> DETAIL
-- mit STATUS aus PASS | FAIL | SKIP | INFO. INFO-Zeilen sind keine Urteile,
-- sondern Rohdaten, die der Node-Runner gegen eine eingecheckte Baseline
-- diffed (Alt-Schuld eingefroren, Neuzugaenge rot).

-- Aufruf (so ruft scripts/verify-db-security-invariants.mjs die Datei auf):
--   psql "$SUPABASE_DB_URL" -X -q -A -t -F '<tab>' -v ON_ERROR_STOP=1 -f <datei>
-- Das Feldtrennzeichen wird bewusst NUR ueber die Kommandozeile gesetzt: ein
-- `\pset fieldsep` in der Datei wuerde die Option ueberschreiben, und ob psql
-- die Escape-Sequenz '\t' zum Tabulator aufloest, haengt an der Version. Eine
-- Quelle, keine zweite, die sie still aushebeln kann.
\pset tuples_only on
\pset format unaligned
\pset pager off

-- ═══ Gruppe F1: Funktionsinventar und Signaturen ═══════════════════════════
with checks(name, ok, detail) as (
  select 'current_customer_id() existiert',
         to_regprocedure('public.current_customer_id()') is not null, ''
  union all
  select 'is_admin() existiert',
         to_regprocedure('public.is_admin()') is not null, ''
  union all
  select 'is_admin(uuid) existiert',
         to_regprocedure('public.is_admin(uuid)') is not null, ''
  union all
  select 'is_super_admin() existiert',
         to_regprocedure('public.is_super_admin()') is not null, ''
  union all
  select 'ensure_user_profile(text,text,text) existiert',
         to_regprocedure('public.ensure_user_profile(text,text,text)') is not null, ''
  union all
  -- Die Alt-Ueberladung wurde in PR #832 entfernt; sie darf nicht zurueckkommen.
  select 'ensure_user_profile(text,text) bleibt entfernt',
         to_regprocedure('public.ensure_user_profile(text,text)') is null, ''
  union all
  -- DER Sprengsatz aus PR #833: bekaeme is_admin(uuid) wieder ein DEFAULT,
  -- waere jeder argumentlose Aufruf mehrdeutig und die 62 davon abhaengigen
  -- Policies fielen auf einen Schlag aus.
  select 'is_admin(uuid) hat KEIN DEFAULT-Argument',
         coalesce((select pg_get_function_identity_arguments(p.oid) = pg_get_function_arguments(p.oid)
                   from pg_catalog.pg_proc as p
                   join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'is_admin'
                     and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid'), false),
         ''
  union all
  select 'genau zwei is_admin-Ueberladungen (keine dritte Mehrdeutigkeit)',
         2 = (select pg_catalog.count(*) from pg_catalog.pg_proc as p
              join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'is_admin'),
         (select pg_catalog.string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
          from pg_catalog.pg_proc as p
          join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'is_admin')
  union all
  select 'is_admin(uuid) prueft Rolle UND Status',
         coalesce((select p.prosrc ~* 'role' and p.prosrc ~* 'status'
                   from pg_catalog.pg_proc as p
                   join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'is_admin'
                     and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid'), false),
         ''
  union all
  select 'is_super_admin() prueft Status und normalisiert die Rolle',
         coalesce((select p.prosrc ~* 'status' and p.prosrc ~* 'replace'
                   from pg_catalog.pg_proc as p
                   join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'is_super_admin'), false),
         ''
  union all
  select 'is_admin() leitet auf is_admin(auth.uid()) weiter',
         coalesce((select p.prosrc ~* 'is_admin\(\s*auth\.uid\(\)\s*\)'
                   from pg_catalog.pg_proc as p
                   join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'is_admin'
                     and pg_get_function_identity_arguments(p.oid) = ''), false),
         ''
)
select case when ok then 'PASS' else 'FAIL' end, 'F1-funktionen', name,
       replace(replace(coalesce(detail, ''), chr(10), ' '), chr(9), ' ')
from checks;

-- ═══ Gruppe F2: search_path auf SECURITY-DEFINER-Funktionen ════════════════
-- Generisch statt Positivliste: eine neue, ungepinnte SECURITY-DEFINER-Funktion
-- soll den Check rot machen, ohne dass jemand daran denken muss, sie hier
-- nachzutragen. Eine ungepinnte SECDEF-Funktion ist ein Rechteausweitungspfad.
select case when p.proconfig is not null
             and exists (select 1 from unnest(p.proconfig) as c where c like 'search\_path=%')
            then 'PASS' else 'FAIL' end,
       'F2-search-path',
       'search_path gepinnt: ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       coalesce(array_to_string(p.proconfig, ','), '<ungepinnt>')
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname;

-- ═══ Gruppe F3: EXECUTE-Rechte auf den Autorisierungsfunktionen ════════════
-- anon darf keine der Autorisierungsfunktionen aufrufen.
select case when not pg_catalog.has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE')
            then 'PASS' else 'FAIL' end,
       'F3-funktionsrechte', 'anon ohne EXECUTE: ' || f.sig, ''
from (values
  ('public.is_admin(uuid)'), ('public.is_admin()'), ('public.is_super_admin()'),
  ('public.current_customer_id()'), ('public.ensure_user_profile(text,text,text)'),
  ('public.delete_auth_user_data(uuid)'), ('public.handle_auth_user_created()'),
  ('public.cleanup_old_notifications()'), ('public.next_credit_note_number_v1()'),
  ('public.next_customer_code(integer)'),
  ('public.ci_security_probe_census(text)'), ('public.ci_security_probe_identity()')
) as f(sig)
where to_regprocedure(f.sig) is not null;

-- Rein serverseitige Funktionen: auch authenticated bleibt draussen.
select case when not pg_catalog.has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')
            then 'PASS' else 'FAIL' end,
       'F3-funktionsrechte', 'authenticated ohne EXECUTE: ' || f.sig, ''
from (values
  ('public.delete_auth_user_data(uuid)'), ('public.handle_auth_user_created()'),
  ('public.cleanup_old_notifications()'), ('public.next_credit_note_number_v1()'),
  ('public.next_customer_code(integer)'),
  ('public.ci_security_probe_census(text)'), ('public.ci_security_probe_identity()')
) as f(sig)
where to_regprocedure(f.sig) is not null;

-- Gegenrichtung: diese MUSS authenticated behalten, sonst brechen RLS-Praedikate
-- und der Login. Ein Check, der nur Verschaerfungen prueft, uebersieht die
-- Ausfaelle, die durch Ueberhaertung entstehen.
select case when pg_catalog.has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')
            then 'PASS' else 'FAIL' end,
       'F3-funktionsrechte', 'authenticated behaelt EXECUTE: ' || f.sig, ''
from (values
  ('public.is_admin(uuid)'), ('public.is_admin()'), ('public.is_super_admin()'),
  ('public.current_customer_id()'), ('public.ensure_user_profile(text,text,text)')
) as f(sig)
where to_regprocedure(f.sig) is not null;

select case when pg_catalog.has_function_privilege('service_role', to_regprocedure(f.sig), 'EXECUTE')
            then 'PASS' else 'FAIL' end,
       'F3-funktionsrechte', 'service_role behaelt EXECUTE: ' || f.sig, ''
from (values
  ('public.delete_auth_user_data(uuid)'), ('public.next_credit_note_number_v1()'),
  ('public.next_customer_code(integer)')
) as f(sig)
where to_regprocedure(f.sig) is not null;

-- ═══ Gruppe F4: RLS aktiv ══════════════════════════════════════════════════
-- Aggregat ohne HAVING: es muss in jedem Fall genau eine Zeile herauskommen.
-- Ein Check, der bei Verletzung gar nichts ausgibt, ist ein stiller Pass -- und
-- damit exakt der Fehlermodus, den dieser Workflow abschaffen soll.
select case when pg_catalog.count(*) filter (where not c.relrowsecurity) = 0
            then 'PASS' else 'FAIL' end,
       'F4-rls', 'alle Tabellen in public haben RLS aktiv',
       pg_catalog.count(*)::text || ' Tabellen, davon ohne RLS: '
         || (pg_catalog.count(*) filter (where not c.relrowsecurity))::text
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

-- Tabellen ohne RLS gehen als Rohdaten an den Baseline-Diff (aktuell: keine).
select 'INFO', 'rls-off', c.relname, ''
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by c.relname;

-- ═══ Gruppe F5: benannte Policies der P0-Kette ═════════════════════════════
select case when exists (
         select 1 from pg_catalog.pg_policy as p
         where p.polrelid = to_regclass('public.' || t.tbl)
           and p.polname = t.pol
       ) then 'PASS' else 'FAIL' end,
       'F5-policies', t.tbl || '.' || t.pol || ' vorhanden', t.quelle
from (values
  ('notifications',      'notifications_select',                     'PR #829'),
  ('notifications',      'notifications_update',                     'PR #829'),
  ('notifications',      'notifications_service_insert',             'PR #829'),
  ('ai_change_requests', 'ai_change_requests_admin_all',             'PR #830'),
  ('ai_change_requests', 'ai_change_requests_customer_select_own',   'PR #830'),
  ('ai_change_requests', 'ai_change_requests_customer_insert_own',   'PR #830'),
  ('ai_change_requests', 'ai_change_requests_customer_update_own',   'PR #830'),
  ('ai_change_requests', 'ai_change_requests_customer_delete_own',   'PR #830'),
  ('system_config',      'system_config_admin_select',               'P0 2026-07-28'),
  ('contracts',          'contracts_admin_all',                      'RLS-Haertung 2026-08-06'),
  ('contracts',          'contracts_customer_select_own',            'RLS-Haertung 2026-08-06'),
  ('subscriptions',      'subscriptions_admin_all',                  'RLS-Haertung 2026-08-06'),
  ('subscriptions',      'subscriptions_customer_select_own',        'RLS-Haertung 2026-08-06'),
  ('offers',             'offers_admin_all',                         'RLS-Haertung 2026-08-06'),
  ('offers',             'offers_customer_select_own',               'RLS-Haertung 2026-08-06'),
  ('invoices',           'invoices_admin_all',                       'RLS-Haertung 2026-08-06'),
  ('invoices',           'invoices_customer_select_own',             'RLS-Haertung 2026-08-06'),
  ('customer_addons',    'customer_addons_admin_all',                'RLS-Haertung 2026-08-06'),
  ('customer_addons',    'customer_addons_customer_select_own',      'RLS-Haertung 2026-08-06'),
  ('calls',              'calls_select_own',                         'P0 2026-07-28'),
  ('calls',              'calls_select_admin',                       'P0 2026-07-28'),
  ('customers',          'customers_select_own',                     'P0 2026-07-28'),
  ('customers',          'customers_select_admin',                   'P0 2026-07-28')
) as t(tbl, pol, quelle)
where to_regclass('public.' || t.tbl) is not null;

-- users_self_update wurde bewusst entfernt (Selbst-Update auf public.users).
select case when not exists (
         select 1 from pg_catalog.pg_policy as p
         where p.polrelid = to_regclass('public.users') and p.polname = 'users_self_update'
       ) then 'PASS' else 'FAIL' end,
       'F5-policies', 'users.users_self_update bleibt entfernt', 'RLS-Haertung 2026-08-06';

-- Die 62 Policies, die an is_admin() haengen. Faellt diese Zahl ab, hat jemand
-- die Funktion neu angelegt statt ersetzt (OID-Wechsel) -- der Fehlermodus, den
-- PR #833 gezielt vermieden hat.
select case when pg_catalog.count(*) >= 60 then 'PASS' else 'FAIL' end,
       'F5-policies', 'Policies mit is_admin()-Abhaengigkeit >= 60',
       pg_catalog.count(*)::text || ' gefunden'
from pg_catalog.pg_policy as p
where coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'is_admin\(\)'
   or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'is_admin\(\)';

-- Keine pauschal erlaubende Policy auf einer Mandantentabelle. `using (true)`
-- neben den engen Policies wuerde die Mandantentrennung lautlos aushebeln --
-- Policies sind permissiv, sie ODERn sich.
select case when pg_catalog.count(*) = 0 then 'PASS' else 'FAIL' end,
       'F5-policies', 'keine using(true)-Policy auf Mandantentabellen',
       coalesce(pg_catalog.string_agg(detail, '; '), '')
from (
  select c.relname || '.' || p.polname as detail
  from pg_catalog.pg_policy as p
  join pg_catalog.pg_class as c on c.oid = p.polrelid
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('users', 'customers', 'calls', 'notifications', 'ai_change_requests',
                      'contracts', 'subscriptions', 'invoices', 'offers', 'customer_addons',
                      'voxera_cases', 'customer_tasks', 'system_config')
    and p.polcmd in ('r', '*')
    and btrim(coalesce(pg_get_expr(p.polqual, p.polrelid), '')) = 'true'
) as offenders;

-- ═══ Gruppe F6: Grants ═════════════════════════════════════════════════════
-- Nur die Rechte, die nachweislich zurueckgenommen WURDEN. Bewusst NICHT
-- dabei: DELETE auf customers/users/calls und INSERT auf users. Diese Grants
-- bestehen absichtlich -- das Admin-Panel arbeitet als `authenticated` und
-- loescht ueber die Policy `admins_delete_customers`. Sie hier als Verletzung
-- zu fuehren waere eine Annahme, keine Invariante; ein Check, der beim ersten
-- Lauf rot ist, wird abgeschaltet. Stattdessen sind sie in der Baseline
-- eingefroren (jeder NEUE Grant faellt auf), und ob sie tatsaechlich halten,
-- misst Probe D2 in db_security_invariants_behavior.sql zur Laufzeit nach.
select case when not pg_catalog.has_table_privilege('authenticated', 'public.' || t.tbl, t.priv)
            then 'PASS' else 'FAIL' end,
       'F6-grants', 'authenticated ohne ' || t.priv || ' auf ' || t.tbl, ''
from (values
  ('users', 'UPDATE'),
  ('customers', 'UPDATE'),
  ('calls', 'UPDATE'), ('calls', 'INSERT')
) as t(tbl, priv)
where to_regclass('public.' || t.tbl) is not null;

-- Spalten-Allowlists: exakt, nicht "mindestens". Eine zusaetzliche schreibbare
-- Spalte ist genau die Luecke, die 2026-08-07 fuer onboarding_completed
-- nachgezogen werden musste.
-- WICHTIG: hier wird bewusst NICHT ueber die Standard-Sichten abgefragt. Deren
-- Grant-Sichten filtern auf `enabled_roles`, und weil die CI-Rolle NOINHERIT
-- ist, sind `anon` und `authenticated` dort nicht enthalten. Jede Grant-Abfrage
-- darueber liefert unter dieser Rolle null Zeilen -- also "0 statt 4 Spalten"
-- und einen leeren Baseline-Diff, in dem keine Ausweitung mehr auffaellt. Genau
-- diese Klasse von stillem Falschergebnis soll dieser Check abschaffen, nicht
-- selbst produzieren. Die pg_catalog-Funktionen kennen die Filterung nicht.
select case when 4 = (
         select pg_catalog.count(*) from pg_catalog.pg_attribute as a
         where a.attrelid = to_regclass('public.customers') and a.attnum > 0 and not a.attisdropped
           and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
       ) then 'PASS' else 'FAIL' end,
       'F6-grants', 'customers: authenticated-UPDATE auf exakt 4 Spalten',
       coalesce((select pg_catalog.string_agg(a.attname, ',' order by a.attname)
                 from pg_catalog.pg_attribute as a
                 where a.attrelid = to_regclass('public.customers') and a.attnum > 0 and not a.attisdropped
                   and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')), '<keine>')
where to_regclass('public.customers') is not null;

select case when 4 = (
         select pg_catalog.count(*) from pg_catalog.pg_attribute as a
         where a.attrelid = to_regclass('public.customers') and a.attnum > 0 and not a.attisdropped
           and a.attname in ('contact_first_name', 'in_app_notification_settings',
                             'updated_at', 'onboarding_completed')
           and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
       ) then 'PASS' else 'FAIL' end,
       'F6-grants', 'customers: die 4 Spalten sind die erwarteten', ''
where to_regclass('public.customers') is not null;

select case when 4 = (
         select pg_catalog.count(*) from pg_catalog.pg_attribute as a
         where a.attrelid = to_regclass('public.calls') and a.attnum > 0 and not a.attisdropped
           and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
       ) then 'PASS' else 'FAIL' end,
       'F6-grants', 'calls: authenticated-UPDATE auf exakt 4 Spalten',
       coalesce((select pg_catalog.string_agg(a.attname, ',' order by a.attname)
                 from pg_catalog.pg_attribute as a
                 where a.attrelid = to_regclass('public.calls') and a.attnum > 0 and not a.attisdropped
                   and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')), '<keine>')
where to_regclass('public.calls') is not null;

select case when 4 = (
         select pg_catalog.count(*) from pg_catalog.pg_attribute as a
         where a.attrelid = to_regclass('public.calls') and a.attnum > 0 and not a.attisdropped
           and a.attname in ('read_at', 'notes_customer_voxera', 'dashboard_status', 'updated_at')
           and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
       ) then 'PASS' else 'FAIL' end,
       'F6-grants', 'calls: die 4 Spalten sind die erwarteten', ''
where to_regclass('public.calls') is not null;

-- Einzelne Spalten, die unter keinen Umstaenden kundenschreibbar sein duerfen.
select case when not pg_catalog.has_column_privilege('authenticated', 'public.' || t.tbl, t.col, 'UPDATE')
            then 'PASS' else 'FAIL' end,
       'F6-grants', 'authenticated darf ' || t.tbl || '.' || t.col || ' nicht schreiben', ''
from (values
  ('customers', 'ai_instructions'), ('customers', 'status'),
  ('calls', 'duration_seconds'), ('calls', 'transcript'), ('calls', 'call_summary')
) as t(tbl, col)
where to_regclass('public.' || t.tbl) is not null;

-- Gegenrichtung: erhaltene Rechte, ohne die Funktionen ausfallen.
select case when pg_catalog.has_table_privilege(t.role_name, 'public.' || t.tbl, t.priv)
            then 'PASS' else 'FAIL' end,
       'F6-grants', t.role_name || ' behaelt ' || t.priv || ' auf ' || t.tbl, t.grund
from (values
  ('authenticated', 'calls',    'SELECT', 'Dashboard liest Anrufe'),
  ('authenticated', 'users',    'SELECT', 'eigener Datensatz'),
  ('authenticated', 'invoices', 'UPDATE', 'Admin-Mailversand'),
  ('service_role',  'calls',    'INSERT', 'Call-Intake')
) as t(role_name, tbl, priv, grund)
where to_regclass('public.' || t.tbl) is not null;

select case when not pg_catalog.has_table_privilege('anon', 'public.system_config', 'SELECT')
            then 'PASS' else 'FAIL' end,
       'F6-grants', 'anon ohne SELECT auf system_config', ''
where to_regclass('public.system_config') is not null;

-- TRUNCATE. Der einzige Tabellen-Zugriff, auf den RLS NICHT angewandt wird --
-- es gibt keine Policy-Ebene fuer TRUNCATE, das Grant ist die einzige Huerde.
-- Fuer jedes andere Recht auf diesen Tabellen laesst sich sagen "davor steht
-- noch RLS"; hier nicht. Deshalb steht das als harte Invariante hier und nicht
-- als eingefrorene Baseline-Zeile.
--
-- Am 2026-08-09 real nachgemessen (zurueckgerollt): anon und authenticated
-- konnten public.system_config truncieren, authenticated zusaetzlich
-- public.calls. Punktuell zurueckgenommen in
-- 2026-08-09_system_config_calls_residual_grants.sql. Die anschliessende
-- Durchsicht zeigte, dass es nie zwei Tabellen waren -- anon hielt TRUNCATE
-- auf 26, authenticated auf 27 von 45 Tabellen. Vollstaendig zurueckgenommen
-- in 2026-08-09_truncate_grant_sweep.sql.
--
-- Warum das NICHT als Verhaltensprobe in db_security_invariants_behavior.sql
-- steht: ein TRUNCATE laesst sich nicht wie die D-Proben mit `where false`
-- entschaerfen. Eine Probe, die im Fehlerfall die Tabelle leert, ist als
-- Dauerlauf gegen Produktion nicht vertretbar. Der Katalog ist hier die
-- richtige Ebene.
--
-- Bewusst ueber ALLE Tabellen aggregiert statt ueber eine gepflegte Liste:
-- eine Aufzaehlung waere beim naechsten `create table` unvollstaendig, ohne
-- dass es auffiele. Aggregat ohne HAVING, damit auch im Gutfall genau eine
-- Zeile herauskommt -- ein Check, der bei Verletzung nichts ausgibt, ist ein
-- stiller Pass.
select case when pg_catalog.count(*) filter (
              where pg_catalog.has_table_privilege('anon', c.oid, 'TRUNCATE')
                 or pg_catalog.has_table_privilege('authenticated', c.oid, 'TRUNCATE')) = 0
            then 'PASS' else 'FAIL' end,
       'F6-grants', 'keine Tabelle in public mit TRUNCATE fuer anon/authenticated',
       pg_catalog.count(*)::text || ' Tabellen geprueft, davon mit TRUNCATE: '
         || (pg_catalog.count(*) filter (
              where pg_catalog.has_table_privilege('anon', c.oid, 'TRUNCATE')
                 or pg_catalog.has_table_privilege('authenticated', c.oid, 'TRUNCATE')))::text
         || ' -- RLS greift bei TRUNCATE nicht, das Grant ist die einzige Huerde'
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

-- Welche Tabellen es betrifft, falls die Zeile oben rot ist. Als eigene
-- Zeilen, damit im CI-Log ohne Nachfragen steht, wo nachzuziehen ist.
select 'FAIL', 'F6-grants', 'TRUNCATE fuer Browser-Rolle auf ' || c.relname,
       pg_catalog.concat_ws(',',
         case when pg_catalog.has_table_privilege('anon', c.oid, 'TRUNCATE') then 'anon' end,
         case when pg_catalog.has_table_privilege('authenticated', c.oid, 'TRUNCATE') then 'authenticated' end)
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (pg_catalog.has_table_privilege('anon', c.oid, 'TRUNCATE')
    or pg_catalog.has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
order by c.relname;

-- Die Wurzel, nicht nur der Bestand. Die Default-Privilegien des Schemas
-- public vergaben an anon und authenticated `arwdDxtm` -- das `D` ist
-- TRUNCATE. Damit erbte JEDE neue Tabelle die Luecke automatisch; so ist der
-- Zustand ueberhaupt entstanden. Ohne diesen Check waere der Bestandscheck
-- oben eine Momentaufnahme mit Verfallsdatum.
--
-- Geprueft wird der Eintrag mit Erzeuger `postgres`: alle 45 Tabellen in
-- public gehoeren postgres, und Migrationen laufen unter dieser Rolle.
-- Der zweite Eintrag (Erzeuger supabase_admin) vergibt weiterhin `D` und
-- laesst sich aus der Migrationsrolle nicht aendern (42501, ausprobiert). Er
-- greift nur fuer Tabellen, die supabase_admin selbst in public anlegt --
-- aktuell keine einzige. Faende so eine Tabelle je den Weg hierher, meldet
-- der Bestandscheck oben sie beim naechsten Lauf.
select case when pg_catalog.count(*) = 0 then 'PASS' else 'FAIL' end,
       'F6-grants', 'Default-Privilegien vergeben kein TRUNCATE an anon/authenticated',
       coalesce(pg_catalog.string_agg(detail, '; '),
                'Erzeuger postgres: anon und authenticated ohne D')
from (
  select coalesce(n.nspname, '<global>') || '/' || pg_get_userbyid(d.defaclrole)
         || ': ' || pg_catalog.array_to_string(d.defaclacl, ' | ') as detail
  from pg_catalog.pg_default_acl as d
  -- LEFT JOIN wie beim DML-Check darunter, aus demselben Grund: ein
  -- `alter default privileges` ohne `in schema` traegt defaclnamespace = 0 und
  -- gilt trotzdem fuer public. Nachgezogen am 11.08.2026 -- die Luecke war seit
  -- #892 drin und ist beim Bau des DML-Checks aufgefallen.
  left join pg_catalog.pg_namespace as n on n.oid = d.defaclnamespace
  cross join lateral pg_catalog.aclexplode(d.defaclacl) as ac
  where (n.nspname = 'public' or d.defaclnamespace = 0)
    and d.defaclobjtype = 'r'
    and pg_get_userbyid(d.defaclrole) = 'postgres'
    and ac.grantee::regrole::text in ('anon', 'authenticated')
    and ac.privilege_type = 'TRUNCATE'
) as offenders;

-- Dieselbe Wurzel, die drei uebrigen Schreibrechte. Der Sweep aus #892 hat aus
-- `anon=arwdDxtm` genau das `D` entfernt; `a`, `w` und `d` -- INSERT, UPDATE,
-- DELETE -- blieben vergeben, und damit erbte jede neue Tabelle sie weiter.
-- Der Check oben bewachte also genau den Buchstaben, der schon weg war.
--
-- Zum Zusammenspiel mit dem Bestand: Es gibt hier BEWUSST keinen
-- Bestandscheck fuer INSERT/UPDATE/DELETE. Anders als bei TRUNCATE ist das
-- Recht nicht tot -- das Admin-Portal arbeitet als `authenticated` und
-- schreibt real. Der Bestand (18 bzw. 21 Tabellen, Stand 2026-08-11) wird
-- getrennt und nach einer Pfadaufnahme behandelt; sein Waechter kommt mit ihm.
-- Diese Zeile bewacht ausschliesslich, dass nichts NEUES nachwaechst.
select case when pg_catalog.count(*) = 0 then 'PASS' else 'FAIL' end,
       'F6-grants', 'Default-Privilegien vergeben kein INSERT/UPDATE/DELETE an anon/authenticated',
       coalesce(pg_catalog.string_agg(detail, '; '),
                'Erzeuger postgres: anon und authenticated ohne a/w/d')
from (
  select coalesce(n.nspname, '<global>') || '/' || pg_get_userbyid(d.defaclrole)
         || ' vergibt ' || ac.privilege_type
         || ' an ' || ac.grantee::regrole::text as detail
  from pg_catalog.pg_default_acl as d
  -- LEFT JOIN, nicht JOIN: `alter default privileges` OHNE `in schema` legt
  -- einen Eintrag mit defaclnamespace = 0 an. Der gilt fuer JEDES Schema, also
  -- auch fuer public -- ein INNER JOIN auf pg_namespace wirft ihn weg, und der
  -- Check meldete PASS, waehrend neue Tabellen in public das Recht weiterhin
  -- erben. Genau die Bauform, gegen die dieser Check gerichtet ist.
  left join pg_catalog.pg_namespace as n on n.oid = d.defaclnamespace
  cross join lateral pg_catalog.aclexplode(d.defaclacl) as ac
  where (n.nspname = 'public' or d.defaclnamespace = 0)
    and d.defaclobjtype = 'r'
    and pg_get_userbyid(d.defaclrole) = 'postgres'
    and ac.grantee::regrole::text in ('anon', 'authenticated')
    and ac.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
) as offenders;

-- Die zweite Tuer, ausdruecklich statt ausgeblendet.
--
-- Beide Wurzelchecks oben filtern auf Erzeuger `postgres`, weil nur dieser
-- Eintrag aus der Migrationsrolle aenderbar ist. Der Eintrag mit Erzeuger
-- `supabase_admin` vergibt weiterhin das volle `arwdDxtm` und laesst sich
-- nicht aendern (42501, in #892 ausprobiert). Er ist damit eine bewusst
-- tolerierte Ausnahme -- und genau deshalb wird sie hier GEPRUEFT und nicht
-- verschwiegen.
--
-- Wirksam wird die Tuer erst, wenn supabase_admin selbst eine Tabelle in
-- public anlegt: eine solche Tabelle erbt INSERT/UPDATE/DELETE UND TRUNCATE,
-- an beiden Wurzelchecks vorbei. Diese Zeile ist der Auffang dafuer. Sie steht
-- heute auf PASS (0 von 47 Tabellen gehoeren supabase_admin) und wird rot,
-- sobald die Ausnahme aufhoert, folgenlos zu sein.
--
-- Ein Check, der eine bekannte Ausnahme stillschweigend ueberspringt, macht
-- aus einer getroffenen Entscheidung eine vergessene. Das ist die Bauform, die
-- in diesem Repository schon mehrfach Zeit gekostet hat.
select case when pg_catalog.count(*) = 0 then 'PASS' else 'FAIL' end,
       'F6-grants',
       'Keine Tabelle in public gehoert supabase_admin (umgeht beide Wurzelchecks)',
       coalesce(
         pg_catalog.string_agg(c.relname, ', ' order by c.relname),
         'Bekannte, folgenlose Ausnahme: Erzeuger supabase_admin vergibt weiter arwdDxtm, '
         || 'greift aber nur fuer eigene Tabellen -- aktuell keine')
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  -- 'p' MUSS mit: eine partitionierte Tabelle wird als Elternteil mit
  -- relkind = 'p' gefuehrt, nicht 'r'. Sie erbt die Default-Privilegien
  -- genauso -- ein Filter auf 'r' allein liesse ausgerechnet den Fall durch,
  -- den dieser Check abfangen soll.
  and c.relkind in ('r', 'p')
  and pg_get_userbyid(c.relowner) = 'supabase_admin';

-- Die uebrigen Schreibrechte auf system_config. Sie waren durch RLS bereits
-- wirkungslos (die Tabelle traegt genau eine Policy, und die gilt nur fuer
-- SELECT) -- aber damit haette die Sicherheit dieser Tabelle allein an dieser
-- einen Policy gehangen. Kaeme je eine INSERT- oder UPDATE-Policy ohne
-- Rollenbindung dazu, waere anon sofort schreibberechtigt.
select case when not pg_catalog.has_table_privilege(t.role_name, 'public.system_config', t.priv)
            then 'PASS' else 'FAIL' end,
       'F6-grants', t.role_name || ' ohne ' || t.priv || ' auf system_config', ''
from (values
  ('anon', 'INSERT'), ('anon', 'UPDATE'), ('anon', 'DELETE'),
  ('authenticated', 'INSERT'), ('authenticated', 'UPDATE'), ('authenticated', 'DELETE')
) as t(role_name, priv)
where to_regclass('public.system_config') is not null;

-- Gegenrichtung fuer system_config: was zugehen wuerde, wenn jemand die
-- Rechte oben mit einem pauschalen `revoke all` zurueckgenommen haette, ohne
-- neu zu granten. Das Admin-Portal laedt system_config als authenticated,
-- der Prompt-Sync als service_role.
select case when pg_catalog.has_table_privilege(t.role_name, 'public.system_config', t.priv)
            then 'PASS' else 'FAIL' end,
       'F6-grants', t.role_name || ' behaelt ' || t.priv || ' auf system_config', t.grund
from (values
  ('authenticated', 'SELECT', 'Admin-Portal laedt system_config im Browser'),
  ('service_role',  'SELECT', 'Prompt-Sync und Prompt-Vorschau'),
  ('service_role',  'UPDATE', 'Schreibpfad liegt vollstaendig beim Server')
) as t(role_name, priv, grund)
where to_regclass('public.system_config') is not null;

-- Der Lesepfad auf system_config haengt an genau einer Policy. Der F5-Block
-- oben prueft nur, DASS sie existiert -- ein Austausch des Ausdrucks gegen
-- etwas Weiteres (z.B. `auth.uid() is not null`) bliebe dort unbemerkt, weil
-- Name und Anzahl gleich blieben. Der using(true)-Check greift ebenfalls nicht,
-- weil so ein Ausdruck nicht woertlich `true` ist.
select case when coalesce((select pg_get_expr(p.polqual, p.polrelid) ~ 'is_admin\(auth\.uid\(\)\)'
                           from pg_catalog.pg_policy as p
                           where p.polrelid = to_regclass('public.system_config')
                             and p.polname = 'system_config_admin_select'), false)
            then 'PASS' else 'FAIL' end,
       'F5-policies', 'system_config_admin_select bindet weiterhin an is_admin(auth.uid())',
       coalesce((select pg_get_expr(p.polqual, p.polrelid)
                 from pg_catalog.pg_policy as p
                 where p.polrelid = to_regclass('public.system_config')
                   and p.polname = 'system_config_admin_select'), '<Policy fehlt>')
where to_regclass('public.system_config') is not null;

-- Genau eine Policy: eine zweite waere per ODER-Verknuepfung eine Erweiterung
-- des Lesekreises oder ein neuer Schreibpfad. Beides soll auffallen, nicht
-- erst wenn jemand danach sucht.
select case when 1 = (select pg_catalog.count(*) from pg_catalog.pg_policy as p
                      where p.polrelid = to_regclass('public.system_config'))
            then 'PASS' else 'FAIL' end,
       'F5-policies', 'system_config traegt genau eine Policy',
       -- polcmd ist vom Typ "char": ohne expliziten Cast ist `||` mehrdeutig
       -- (42725) und die ganze Katalogdatei bricht unter ON_ERROR_STOP ab.
       coalesce((select pg_catalog.string_agg(p.polname || ':' || p.polcmd::text, ', ' order by p.polname)
                 from pg_catalog.pg_policy as p
                 where p.polrelid = to_regclass('public.system_config')), '<keine>')
where to_regclass('public.system_config') is not null;

-- anon-Grants als Rohdaten fuer den Baseline-Diff. Aktuell haelt anon breite
-- DML-Rechte auf vielen Tabellen; davor steht ausschliesslich RLS. Diese
-- Alt-Schuld wird eingefroren, nicht ignoriert: jeder NEUE Grant faellt auf.
select 'INFO', 'anon-grants', c.relname,
       pg_catalog.string_agg(distinct ac.privilege_type, ',' order by ac.privilege_type)
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(c.relacl) as ac
where n.nspname = 'public' and c.relkind = 'r' and ac.grantee = 'anon'::regrole
group by c.relname
order by c.relname;

-- Dasselbe fuer authenticated, beschraenkt auf die Mandantentabellen. Einige
-- dieser Rechte sind gewollt (Admin-Panel), andere sind Supabase-Defaults, die
-- nur RLS zurueckhaelt. Welche davon welche sind, laesst sich aus dem Katalog
-- nicht ablesen -- also wird der Ist-Zustand eingefroren und jede Ausweitung
-- gemeldet.
select 'INFO', 'authenticated-grants', c.relname,
       pg_catalog.string_agg(distinct ac.privilege_type, ',' order by ac.privilege_type)
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(c.relacl) as ac
where n.nspname = 'public' and c.relkind = 'r' and ac.grantee = 'authenticated'::regrole
  and c.relname in ('users', 'customers', 'calls', 'notifications', 'ai_change_requests',
                    'contracts', 'subscriptions', 'invoices', 'offers', 'customer_addons',
                    'voxera_cases', 'customer_tasks', 'system_config')
group by c.relname
order by c.relname;

-- ═══ Gruppe G: Migrations-Ledger ═══════════════════════════════════════════
-- Rohdaten; den Abgleich gegen supabase/migrations/ macht der Node-Runner.
select 'INFO', 'ledger', name, version
from supabase_migrations.schema_migrations
order by version;
