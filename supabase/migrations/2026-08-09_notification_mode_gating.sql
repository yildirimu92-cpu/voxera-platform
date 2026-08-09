-- notification_mode wird die Spalte, die den Versand tatsaechlich steuert.
--
-- Ausgangslage (Diagnose BENACHRICHTIGUNGSEINSTELLUNGEN_DIAGNOSE_UND_ZIELBILD_2026-08-09.md,
-- Befund B1): seit 2026-04-07 gilt notification_mode als "single source of
-- truth" und customer-update-settings.js schreibt ausdruecklich nur noch diese
-- Spalte. Gelesen wurde sie von keinem Versandpfad -- gegatet wurde weiterhin
-- auf notification_active (Rueckruf-Route) und new_log_email_active
-- (Alle-Anrufe-Route), also auf Werten, die seit dem Backfill von 2026-04-07
-- eingefroren sind.
--
-- Solange Make-Szenario 01 abgeschaltet war, blieb das folgenlos. Mit der
-- Migration des Anruf-Benachrichtigungspfads auf _lib/call-notification.js
-- waere es zu Fehlversand geworden, und zwar in der unangenehmen Richtung:
--
--   3 von 4 Kunden: notification_mode = 'callback_only',
--                   new_log_email_active = true
--                   -> Mail nach JEDEM Anruf, obwohl "Nur bei
--                      Rueckruf-Anfragen" gewaehlt.
--   Ein Kunde, der "Keine E-Mails" waehlt, haette weiterhin alles bekommen,
--   weil beide Booleans auf true stehen blieben.
--
-- Der Code-Teil ist erledigt: decideMail() in call-notification.js liest jetzt
-- notification_mode und die drei Booleans nirgends mehr
-- (verify-call-notification-migration.mjs prueft das auf Quellcode-Ebene).
-- Diese Migration raeumt die Datenseite dazu auf.
--
-- Was sie NICHT tut: die Wahl der Kunden aendern. notification_mode bleibt in
-- jedem Fall unangetastet -- es ist der Wert, den der Kunde gesetzt hat, und
-- damit ab jetzt der einzige, der zaehlt. Die Booleans werden ein letztes Mal
-- daraus abgeleitet (die Umkehrung des Backfills von 2026-04-07), damit kein
-- Leser ausserhalb dieses Repos -- Make-Szenario 01 laeuft noch, bis der
-- Umbau live ist -- auf einem widersprechenden Stand arbeitet.

begin;

-- ── 0. Sicherung ────────────────────────────────────────────────────────────
--
-- Der Vorher-Stand der drei Booleans ist nicht rekonstruierbar: er ist der
-- Backfill von 2026-04-07 plus vier Monate Drift durch Endpunkte, die es
-- inzwischen nicht mehr gibt. Ein Rueckbau-Skript, das ihn "ausrechnet",
-- wuerde raten. Deshalb wird er kopiert, bevor er ueberschrieben wird --
-- dasselbe Vorgehen wie bei J4.
create table if not exists public.customers_notification_backup_20260809 as
select
  id,
  notification_mode,
  notification_active,
  new_log_email_active,
  missed_call_email_active,
  in_app_notification_settings,
  now() as backed_up_at
from public.customers;

-- ── 1. Werksstandard festschreiben ──────────────────────────────────────────
--
-- Drift, die dabei auffiel (Befund B6): supabase/sql/2026-04-07_notification_
-- mode_single_source.sql setzt DEFAULT 'none', in Produktion steht seit jeher
-- DEFAULT 'callback_only'. Die SQL-Datei ist in dieser Form nie angekommen.
--
-- Angeglichen wird auf 'callback_only', also auf den Produktionsstand, nicht
-- auf die Repo-Datei: ein Rueckrufwunsch ist der Fall, in dem eine verpasste
-- Mail Geld kostet, waehrend eine Mail nach jedem Anruf bei 20 Anrufen am Tag
-- der schnellste Weg in den Spam-Ordner ist -- und damit dahin, dass auch die
-- Rueckruf-Mail nicht mehr gelesen wird. Ein neuer Kunde faengt deshalb mit
-- "Rueckrufwunsch an, jeder Anruf aus" an.
alter table public.customers
  alter column notification_mode set default 'callback_only';

-- NULL ist kein gueltiger Zustand mehr, sondern bedeutete bisher faktisch
-- "Werksstandard". Genau das wird jetzt hingeschrieben, statt es in jedem
-- Leser erneut zu raten.
--
-- Betrifft in Produktion null Zeilen (alle vier Kunden tragen einen gueltigen
-- Modus). Der Zweig ist trotzdem noetig: ein Kunde mit NULL und drei Booleans
-- auf false bekam unter dem alten Gating gar nichts und bekaeme danach die
-- Rueckruf-Mail. Das ist gewollt -- "nie eingestellt" heisst Werksstandard --,
-- aber es ist eine Verhaltensaenderung und soll nicht unbemerkt passieren.
update public.customers
set notification_mode = 'callback_only'
where notification_mode is null
   or notification_mode not in ('none', 'callback_only', 'all_calls');

-- ── 2. Legacy-Booleans ein letztes Mal angleichen ───────────────────────────
--
-- Ableitung exakt gegenlaeufig zum Backfill von 2026-04-07:
--   none          -> alles aus
--   callback_only -> notification_active + missed_call_email_active,
--                    new_log_email_active AUS  (<- der Fall, der die 3 Kunden
--                    betrifft: hier stand faelschlich true)
--   all_calls     -> alles an
update public.customers
set
  notification_active      = (notification_mode in ('callback_only', 'all_calls')),
  new_log_email_active     = (notification_mode = 'all_calls'),
  missed_call_email_active = (notification_mode in ('callback_only', 'all_calls')),
  updated_at               = now()
where notification_active      is distinct from (notification_mode in ('callback_only', 'all_calls'))
   or new_log_email_active     is distinct from (notification_mode = 'all_calls')
   or missed_call_email_active is distinct from (notification_mode in ('callback_only', 'all_calls'));

-- Die Defaults der Booleans wandern mit, sonst startet der naechste Neukunde
-- wieder im Widerspruch zu seinem eigenen notification_mode: new_log_email_
-- active stand auf DEFAULT true, notification_mode auf 'callback_only'.
alter table public.customers alter column notification_active      set default true;
alter table public.customers alter column new_log_email_active     set default false;
alter table public.customers alter column missed_call_email_active set default true;

-- ── 3. Die toten Spalten als tot markieren ──────────────────────────────────
--
-- Bewusst kein DROP. Make-Szenario 01 liest sie ueber
-- call-intake-resolve-customer.js noch, bis der migrierte Pfad live und
-- Szenario 01 abgeschaltet ist. Ein Kommentar ist die einzige Markierung, die
-- ein SELECT * ueberlebt und im Supabase-Studio sichtbar ist.
comment on column public.customers.notification_active is
  'TOT seit 2026-08-09. Kein Leser im Repo. Massgeblich ist notification_mode. '
  'Wird nur noch fuer Make-Szenario 01 mitgefuehrt und faellt mit dessen Abschaltung weg.';
comment on column public.customers.new_log_email_active is
  'TOT seit 2026-08-09. Kein Leser im Repo. Massgeblich ist notification_mode. '
  'Wird nur noch fuer Make-Szenario 01 mitgefuehrt und faellt mit dessen Abschaltung weg.';
comment on column public.customers.missed_call_email_active is
  'TOT seit 2026-08-09. Kein Leser im Repo. Massgeblich ist notification_mode. '
  'Wird nur noch fuer Make-Szenario 01 mitgefuehrt und faellt mit dessen Abschaltung weg.';
comment on column public.customers.notification_mode is
  'Einzige Quelle fuer das Gating der Anruf-Benachrichtigungen. '
  'none | callback_only (Werksstandard) | all_calls. '
  'Gelesen von _lib/call-notification.js decideMail().';

-- ── 4. In-App-Einstellungen: Default an die drei realen Kategorien angleichen ─
--
-- Befund B2: 'callbacks_and_tasks' hat in Produktion null zugeordnete Zeilen --
-- die Typen, die es filtern wuerde (callback, task_due, followup), schreibt
-- niemand. Der Schluessel bleibt im Default stehen, weil die Umsetzung ihn
-- nicht mehr rendert und ein Entfernen nur Schreibkonflikte mit alten
-- Browser-Tabs erzeugen wuerde. Kommentar statt Schema-Aenderung.
comment on column public.customers.in_app_notification_settings is
  'Glocken-Kategorien. Aktiv gerendert wird ab 2026-08-09 nur important_requests; '
  'system ist fest an, callbacks_and_tasks ist reserviert und hat bis zu einem '
  'Producer fuer callback/task_due-Zeilen keine Wirkung.';

commit;
