-- RLS-Hygiene auf public.calls: drei Alt-Policies und eine wirkungslose
-- Insert-Policy aufraeumen. Diagnose stammt aus der P0-Security-Nachziehung
-- (zurueckgestellt), jetzt live gegen pg_policy auf Produktion verifiziert.
--
-- 1) Drei Alt-Policies aus der Zeit vor den heutigen Helper-Funktionen
--    (is_admin(), current_customer_id()) sind Duplikate der aktuellen
--    Policies fuer denselben Befehl:
--      "Calls: Read own + Admin"   (SELECT) -> Duplikat von calls_select_own
--                                                + calls_select_admin
--      admins_read_calls           (SELECT) -> Duplikat von calls_select_admin
--      "Calls: Update (Owner + Admin)" (UPDATE) -> Duplikat von calls_update_own
--    Alle drei haben ein leeres polroles-Array (gelten fuer jede Rolle, nicht
--    nur authenticated) und pruefen dieselbe Berechtigung wie die jeweilige
--    aktuelle Policy ueber eine aeltere, join-basierte Formulierung. Das
--    aendert am Ergebnis nichts (RLS-Policies sind permissiv/ODER-verknuepft,
--    die neuen Policies decken dieselbe Berechtigung ab), macht die
--    Policy-Menge aber unnoetig schwer auditierbar.
--
-- 2) calls_insert_service_or_admin (INSERT, Rolle authenticated) ist
--    wirkungslos: der einzige Insert-Pfad auf calls laeuft ausschliesslich
--    ueber den Service-Role-Client in
--    customer-dashboard/netlify/functions/elevenlabs-post-call.js, und
--    Service-Role umgeht RLS grundsaetzlich. Kein Code-Pfad inserted mit
--    einem authenticated-Nutzerkontext, die Policy wird nie ausgewertet.
--
-- 3) Es gibt bewusst keine DELETE-Policy auf calls. Ohne Policy liefert RLS
--    per Default-Deny keinen Zugriff fuer anon/authenticated -- das ist der
--    Zielzustand (Anrufdatensaetze werden nie ueber den Browser-Client
--    geloescht) und wird hier nur dokumentiert, nicht durch eine neue Policy
--    ersetzt.
--
-- Review-Nachtrag (#910): calls_select_admin/calls_select_own/calls_update_own
-- werden unten als Duplikat-Ziel genannt, aber keine Migration im Repo legt
-- sie an -- sie existieren nur live auf Produktion/Staging (vermutlich aus
-- der P0-Nachziehung, ausserhalb von supabase/migrations angewendet). Ein
-- Restore oder eine neue Umgebung ohne diesen Drift haette nach den Drops
-- unten keinen SELECT/UPDATE-Zugriff mehr auf calls. Deshalb zuerst die drei
-- kanonischen Policies idempotent sicherstellen (Ausdruecke 1:1 aus der
-- Live-Diagnose gegen pg_policy uebernommen), erst danach die Alt-Policies
-- droppen.

begin;

do $ensure_canonical$
begin
  if not exists (
    select 1 from pg_policy where polname = 'calls_select_admin' and polrelid = 'public.calls'::regclass
  ) then
    execute 'create policy calls_select_admin on public.calls for select to authenticated using (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policy where polname = 'calls_select_own' and polrelid = 'public.calls'::regclass
  ) then
    execute 'create policy calls_select_own on public.calls for select to authenticated using (customer_id = public.current_customer_id())';
  end if;

  if not exists (
    select 1 from pg_policy where polname = 'calls_update_own' and polrelid = 'public.calls'::regclass
  ) then
    execute 'create policy calls_update_own on public.calls for update to authenticated using (customer_id = public.current_customer_id()) with check (customer_id = public.current_customer_id())';
  end if;
end
$ensure_canonical$;

drop policy if exists "Calls: Read own + Admin" on public.calls;
drop policy if exists "admins_read_calls" on public.calls;
drop policy if exists "Calls: Update (Owner + Admin)" on public.calls;
drop policy if exists "calls_insert_service_or_admin" on public.calls;

commit;
