-- public.ai_change_requests: mandantengebundene RLS wiederherstellen.
--
-- Kein neuer Entwurf: 2026-07-28_p0_security_foundation.sql (Zeilen 264-290)
-- definiert für diese Tabelle bereits genau den Policy-Satz, den es braucht --
-- einen Admin-Zweig über public.is_admin(auth.uid()) plus vier
-- mandantengebundene Kundenzweige über public.current_customer_id(). Diese
-- Migration setzt denselben Satz erneut, weil er auf der Produktionsdatenbank
-- nicht (mehr) aktiv ist.
--
-- Befund, der dazu geführt hat (live geprüft, nicht aus den Dateien abgeleitet):
--   * Die drei SECURITY-DEFINER-Helfer aus P0 -- current_customer_id(),
--     ensure_user_profile(), is_admin() -- sind vorhanden. Sie sind nirgends
--     sonst definiert, P0 muss also gelaufen sein.
--   * Keine der sechs Policies, die P0 anlegt, ist vorhanden.
--   * Keine der Grant-Rücknahmen aus P0 ist wirksam: anon hat weiterhin
--     INSERT auf ai_change_requests und notifications, SELECT auf
--     system_config; authenticated hat weiterhin INSERT auf calls.
--   * Stattdessen stehen auf ai_change_requests wieder die Vor-P0-Policies
--     authenticated_read_all und customer_own_requests, beide TO PUBLIC.
--   Die Funktionsebene von P0 hat also überlebt, die Policy- und Grant-Ebene
--   nicht. Diese Migration behebt das für ai_change_requests; calls,
--   notifications und system_config bleiben offen (siehe PR-Text).
--
-- Was daran das Sicherheitsproblem ist:
--   authenticated_read_all lautet `FOR ALL USING (auth.role() =
--   'authenticated')` mit leerem WITH CHECK. Bei FOR ALL fällt der Check auf
--   die USING-Bedingung zurück, es geht also nicht nur um Lesen: jeder
--   eingeloggte Kunde kann die Änderungswünsche *aller* Mandanten lesen,
--   ändern, löschen und neue mit fremder customer_id anlegen.
--   Für anon nicht erreichbar (auth.role() ist dann 'anon'), also kein Tor
--   nach aussen. Aktuell liegen 6 Zeilen von genau einem Mandanten in der
--   Tabelle -- es sind bislang keine fremden Daten einsehbar, die Lücke geht
--   in dem Moment auf, in dem ein zweiter Kunde dazukommt.
--
-- Admin-Pfad vorab geprüft, weil er an is_admin() hängt und das Admin-Panel
-- ai_change_requests über eine *authentifizierte Session* liest und schreibt
-- (admin-panel/index.html :16236/:16301/:16315/:16492/:16517), nicht über die
-- Service-Rolle: der einzige Eintrag in public.admins hat role='super_admin',
-- status='active' und eine passende auth.users-Zeile und erfüllt damit das
-- Prädikat in is_admin() (die Funktion normalisiert '_' zu '-'). Der Admin
-- sieht nach dieser Migration weiterhin alle Zeilen -- über
-- ai_change_requests_admin_all statt über authenticated_read_all.
--
-- Kundenpfad: die Kundenoberfläche macht ausschliesslich SELECT der eigenen
-- Zeilen (customer-dashboard/index.html:14310) und INSERT mit der eigenen
-- customer_id (:16408); beides deckt der P0-Satz ab.
--
-- Der Grant- und Policy-Zuschnitt ist bewusst identisch zu P0 übernommen und
-- nicht zusätzlich verschärft: eine bereits reviewte, gemergte Fassung ohne
-- neuen Anlass zu verändern würde die Prüfbarkeit dieses Schritts nur
-- verschlechtern.
--
-- Reihenfolge: supabase/verification/ai_change_requests_tenant_isolation_preflight.sql
-- vorher laufen lassen und die Ausgabe als Rollback-Evidenz sichern; danach
-- muss ai_change_requests_tenant_isolation_post_migration.sql null FAIL-Zeilen
-- melden.

begin;

do $acr$
declare
  policy_row record;
begin
  if to_regclass('public.ai_change_requests') is null then
    return;
  end if;

  -- Ohne diese beiden Helfer würden die Policies unten jeden aussperren --
  -- Admin wie Kunde. Lieber laut abbrechen als still dichtmachen.
  if to_regprocedure('public.current_customer_id()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'ai_change_requests migration aborted: public.current_customer_id() is required (2026-07-28_p0_security_foundation.sql)';
  end if;
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'ai_change_requests migration aborted: public.is_admin(uuid) is required (2026-07-28_p0_security_foundation.sql)';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_change_requests'
      and column_name = 'customer_id'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ai_change_requests migration aborted: public.ai_change_requests.customer_id is required';
  end if;

  execute 'alter table public.ai_change_requests enable row level security';

  -- Alle bestehenden Policies entfernen, nicht nur die beiden bekannten:
  -- der Ausgangszustand ist nachweislich von den Migrationsdateien abgewichen,
  -- also darf hier nichts stehen bleiben, das niemand erwartet hat.
  for policy_row in
    select p.polname
    from pg_catalog.pg_policy as p
    where p.polrelid = 'public.ai_change_requests'::regclass
  loop
    execute pg_catalog.format('drop policy if exists %I on public.ai_change_requests', policy_row.polname);
  end loop;

  execute 'revoke all privileges on table public.ai_change_requests from public';
  execute 'revoke all privileges on table public.ai_change_requests from anon';
  execute 'revoke all privileges on table public.ai_change_requests from authenticated';
  execute 'grant select, insert, update, delete on table public.ai_change_requests to authenticated';
  execute 'grant select, insert, update, delete on table public.ai_change_requests to service_role';

  execute 'create policy ai_change_requests_admin_all on public.ai_change_requests '
       || 'for all to authenticated '
       || 'using (public.is_admin(auth.uid())) '
       || 'with check (public.is_admin(auth.uid()))';

  execute 'create policy ai_change_requests_customer_select_own on public.ai_change_requests '
       || 'for select to authenticated '
       || 'using (customer_id = public.current_customer_id())';

  execute 'create policy ai_change_requests_customer_insert_own on public.ai_change_requests '
       || 'for insert to authenticated '
       || 'with check (customer_id = public.current_customer_id())';

  execute 'create policy ai_change_requests_customer_update_own on public.ai_change_requests '
       || 'for update to authenticated '
       || 'using (customer_id = public.current_customer_id()) '
       || 'with check (customer_id = public.current_customer_id())';

  execute 'create policy ai_change_requests_customer_delete_own on public.ai_change_requests '
       || 'for delete to authenticated '
       || 'using (customer_id = public.current_customer_id())';
end
$acr$;

commit;
