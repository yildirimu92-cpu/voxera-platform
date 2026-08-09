-- public.customers_notification_backup_20260809 gegen die Browser-Rollen schliessen.
--
-- Befund vom 2026-08-09, vom 6-Stunden-Lauf gemeldet und danach von Hand
-- nachgemessen statt geglaubt:
--
--     [FAIL] keine neue Tabelle ohne RLS
--            ohne RLS: customers_notification_backup_20260809
--     [FAIL] anon hat neue Rechte auf customers_notification_backup_20260809
--            neu hinzugekommen: DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,UPDATE
--
-- Eine echte `anon`-Session hat 4 Zeilen aus der Tabelle gelesen. RLS war aus,
-- 0 Policies, `anon` hielt SELECT. Das ist eine andere Kategorie als die
-- TRUNCATE-Luecke aus 2026-08-09_truncate_grant_sweep.sql: TRUNCATE war ueber
-- PostgREST nicht erreichbar, ein SELECT ist es. Mit dem anon-Key -- der im
-- Browser jedes Besuchers steht -- waren die Benachrichtigungseinstellungen
-- aller Mandanten lesbar.
--
-- Inhalt (deshalb Mandantendaten, nicht Konfiguration):
--   id, notification_mode, notification_active, new_log_email_active,
--   missed_call_email_active, in_app_notification_settings, backed_up_at
--
-- Herkunft: die Tabelle entstand als einmaliges Sicherungsnetz einer parallel
-- laufenden Umstellung (Ledger admin_notification_settings_20260809 /
-- notification_mode_gating_20260809). Sie ist damit genau der Fall, den die
-- Default-Privilegien so gefaehrlich machen: `create table` genuegt, und
-- anon/authenticated haben Vollzugriff, ohne dass jemand eine Entscheidung
-- getroffen haette.
--
-- Belegt, bevor hier etwas zugeht: KEINE Fundstelle im Repo liest oder
-- schreibt diese Tabelle -- weder Kunden-Dashboard noch Admin-Portal noch eine
-- Netlify-Function. Sie ist ein Migrations-Backup und gehoert ausschliesslich
-- dem Server.
--
-- Warum trotz `revoke all` zusaetzlich RLS: db_security_invariants fuehrt
-- Grants und Policies als unabhaengige Kontrollen, und eine Tabelle ohne RLS
-- bricht ausserdem den Baseline-Check. Beides zusammen ist auch inhaltlich
-- richtig -- faellt eines der beiden je zurueck, haelt das andere noch.
--
-- Idempotent: mehrfaches Ausfuehren aendert nichts.

begin;

do $lockdown$
begin
  if to_regclass('public.customers_notification_backup_20260809') is null then
    return;
  end if;

  execute 'alter table public.customers_notification_backup_20260809 enable row level security';

  execute 'revoke all on table public.customers_notification_backup_20260809 from public';
  execute 'revoke all on table public.customers_notification_backup_20260809 from anon';
  execute 'revoke all on table public.customers_notification_backup_20260809 from authenticated';

  -- Der Server behaelt den vollen Zugriff: die Tabelle muss lesbar bleiben,
  -- falls die Umstellung zurueckgenommen werden muss -- das ist ihr Zweck.
  execute 'grant select, insert, update, delete on table public.customers_notification_backup_20260809 to service_role';
end
$lockdown$;

commit;
