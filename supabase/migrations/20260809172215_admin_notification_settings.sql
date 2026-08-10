-- Benachrichtigungseinstellungen fuer Admins.
--
-- Ausgangslage (Diagnose BENACHRICHTIGUNGSEINSTELLUNGEN_DIAGNOSE_UND_ZIELBILD_2026-08-09.md,
-- Befunde B8/B9): von den fuenf beschlossenen Admin-Events existiert genau
-- eines als echter Versand (ai_change_request). Es traegt keinen Empfaenger im
-- Payload -- die Mail-Engine routet auf ein festes Sammelpostfach. Weder
-- public.admins noch die separate Tabelle public.admin_emails wird von
-- irgendeinem Versandpfad gelesen. Ein Admin kann heute nirgends einstellen,
-- worueber er benachrichtigt wird, weil es die Einstellung nicht gibt.
--
-- Eigene Tabelle statt jsonb-Spalte auf admins: anders als beim Kunden -- der
-- immer genau ein Empfaenger ist -- bekommt ein Event im Admin-Portal mehrere
-- Empfaenger, sobald das Team waechst. Die Empfaengerermittlung ist dann ein
-- Join und keine Schleife ueber jsonb-Dokumente. Heute ist genau ein Admin
-- aktiv, die Struktur kostet dabei nichts.
--
-- Bewusst NICHT enthalten: Rollenverteilung (welche Rolle bekommt welches
-- Event). Solo-Team, laut Fahrplan noch nicht relevant. Die Tabelle kann es
-- spaeter ueber admins.role, ohne Schema-Aenderung.

begin;

create table if not exists public.admin_notification_settings (
  admin_id        uuid        not null references public.admins(id) on delete cascade,
  event_key       text        not null,
  email_enabled   boolean     not null default true,
  -- Phase 3 aus PR #857. Es gibt noch keinen Admin-In-App-Kanal: public.
  -- notifications ist kundenseitig (customer_id + RLS auf
  -- current_customer_id()). Die Spalte steht hier, damit die Einstellungsseite
  -- sie spaeter fuellen kann, ohne dass jede Zeile migriert werden muss; die
  -- Oberflaeche rendert die Spalte bis dahin nicht.
  in_app_enabled  boolean     not null default false,
  updated_at      timestamptz not null default now(),
  primary key (admin_id, event_key),
  constraint admin_notification_settings_event_key_check
    check (event_key in (
      'ai_change_request',        -- Kunde wuenscht eine Assistenten-Aenderung
      'countersign_pending',      -- Kunde hat unterschrieben, Gegenzeichnung offen
      'contract_start_confirmed', -- Vertrag ist aktiv geworden
      'billing_delivery_failure', -- Rechnung oder Mail nicht zustellbar
      'cancellation_submitted'    -- Kunde hat gekuendigt
    ))
);

create index if not exists idx_admin_notification_settings_event
  on public.admin_notification_settings (event_key)
  where email_enabled;

-- Werksstandard, beim ersten Oeffnen der Seite geschrieben (die Function legt
-- fehlende Zeilen an). Hier zusaetzlich fuer die bereits bestehenden Admins,
-- damit der Versand nicht auf einen UI-Besuch wartet:
--
--   an:  countersign_pending, billing_delivery_failure, cancellation_submitted
--        -- blockieren oder gefaehrden Geld und brauchen eine Reaktion am
--        selben Tag;
--        ai_change_request -- der einzige, der heute schon zustellt.
--   aus: contract_start_confirmed -- Bestaetigung dessen, was der Admin selbst
--        ausgeloest hat, und im Portal ohnehin sichtbar.
insert into public.admin_notification_settings (admin_id, event_key, email_enabled)
select a.id, e.event_key, e.email_enabled
from public.admins a
cross join (values
  ('ai_change_request',        true),
  ('countersign_pending',      true),
  ('contract_start_confirmed', false),
  ('billing_delivery_failure', true),
  ('cancellation_submitted',   true)
) as e(event_key, email_enabled)
on conflict (admin_id, event_key) do nothing;

-- RLS: die Tabelle wird ausschliesslich ueber Netlify-Functions mit dem
-- Service-Role-Key gelesen und geschrieben (admin-notification-settings.js,
-- die Versandpfade). Kein direkter Zugriff aus dem Browser -- deshalb RLS an
-- und keine Policy fuer anon/authenticated, statt sich auf fehlende Grants zu
-- verlassen. Das Muster entspricht der Haertung von 2026-08-08 auf
-- public.notifications, wo genau diese Annahme ("anon hat ja keinen Grant")
-- nicht hielt.
alter table public.admin_notification_settings enable row level security;

revoke all on public.admin_notification_settings from anon;
revoke all on public.admin_notification_settings from authenticated;

comment on table public.admin_notification_settings is
  'Pro Admin und Event: bekommt dieser Admin die Benachrichtigung. '
  'Nur ueber Service-Role erreichbar (Netlify-Functions), kein Browser-Zugriff. '
  'in_app_enabled ist reserviert fuer Phase 3 (Admin-In-App-Kanal) und heute ohne Wirkung.';

commit;
