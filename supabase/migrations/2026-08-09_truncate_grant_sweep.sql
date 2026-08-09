-- TRUNCATE aus den Browser-Rollen entfernen -- vollstaendig, nicht tabellenweise.
--
-- Anlass. Bei der Nachkontrolle der RLS-Nebenfunde (PR #889) fiel auf, dass
-- `anon` und `authenticated` public.system_config und public.calls truncieren
-- konnten. Dort wurde es punktuell behoben. Die daraufhin freigegebene
-- Durchsicht der eingefrorenen Grant-Baseline zeigt: es waren nie zwei
-- Tabellen. Gemessen am 2026-08-09 auf Produktion, NACH dem Fix aus PR #889:
--
--     anon           haelt TRUNCATE auf 26 von 45 Tabellen
--     authenticated  haelt TRUNCATE auf 27 von 45 Tabellen
--
-- betroffen u.a. users, admins, customers, onboarding, invoice_items,
-- outbox_events, voxera_cases, push_subscriptions.
--
-- Warum das die eine Rechteklasse ist, die man nicht einfrieren darf. Fuer
-- SELECT/INSERT/UPDATE/DELETE traegt das Argument "davor steht noch RLS" --
-- die Baseline haelt sie deshalb bewusst nur sichtbar. Auf TRUNCATE werden
-- Policies GAR NICHT angewandt; es gibt keine zweite Schicht, das Grant ist
-- die einzige Huerde. Eine eingefrorene Zeile schuetzt hier nichts.
--
-- Einordnung, damit die Dringlichkeit stimmt: ueber die oeffentliche
-- Angriffsflaeche ist das nicht erreichbar. `anon`/`authenticated` sind nur
-- ueber PostgREST/Realtime/Storage annehmbar, und keines davon setzt je ein
-- TRUNCATE ab; der anon-Key ist ein PostgREST-JWT, kein DB-Passwort. Es ist
-- Grant-Hygiene -- aber die letzte Schicht, die im Ernstfall zwischen einem
-- direkten DB-Zugang und einer leeren Tabelle steht.
--
-- Belegt vor dem Zuruecknehmen: nichts braucht dieses Recht.
--   * Keine Datenbankfunktion enthaelt TRUNCATE (pg_proc.prosrc durchsucht,
--     Schemata public/auth/storage -- 0 Treffer).
--   * Kein Anwendungscode setzt TRUNCATE ab (Repo durchsucht -- die einzigen
--     Treffer sind die Pruefdateien, die das Recht verbieten).
--   * service_role und der Eigentuemer postgres behalten TRUNCATE unveraendert.
--
-- ─── Der zweite, wichtigere Teil: die Wurzel ───────────────────────────────
--
-- Ein einmaliges Revoke wuerde verrotten. Die Default-Privilegien des Schemas
-- public vergeben an anon und authenticated `arwdDxtm` -- das `D` darin ist
-- TRUNCATE. JEDE neu angelegte Tabelle reisst die Luecke also automatisch
-- wieder auf, und niemand merkt es. Genau so ist der heutige Zustand
-- entstanden; es war nie eine Entscheidung.
--
-- Deshalb aendert diese Migration zusaetzlich die Default-Privilegien. Alle 45
-- Tabellen in public gehoeren `postgres`, und Migrationen laufen unter dieser
-- Rolle -- der Eintrag mit Erzeuger `postgres` ist damit der wirksame.
--
-- BEKANNTE RESTLUECKE, bewusst so belassen: es gibt einen zweiten Eintrag mit
-- Erzeuger `supabase_admin`, der ebenfalls `arwdDxtm` vergibt. Er laesst sich
-- aus dieser Rolle nicht aendern ("permission denied to change default
-- privileges", 42501 -- ausprobiert, nicht vermutet). Praktisch greift er nur
-- fuer Tabellen, die supabase_admin selbst in public anlegt; aktuell gibt es
-- keine einzige solche. Der Katalogcheck unten misst den Ist-Zustand ueber
-- ALLE Tabellen und wuerde eine so entstandene Tabelle beim naechsten Lauf
-- melden.
--
-- Idempotent: mehrfaches Ausfuehren aendert nichts.

begin;

-- ─── 1. Bestand: TRUNCATE von public, anon, authenticated zuruecknehmen ─────
--
-- Dynamisch ueber pg_class statt einer gepflegten Liste. Eine Aufzaehlung
-- waere schon beim naechsten `create table` unvollstaendig, ohne dass es
-- auffiele -- und Unvollstaendigkeit ist genau der Befund, der diese Migration
-- ausgeloest hat.
--
-- Nur TRUNCATE. SELECT/INSERT/UPDATE/DELETE bleiben unangetastet: sie stehen
-- hinter RLS, sind in der Baseline dokumentiert, und das Admin-Portal arbeitet
-- als `authenticated`. Ein pauschales `revoke all` waere hier ein Ausfall,
-- kein Sicherheitsgewinn.
do $sweep$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    execute pg_catalog.format('revoke truncate on table public.%I from public', r.relname);
    execute pg_catalog.format('revoke truncate on table public.%I from anon', r.relname);
    execute pg_catalog.format('revoke truncate on table public.%I from authenticated', r.relname);
  end loop;
end
$sweep$;

-- ─── 2. Wurzel: kuenftige Tabellen erben kein TRUNCATE mehr ─────────────────
--
-- Ohne diesen Schritt waere Teil 1 eine Momentaufnahme mit Verfallsdatum.
alter default privileges in schema public revoke truncate on tables from anon;
alter default privileges in schema public revoke truncate on tables from authenticated;

commit;
