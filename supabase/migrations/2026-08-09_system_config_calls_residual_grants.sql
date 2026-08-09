-- Restliche Grants auf public.system_config und public.calls zuruecknehmen.
--
-- Vorgeschichte. Der Nebenfund aus der PR-#830-Diagnose lautete: `calls` haelt
-- ein INSERT fuer `authenticated`, `system_config` ein SELECT fuer `anon`.
-- BEIDE Punkte sind bereits geschlossen -- der P0-Nachzug (PR #833,
-- 2026-08-08_p0_security_foundation_catchup.sql, Ledger-Version
-- 20260808040253) hat sie mitgenommen. Am 2026-08-09 gegen die
-- Produktions-Datenbank nachgemessen: `authenticated` hat kein INSERT auf
-- calls, `anon` kein SELECT auf system_config, die Policy
-- system_config_admin_select existiert und wirkt.
--
-- Diese Migration schliesst nicht den Nebenfund, sondern das, was beim
-- Nachmessen daneben lag: der Nachzug hat auf system_config gezielt nur
-- `revoke select` ausgefuehrt, nicht `revoke all`. anon und authenticated
-- halten dort weiterhin INSERT, UPDATE, DELETE und TRUNCATE aus den
-- Supabase-Defaults.
--
-- Warum das trotz aktiver RLS zaehlt: fuer INSERT/UPDATE/DELETE haelt RLS
-- tatsaechlich zurueck (system_config hat genau eine Policy, und die gilt nur
-- fuer SELECT) -- am 2026-08-09 mit echten, zurueckgerollten Schreibversuchen
-- als anon nachgemessen: INSERT scheitert mit 42501, UPDATE und DELETE treffen
-- 0 von 3 Zeilen.
--
--   TRUNCATE ist die Ausnahme: darauf wird RLS gar nicht angewandt. Allein das
--   Grant entscheidet. Real gemessen (ebenfalls zurueckgerollt): `anon` und
--   `authenticated` konnten public.system_config truncieren, `authenticated`
--   zusaetzlich public.calls. Bei system_config traefe das
--   prompt_master_l1, core_field_steps und default_assistant_name -- also die
--   Grundlage jedes Assistenten-Prompts.
--
-- Einordnung, damit die Dringlichkeit nicht falsch gelesen wird: ueber die
-- oeffentliche Angriffsflaeche ist das heute nicht erreichbar. `anon` und
-- `authenticated` sind nur ueber PostgREST/Realtime/Storage annehmbar, und
-- keines davon setzt je ein TRUNCATE ab. Es ist eine Grant-Hygiene-Luecke, kein
-- offenes Tor -- aber eine, deren einzige Schutzschicht ausgerechnet die ist,
-- die RLS nicht abdeckt.
--
-- Belegte Abhaengigkeiten, bevor hier etwas zugeht (jede Fundstelle im Repo
-- geprueft, nicht geschaetzt):
--   * Lesen als service_role (RLS-frei, von dieser Migration unberuehrt):
--     admin-panel/netlify/functions/prompt-preview.js,
--     admin-panel/netlify/functions/trigger-elevenlabs-sync.js,
--     customer-dashboard/netlify/functions/customer-assistant-profile.js,
--     customer-dashboard/netlify/functions/customer-update-assistant.js
--   * Lesen als authenticated aus dem Browser: admin-panel/index.html
--     (`.from('system_config').select('key,value')`) -- laeuft als Admin ueber
--     die Policy system_config_admin_select. Das SELECT-Grant fuer
--     authenticated bleibt deshalb bestehen.
--   * Schreiben aus einem Browser: KEINE Fundstelle. Weder Kunden-Dashboard
--     noch Admin-Portal schreiben system_config; alle Schreibpfade laufen ueber
--     service_role.
--
-- Bewusst NICHT Teil dieser Migration (gefunden, dokumentiert, nicht
-- mitgefixt -- siehe SECURITY_RLS_LUECKEN_NACHKONTROLLE_2026-08-09.md):
--   * `authenticated` haelt TRUNCATE auch auf public.users. Gleiche Klasse,
--     andere Tabelle.
--   * `authenticated` haelt DELETE auf public.calls. In der Baseline bewusst
--     eingefroren, und mangels DELETE-Policy von RLS ohnehin blockiert.
--   * Die Policy calls_insert_service_or_admin ist wirkungslos, seit das
--     INSERT-Grant fuer authenticated zurueckgenommen wurde (gemessen: auch
--     der Admin bekommt 42501). Sie schadet nicht; sie zu entfernen waere eine
--     eigene Entscheidung.
--   * public.calls traegt drei Alt-Policies ohne Rollenbindung
--     ("Calls: Read own + Admin", "Calls: Update (Owner + Admin)",
--     admins_read_calls), die ueber public.users statt ueber
--     current_customer_id() gehen. Sie sind mandantengebunden und leaken
--     nichts, aber sie duplizieren die P0-Policies.
--
-- Idempotent: mehrfaches Ausfuehren aendert nichts.

begin;

-- ─── public.system_config: Lesen nur fuer Admins, Schreiben nur Server ──────
do $sysconf$
begin
  if to_regclass('public.system_config') is null then
    return;
  end if;

  -- RLS bleibt an; die Policy system_config_admin_select aus dem P0-Nachzug
  -- wird hier bewusst nicht angefasst.
  execute 'alter table public.system_config enable row level security';

  execute 'revoke all on table public.system_config from public';
  execute 'revoke all on table public.system_config from anon';
  execute 'revoke all on table public.system_config from authenticated';

  -- Einzige verbleibende Browser-Berechtigung: Lesen als authenticated, und
  -- auch das nur, soweit system_config_admin_select es zulaesst.
  execute 'grant select on table public.system_config to authenticated';

  -- service_role traegt jeden Schreibpfad (Prompt-Sync, Prompt-Vorschau,
  -- Assistenten-Profil) und umgeht RLS. Explizit gesetzt statt vorausgesetzt.
  execute 'grant select, insert, update, delete on table public.system_config to service_role';
end
$sysconf$;

-- ─── public.calls: TRUNCATE gehoert keiner Browser-Rolle ────────────────────
--
-- Gezielt nur TRUNCATE. SELECT, das spaltenbeschraenkte UPDATE und das in der
-- Baseline eingefrorene DELETE bleiben unveraendert -- ein `revoke all` haette
-- hier den Lesepfad des Dashboards mitgerissen.
do $calls$
begin
  if to_regclass('public.calls') is null then
    return;
  end if;
  execute 'revoke truncate on table public.calls from public';
  execute 'revoke truncate on table public.calls from anon';
  execute 'revoke truncate on table public.calls from authenticated';
end
$calls$;

commit;
