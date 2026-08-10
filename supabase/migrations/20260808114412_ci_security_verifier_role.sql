-- CI-Verifier-Rolle + zwei eng gefasste Proben-Helfer.
--
-- Hintergrund: Die P0-Migration vom 2026-07-28 galt wochenlang als "gemergt und
-- live verifiziert", war auf der Produktions-DB aber nie wirksam. Der CI-Check
-- `verify-p0-security-foundation` blieb die ganze Zeit gruen, weil er ausschliess-
-- lich Repo-Dateien liest. Ein Check, der nur den Code prueft, kann diese Klasse
-- von Fehler prinzipiell nicht sehen.
--
-- Diese Migration legt den Zugang an, mit dem CI kuenftig die *echte* Datenbank
-- befragt: eine Rolle ohne eigene Tabellenrechte, die `anon` und `authenticated`
-- impersonieren kann, plus zwei SECURITY-DEFINER-Helfer, die den Proben genau so
-- viel Kontext geben, wie sie zum Urteilen brauchen -- und keinen Deut mehr.
--
-- Bewusst NICHT in dieser Datei: das Passwort. Die Rolle wird mit LOGIN, aber
-- ohne Passwort angelegt und kann sich damit nicht anmelden. Das Passwort wird
-- out-of-band gesetzt (siehe docs/DB_SECURITY_CI_SETUP.md) und lebt nur im
-- GitHub-Secret.
--
-- NACHTRAG: Der Zensus-Helfer wurde direkt im Anschluss ueberarbeitet, siehe
-- 2026-08-08_ci_security_verifier_role_census_v2.sql. Diese Datei bleibt
-- unveraendert auf dem Stand, der unter diesem Namen tatsaechlich angewandt
-- wurde -- eine Migrationsdatei nachtraeglich umzuschreiben waere genau die
-- Sorte "Repo behauptet etwas anderes als die Datenbank", gegen die der ganze
-- Vorgang hier gerichtet ist.

begin;

-- ── 1. Rolle ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'voxera_ci_verifier') then
    create role voxera_ci_verifier login;
  end if;
end
$$;

-- Idempotent auch fuer den Fall, dass die Rolle schon existierte: das Attribut-
-- profil wird in jedem Lauf neu durchgesetzt, damit ein manuelles `alter role`
-- die Absicherung nicht unbemerkt aufweicht.
--
-- NOINHERIT ist der wichtigste Teil: die Rolle bekommt die Rechte von `anon`
-- bzw. `authenticated` ausschliesslich nach explizitem `set role`, nie passiv.
--
-- SUPERUSER und BYPASSRLS werden hier NICHT gesetzt: beide Attribute lassen
-- sich nur als Superuser aendern, und `postgres` ist auf Supabase keiner. Sie
-- sind bei CREATE ROLE ohnehin standardmaessig aus -- die Selbstkontrolle am
-- Ende dieser Datei prueft das nach, statt es zu unterstellen. Eine Rolle mit
-- BYPASSRLS koennte die Isolationsproben nicht durchfuehren: sie wuerden
-- ausnahmslos bestehen und nichts messen.
alter role voxera_ci_verifier login noinherit nocreatedb nocreaterole;

-- Ein haengender CI-Job darf keine Ressourcen auf der Produktions-DB binden.
alter role voxera_ci_verifier set statement_timeout = '15s';
alter role voxera_ci_verifier set lock_timeout = '5s';
alter role voxera_ci_verifier set idle_in_transaction_session_timeout = '30s';

grant anon, authenticated to voxera_ci_verifier;
grant usage on schema public to voxera_ci_verifier;

-- Fuer den Ledger-Drift-Check (Repo-Migration ohne DB-Eintrag und umgekehrt).
grant usage on schema supabase_migrations to voxera_ci_verifier;
grant select on supabase_migrations.schema_migrations to voxera_ci_verifier;

-- ── 2. Zensus-Helfer ───────────────────────────────────────────────────────
-- Die Deny-by-default-Probe fragt "sieht eine fremde Session 0 Zeilen?". Bei
-- einer leeren Tabelle ist 0 aber kein Beweis, sondern ein Zufall -- aktuell
-- sind z.B. customer_tasks und customer_addons leer. Der Zensus liefert die
-- Grundgesamtheit, damit die Probe leere Tabellen als SKIP ausweisen kann statt
-- als falsches PASS.
--
-- Rueckgabe sind ausschliesslich Tabellenname und Zeilenzahl. Keine Inhalte.
create or replace function public.ci_security_probe_census()
returns table (rel text, row_count bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $ci_census$
declare
  r record;
  n bigint;
begin
  for r in
    select c.relname
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'r'
    order by c.relname
  loop
    execute pg_catalog.format('select pg_catalog.count(*) from public.%I', r.relname) into n;
    rel := r.relname;
    row_count := n;
    return next;
  end loop;
end
$ci_census$;

-- ── 3. Identitaets-Helfer ──────────────────────────────────────────────────
-- Die positive Isolationsprobe braucht eine echte Identitaet: nur mit einem
-- gueltigen Subject laesst sich pruefen, dass ein Mandant genau seine eigenen
-- Zeilen sieht -- und nicht etwa alle oder gar keine. Ohne diese Probe wuerde
-- ein versehentliches Blanket-Deny (RLS haerter als beabsichtigt) unbemerkt
-- als "sicher" durchgehen und die Deny-by-default-Probe entwerten.
--
-- Rueckgabe sind ausschliesslich Schluessel und Zaehlwerte -- keine Namen,
-- keine Mailadressen, keine Inhalte.
--
-- Der gewaehlte Nutzer darf kein Admin sein: ein Admin sieht ueber is_admin()
-- bewusst alle Mandanten, damit waere die Probe sinnlos.
create or replace function public.ci_security_probe_identity()
returns table (
  user_id uuid,
  home_customer_id text,
  foreign_customer_id text,
  home_rows bigint,
  foreign_rows bigint
)
language sql
stable
security definer
set search_path = pg_catalog
as $ci_identity$
  with tenant_rows as (
    select c.customer_id, pg_catalog.count(*) as n from public.calls as c group by c.customer_id
    union all
    select n.customer_id, pg_catalog.count(*) from public.notifications as n group by n.customer_id
    union all
    select i.customer_id, pg_catalog.count(*) from public.invoices as i group by i.customer_id
  ),
  totals as (
    select customer_id, pg_catalog.sum(n) as n
    from tenant_rows
    where customer_id is not null
    group by customer_id
  ),
  candidate as (
    select u.id as user_id, u.customer_id, coalesce(t.n, 0) as n
    from public.users as u
    left join totals as t on t.customer_id = u.customer_id
    where u.customer_id is not null
      and not exists (select 1 from public.admins as a where a.id = u.id)
    order by coalesce(t.n, 0) desc, u.id
    limit 1
  )
  select
    c.user_id,
    c.customer_id,
    (select t.customer_id from totals as t
      where t.customer_id is distinct from c.customer_id
      order by t.n desc, t.customer_id limit 1),
    c.n,
    coalesce((select t.n from totals as t
      where t.customer_id is distinct from c.customer_id
      order by t.n desc, t.customer_id limit 1), 0)
  from candidate as c
$ci_identity$;

-- ── 4. Rechte auf den Helfern ──────────────────────────────────────────────
-- Supabase vergibt per DEFAULT PRIVILEGES EXECUTE an anon/authenticated/
-- service_role. Das muss hier explizit zurueckgenommen werden -- sonst koennte
-- jeder eingeloggte Nutzer den Zensus abfragen.
revoke all on function public.ci_security_probe_census() from public, anon, authenticated, service_role;
revoke all on function public.ci_security_probe_identity() from public, anon, authenticated, service_role;

grant execute on function public.ci_security_probe_census() to voxera_ci_verifier;
grant execute on function public.ci_security_probe_identity() to voxera_ci_verifier;

-- ── 5. Selbstkontrolle ─────────────────────────────────────────────────────
-- Eine Migration, die stillschweigend das Falsche tut, ist genau das Problem,
-- das dieser ganze Vorgang abstellen soll. Also prueft sie sich selbst.
do $$
declare
  problem text;
begin
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = 'voxera_ci_verifier') then
    problem := 'voxera_ci_verifier hat BYPASSRLS -- die Isolationsproben wuerden immer bestehen';
  elsif (select rolsuper from pg_catalog.pg_roles where rolname = 'voxera_ci_verifier') then
    problem := 'voxera_ci_verifier ist Superuser';
  elsif (select rolinherit from pg_catalog.pg_roles where rolname = 'voxera_ci_verifier') then
    problem := 'voxera_ci_verifier erbt Rechte passiv (INHERIT) statt nur per set role';
  elsif pg_catalog.has_function_privilege('authenticated', 'public.ci_security_probe_census()', 'EXECUTE') then
    problem := 'authenticated darf den Zensus aufrufen';
  elsif pg_catalog.has_function_privilege('anon', 'public.ci_security_probe_census()', 'EXECUTE') then
    problem := 'anon darf den Zensus aufrufen';
  elsif pg_catalog.has_function_privilege('authenticated', 'public.ci_security_probe_identity()', 'EXECUTE') then
    problem := 'authenticated darf den Identitaets-Helfer aufrufen';
  elsif pg_catalog.has_function_privilege('anon', 'public.ci_security_probe_identity()', 'EXECUTE') then
    problem := 'anon darf den Identitaets-Helfer aufrufen';
  elsif not pg_catalog.has_function_privilege('voxera_ci_verifier', 'public.ci_security_probe_census()', 'EXECUTE') then
    problem := 'voxera_ci_verifier darf den Zensus nicht aufrufen';
  -- MEMBER, nicht USAGE: USAGE hiesse "erbt die Rechte passiv" und ist bei einer
  -- NOINHERIT-Rolle per Definition falsch. Gebraucht wird genau das Gegenteil --
  -- Mitgliedschaft, die nur per explizitem `set role` wirksam wird.
  elsif not pg_catalog.pg_has_role('voxera_ci_verifier', 'authenticated', 'MEMBER') then
    problem := 'voxera_ci_verifier kann authenticated nicht impersonieren';
  elsif not pg_catalog.pg_has_role('voxera_ci_verifier', 'anon', 'MEMBER') then
    problem := 'voxera_ci_verifier kann anon nicht impersonieren';
  -- Gegenprobe zu NOINHERIT: die Rechte duerfen NICHT passiv anliegen.
  elsif pg_catalog.pg_has_role('voxera_ci_verifier', 'authenticated', 'USAGE') then
    problem := 'voxera_ci_verifier erbt die Rechte von authenticated passiv';
  end if;

  if problem is not null then
    raise exception using
      errcode = 'raise_exception',
      message = 'ci_security_verifier_role abgebrochen: ' || problem;
  end if;
end
$$;

commit;
