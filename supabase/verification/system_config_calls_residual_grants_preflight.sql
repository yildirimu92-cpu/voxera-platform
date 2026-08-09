-- READ ONLY: VOR 2026-08-09_system_config_calls_residual_grants.sql laufen
-- lassen und die Ausgabe als Rollback-Beleg sichern.
--
-- Diese Datei urteilt bewusst NICHT mit PASS/FAIL. Sie haelt den Ist-Zustand
-- fest, gegen den die Post-Migration-Datei danach diffed. Der Grund ist der
-- P0-Vorfall selbst: dort war die Annahme "die Migration ist gelaufen" die
-- Fehlerquelle. Ein Preflight, der schon weiss, was herauskommen soll, wieder-
-- holt genau diesen Fehler.

\pset pager off

-- ── 1. Tabellenrechte, direkt aus pg_catalog ───────────────────────────────
-- NICHT ueber information_schema.role_table_grants: dessen Sichten filtern auf
-- `enabled_roles`. Unter einer NOINHERIT-Rolle (die CI-Verifier-Rolle ist eine)
-- liefern sie fuer anon/authenticated null Zeilen -- also einen leeren Beleg,
-- der wie "keine Rechte" aussieht.
select 'grants' as block, c.relname as tabelle, ac.grantee::regrole::text as rolle,
       string_agg(distinct ac.privilege_type, ',' order by ac.privilege_type) as rechte
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(c.relacl) as ac
where n.nspname = 'public'
  and c.relname in ('system_config', 'calls')
  and ac.grantee::regrole::text in ('anon', 'authenticated', 'service_role')
group by c.relname, ac.grantee
order by c.relname, ac.grantee::regrole::text;

-- ── 2. Spaltenrechte (die Allowlists aus der P0-Haertung) ──────────────────
select 'spalten' as block, c.relname as tabelle, r.rolname as rolle,
       p.priv as recht,
       coalesce(string_agg(a.attname, ',' order by a.attname), '<keine>') as spalten
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated')) as r(rolname)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE')) as p(priv)
left join pg_catalog.pg_attribute as a
  on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
 and pg_catalog.has_column_privilege(r.rolname, a.attrelid, a.attnum, p.priv)
where n.nspname = 'public' and c.relname in ('system_config', 'calls')
group by c.relname, r.rolname, p.priv
order by c.relname, r.rolname, p.priv;

-- ── 3. RLS-Zustand und Policies ────────────────────────────────────────────
select 'rls' as block, c.relname as tabelle, c.relrowsecurity as rls_aktiv,
       (select count(*) from pg_catalog.pg_policy as p where p.polrelid = c.oid) as policies
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('system_config', 'calls')
order by c.relname;

select 'policy' as block, c.relname as tabelle, p.polname as policy, p.polcmd as kommando,
       coalesce((select string_agg(ro.rolname, ',' order by ro.rolname)
                 from pg_catalog.pg_roles as ro where ro.oid = any(p.polroles)), 'PUBLIC') as rollen,
       coalesce(pg_get_expr(p.polqual, p.polrelid), '') as using_ausdruck,
       coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as check_ausdruck
from pg_catalog.pg_policy as p
join pg_catalog.pg_class as c on c.oid = p.polrelid
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('system_config', 'calls')
order by c.relname, p.polname;

-- ── 4. Der Punkt, um den es geht: TRUNCATE kennt kein RLS ──────────────────
-- Bei INSERT/UPDATE/DELETE laesst sich aus dem Grant allein nichts ableiten,
-- weil RLS davorsteht. Bei TRUNCATE schon: es gibt keine Policy-Ebene, das
-- Grant ist die einzige Huerde. Deshalb steht diese Zeile getrennt.
select 'truncate' as block, t.rolname as rolle, t.relname as tabelle,
       pg_catalog.has_table_privilege(t.rolname, 'public.' || t.relname, 'TRUNCATE') as darf_truncieren
from (values ('anon', 'system_config'), ('authenticated', 'system_config'),
             ('anon', 'calls'), ('authenticated', 'calls')) as t(rolname, relname)
order by t.relname, t.rolname;

-- ── 5. Ledger: steht der P0-Nachzug wirklich auf dieser DB? ────────────────
-- Der Nebenfund aus PR #830 nannte calls-INSERT und system_config-SELECT als
-- offen. Beides hat der Nachzug erledigt. Wer diese Migration einspielt, ohne
-- das geprueft zu haben, arbeitet gegen eine Notiz statt gegen die Datenbank.
select 'ledger' as block, version, name
from supabase_migrations.schema_migrations
where name in ('p0_security_foundation_catchup', 'ai_change_requests_tenant_isolation_reassert')
order by version;
