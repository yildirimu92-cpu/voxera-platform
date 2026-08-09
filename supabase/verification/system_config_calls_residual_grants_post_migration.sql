-- READ ONLY: NACH 2026-08-09_system_config_calls_residual_grants.sql laufen
-- lassen. Jede FAIL-Zeile muss geklaert sein, bevor der PR gemergt wird.
--
-- Die Datei prueft beides: dass die Luecke zu ist UND dass die Wege, die offen
-- bleiben mussten, noch offen sind. Ohne die zweite Haelfte wuerde eine
-- komplett gesperrte Tabelle alle Checks bestehen -- derselbe Fehlermodus, den
-- die Gegenkontrollen in db_security_invariants_behavior.sql abfangen.

\pset pager off

with checks(check_name, passed, detail) as (

  -- ══ Der eigentliche Fix ═══════════════════════════════════════════════════

  -- TRUNCATE zuerst, weil es der einzige Punkt ist, den RLS nicht abgedeckt
  -- haette: auf TRUNCATE werden Policies gar nicht angewandt.
  select 'anon darf system_config nicht truncieren',
         not pg_catalog.has_table_privilege('anon', 'public.system_config', 'TRUNCATE'), ''
  union all
  select 'authenticated darf system_config nicht truncieren',
         not pg_catalog.has_table_privilege('authenticated', 'public.system_config', 'TRUNCATE'), ''
  union all
  select 'authenticated darf calls nicht truncieren',
         not pg_catalog.has_table_privilege('authenticated', 'public.calls', 'TRUNCATE'), ''
  union all
  select 'anon darf calls nicht truncieren',
         not pg_catalog.has_table_privilege('anon', 'public.calls', 'TRUNCATE'), ''
  union all

  -- Die uebrigen DML-Rechte auf system_config. Sie waren durch RLS bereits
  -- wirkungslos; sie stehen zu lassen hiesse, die Sicherheit dieser Tabelle
  -- weiterhin allein an einer einzigen Policy aufzuhaengen.
  select 'anon haelt kein DML-Recht mehr auf system_config',
         not (pg_catalog.has_table_privilege('anon', 'public.system_config', 'INSERT')
           or pg_catalog.has_table_privilege('anon', 'public.system_config', 'UPDATE')
           or pg_catalog.has_table_privilege('anon', 'public.system_config', 'DELETE')),
         pg_catalog.concat_ws(',',
           case when pg_catalog.has_table_privilege('anon', 'public.system_config', 'INSERT') then 'INSERT' end,
           case when pg_catalog.has_table_privilege('anon', 'public.system_config', 'UPDATE') then 'UPDATE' end,
           case when pg_catalog.has_table_privilege('anon', 'public.system_config', 'DELETE') then 'DELETE' end)
  union all
  select 'anon haelt auch kein SELECT auf system_config (P0-Nachzug haelt)',
         not pg_catalog.has_table_privilege('anon', 'public.system_config', 'SELECT'), ''
  union all
  select 'authenticated haelt kein DML-Recht mehr auf system_config',
         not (pg_catalog.has_table_privilege('authenticated', 'public.system_config', 'INSERT')
           or pg_catalog.has_table_privilege('authenticated', 'public.system_config', 'UPDATE')
           or pg_catalog.has_table_privilege('authenticated', 'public.system_config', 'DELETE')), ''
  union all

  -- ══ Was offen bleiben MUSS ════════════════════════════════════════════════

  -- Ohne diese Zeile waere ein versehentliches `revoke all` ohne
  -- Wieder-Grant gruen: das Admin-Portal laedt system_config als
  -- authenticated (admin-panel/index.html), gefiltert durch
  -- system_config_admin_select.
  select 'authenticated behaelt SELECT auf system_config (Admin-Portal liest es)',
         pg_catalog.has_table_privilege('authenticated', 'public.system_config', 'SELECT'), ''
  union all
  select 'service_role behaelt den Schreibpfad auf system_config (Prompt-Sync)',
         pg_catalog.has_table_privilege('service_role', 'public.system_config', 'SELECT')
     and pg_catalog.has_table_privilege('service_role', 'public.system_config', 'INSERT')
     and pg_catalog.has_table_privilege('service_role', 'public.system_config', 'UPDATE')
     and pg_catalog.has_table_privilege('service_role', 'public.system_config', 'DELETE'), ''
  union all
  select 'authenticated behaelt SELECT auf calls (Dashboard liest Anrufe)',
         pg_catalog.has_table_privilege('authenticated', 'public.calls', 'SELECT'), ''
  union all
  select 'service_role behaelt INSERT auf calls (Call-Intake)',
         pg_catalog.has_table_privilege('service_role', 'public.calls', 'INSERT'), ''
  union all

  -- Der Rest von calls bleibt unangetastet -- diese Migration nimmt dort
  -- ausschliesslich TRUNCATE. Die Spalten-Allowlist ist der empfindlichste
  -- Teil: sie musste 2026-08-07 schon einmal nachgezogen werden.
  select 'calls: authenticated-UPDATE weiterhin auf exakt 4 Spalten',
         4 = (select pg_catalog.count(*) from pg_catalog.pg_attribute as a
              where a.attrelid = to_regclass('public.calls') and a.attnum > 0 and not a.attisdropped
                and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')),
         coalesce((select pg_catalog.string_agg(a.attname, ',' order by a.attname)
                   from pg_catalog.pg_attribute as a
                   where a.attrelid = to_regclass('public.calls') and a.attnum > 0 and not a.attisdropped
                     and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')), '<keine>')
  union all
  select 'calls: authenticated haelt weiterhin KEIN INSERT (P0-Nachzug haelt)',
         not pg_catalog.has_table_privilege('authenticated', 'public.calls', 'INSERT'), ''
  union all

  -- ══ RLS und Policies unveraendert ═════════════════════════════════════════

  select 'system_config hat RLS aktiv',
         coalesce((select c.relrowsecurity from pg_catalog.pg_class as c
                   where c.oid = to_regclass('public.system_config')), false), ''
  union all
  select 'system_config_admin_select existiert unveraendert',
         exists (select 1 from pg_catalog.pg_policy as p
                 where p.polrelid = to_regclass('public.system_config')
                   and p.polname = 'system_config_admin_select'
                   and p.polcmd = 'r'
                   and pg_get_expr(p.polqual, p.polrelid) ~ 'is_admin\(auth\.uid\(\)\)'), ''
  union all
  -- Genau eine Policy: kaeme eine INSERT/UPDATE-Policy dazu, waeren die oben
  -- zurueckgenommenen Grants der einzige Grund, warum daraus kein Schreibrecht
  -- fuer anon wird. Diese Zeile macht so eine Ergaenzung sichtbar.
  select 'system_config traegt genau eine Policy (nur SELECT)',
         1 = (select pg_catalog.count(*) from pg_catalog.pg_policy as p
              where p.polrelid = to_regclass('public.system_config')),
         -- polcmd ist vom Typ "char", nicht text -- ohne den Cast ist der
         -- ||-Operator mehrdeutig und die Abfrage bricht mit 42725 ab.
         (select coalesce(pg_catalog.string_agg(p.polname || ':' || p.polcmd::text, ', '), '<keine>')
          from pg_catalog.pg_policy as p where p.polrelid = to_regclass('public.system_config'))
  union all
  select 'calls: Policy-Bestand unveraendert (7)',
         7 = (select pg_catalog.count(*) from pg_catalog.pg_policy as p
              where p.polrelid = to_regclass('public.calls')),
         (select pg_catalog.count(*)::text from pg_catalog.pg_policy as p
          where p.polrelid = to_regclass('public.calls'))
)
select case when passed then 'PASS' else 'FAIL' end as status,
       check_name,
       coalesce(nullif(detail, ''), '') as detail
from checks
order by passed, check_name;
