-- Die Wurzel zuerst, der Bestand danach: Default-Privilegien verengen und die
-- Grants abraeumen, die keine Policy je bedienen kann.
--
-- ── Teil 1: die Wurzel ─────────────────────────────────────────────────────
--
-- Am 2026-08-11 gemessen (Produktion, ulcofbgrovgcvowdjrge):
--   pg_default_acl public/postgres  ->  anon=arwdxtm, authenticated=arwdxtm
--
-- Das `D` (TRUNCATE) ist am 2026-08-09 durch den Truncate-Sweep gefallen, der
-- Rest steht unveraendert: `a` INSERT, `w` UPDATE, `d` DELETE, dazu `x`
-- REFERENCES, `t` TRIGGER, `m` MAINTAIN. Jede neue Tabelle in public wurde
-- damit anon-schreibbar geboren -- und der Invarianten-Check meldete PASS,
-- weil er ausschliesslich auf TRUNCATE sah. Der Bestandsschnitt in Teil 2
-- waere ohne diese Verengung eine Momentaufnahme mit Verfallsdatum: die
-- naechste `create table` haette die Rechte sofort zurueckgeholt.
--
-- SELECT bleibt stehen. Das Zugriffsmodell des Projekts ist "SELECT-Grant
-- plus RLS als Tor" -- neue Tabellen sollen lesbar konfigurierbar sein, ohne
-- dass jede Migration den Grant nachtraegt. Schreibrechte sollen dagegen
-- explizit vergeben werden statt geerbt zu werden.
--
-- NICHT angefasst, mit Nachweis im Katalog statt stillem Verschweigen:
--   public/supabase_admin (anon=arwdDxtm) -- aus dieser Rolle nicht aenderbar
--     (42501). Scharf nur fuer Tabellen, die supabase_admin in public anlegt;
--     gemessen: 47 von 47 gehoeren postgres.
--   storage/postgres (anon=arwdDxtm) -- technisch aenderbar, bewusst nicht:
--     stammt aus dem Supabase-Bootstrap, eine Abweichung kann Storage-
--     Upgrades brechen. Inert, weil die Storage-API ihre acht Tabellen als
--     supabase_storage_admin anlegt; gemessen: 8 von 8, keine postgres.
--   graphql, graphql_public -- enthalten null Tabellen.
-- Alle drei Faelle pruefen die neuen F6-Checks in
-- db_security_invariants_catalog.sql ueber ihre Zuendbedingung.

begin;

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger, maintain
  on tables from anon, authenticated;

-- ── Teil 2: der Bestand ────────────────────────────────────────────────────
--
-- Die Vorgaenger-Migration (20260809174824_revoke_browser_grants_rls_no_policy)
-- hat Tabellen mit mindestens einer Policy bewusst ausgespart: dort ist der
-- Browser-Zugriff gewollt, und ein `revoke all` haette das Dashboard zerlegt.
-- Diese Migration schneidet deshalb feiner statt breiter.
--
-- Schnittregel: ein Grant faellt genau dann, wenn KEINE permissive Policy
-- diese Rolle fuer dieses Kommando bedienen kann. Ermittelt ueber pg_policy
-- (polroles enthaelt die Rolle oder ist `public`, polcmd passt oder ist ALL).
-- Solche Rechte sind per Konstruktion tot: die Rolle kommt heute schon nicht
-- durch, und ohne Policy kann sie es auch morgen nicht. Ein erfolgreicher
-- Aufruf kann dadurch nicht fehlschlagen -- es gibt keinen.
--
-- Was sich trotzdem aendert, ehrlich benannt (dieselbe Nebenwirkung, die die
-- Vorgaenger-Migration dokumentiert hat): die Fehlerform. Ein Aufruf, der
-- vorher eine leere Ergebnisliste bekam, bekommt jetzt "permission denied".
-- Fuer Code, der `error` auswertet, wird aus stiller Leere ein hoerbarer
-- Fehler. Das ist ehrlicher, aber es ist eine Aenderung.
--
-- REFERENCES, TRIGGER und MAINTAIN fallen ueberall. Diese drei sind reine
-- Erbschaft aus den Default-Privilegien -- eine Browser-Rolle hat nie einen
-- Grund, einen Fremdschluessel auf eine Tabelle zu legen, einen Trigger zu
-- installieren oder VACUUM/ANALYZE auszufuehren. RLS greift auf keines von
-- ihnen; hier gilt das Argument "davor steht noch RLS" so wenig wie bei
-- TRUNCATE.
--
-- Vorrang laut Abstimmung: admins und admin_emails. Dass anon dort INSERT,
-- UPDATE und DELETE haelt, ist auch mit Default-Deny durch RLS ein Zustand,
-- der nicht stehen bleiben soll. Sie stehen darum zuerst.

revoke insert, update, delete, references, trigger, maintain
  on public.admins from anon, authenticated;
revoke references, trigger, maintain
  on public.admin_emails from anon, authenticated;

-- Tabellen, auf denen anon ueberhaupt keine Policy hat: alles faellt.
revoke all on public.industry_templates from anon;
revoke all on public.outbox_events      from anon;
revoke all on public.plan_config        from anon;

-- minutes_topups: beide Rollen haben nur eine SELECT-Policy.
revoke insert, update, delete, references, trigger, maintain
  on public.minutes_topups from anon, authenticated;

-- users: SELECT und UPDATE sind durch Policies gedeckt, der Rest nicht.
revoke insert, delete, references, trigger, maintain
  on public.users from anon, authenticated;

-- calls: authenticated hat SELECT und UPDATE per Policy; DELETE nicht.
revoke delete, references, trigger, maintain
  on public.calls from authenticated;

-- customers: 13 Policies decken SELECT/INSERT/UPDATE/DELETE ab, die drei
-- Erbschaftsrechte deckt keine.
revoke references, trigger, maintain
  on public.customers from authenticated;

-- Der Rest: DML ist durch Policies gedeckt, nur die drei Erbschaftsrechte
-- fallen.
revoke references, trigger, maintain on public.customer_tasks     from anon, authenticated;
revoke references, trigger, maintain on public.feature_flags      from anon, authenticated;
revoke references, trigger, maintain on public.invoice_items      from anon, authenticated;
revoke references, trigger, maintain on public.invoice_sequences  from anon, authenticated;
revoke references, trigger, maintain on public.offer_acceptances  from anon, authenticated;
revoke references, trigger, maintain on public.offer_events       from anon, authenticated;
revoke references, trigger, maintain on public.offer_sequences    from anon, authenticated;
revoke references, trigger, maintain on public.onboarding         from anon, authenticated;
revoke references, trigger, maintain on public.push_subscriptions from anon, authenticated;
revoke references, trigger, maintain on public.voxera_cases       from anon, authenticated;

commit;

-- ── Was diese Migration NICHT tut ──────────────────────────────────────────
--
-- kantonale_notfallnummern, invoices, offers, subscriptions, contracts,
-- customer_addons, notifications, ai_change_requests, system_config: dort
-- ist jedes gehaltene Recht durch mindestens eine Policy bedienbar. Ein
-- Revoke waere hier kein Aufraeumen, sondern ein Funktionsausfall.
--
-- Die Baseline (db-security-baseline.json) wird durch diese Migration in
-- Richtung "weniger Grants" verletzt. Der Runner meldet das als PASS mit dem
-- Hinweis, die Baseline nachzuziehen -- das ist der vorgesehene Weg und
-- passiert nach der Anwendung auf Produktion, nicht vorher.
--
-- Solange diese Datei im Repo liegt und auf Produktion nicht angewandt ist,
-- meldet G-ledger sie als "NICHT angewandt" und der CI-Lauf ist rot. Das ist
-- kein Fehler der Migration, sondern genau der P0-Fehlermodus, den der Check
-- abfangen soll: Datei im Repo, Zustand auf der DB unveraendert.
