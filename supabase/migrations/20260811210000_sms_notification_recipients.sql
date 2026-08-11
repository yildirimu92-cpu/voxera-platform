-- Empfaengermodell fuer die SMS-Benachrichtigung.
--
-- Ausgangslage (docs/SMS_BENACHRICHTIGUNG_DIAGNOSE_2026-08-11.md, Abschnitt 3):
-- `customers.sms_notify_number` ist eine einzelne text-Spalte, also genau eine
-- Nummer je Kunde. Der erste Pilotkunde -- ein Abschleppdienst -- braucht vier
-- bis fuenf. Das Team koordiniert sich heute ueber einen WhatsApp-Gruppenchat:
-- wer frei ist, faehrt.
--
-- Die Einzahl ist damit nicht bloss knapp, sondern das falsche Modell.
--
--
-- WARUM EIGENE TABELLE UND KEINE KOMMALISTE
--
-- Eine Kommaliste in der bestehenden Spalte waere die kleinere Aenderung
-- gewesen. Sie scheitert am Fehlerfall, und der ist hier der Kern: Twilio kennt
-- keine Mehrfachadressierung, fuenf Empfaenger sind fuenf einzelne Aufrufe, und
-- jeder davon kann eigenstaendig scheitern -- der eine steht im Funkloch, beim
-- anderen ist die Nummer ein Festnetzanschluss (Twilio 21614).
--
-- Ein Versand, der bei der zweiten von fuenf Nummern abbricht, waere schlimmer
-- als gar keiner: das Team glaubt, informiert worden zu sein. Also braucht jeder
-- Empfaenger einen eigenen Zustand, und dafuer braucht er eine eigene Zeile.
--
-- Aus derselben Ueberlegung wurde 2026-08-09 admin_notification_settings als
-- Tabelle statt als jsonb-Spalte angelegt. Gleicher Grund, gleiche Loesung.
--
--
-- WAS DIESE TABELLE NICHT IST
--
-- Kein Ersatz fuer `customers.sms_notify_enabled` / `sms_notify_trigger`. Die
-- beiden bleiben der Schalter und der Ausloeser fuer den Kunden als Ganzes;
-- diese Tabelle beantwortet nur "an wen". Ein Kunde mit
-- sms_notify_enabled = false verschickt nichts, egal wie viele Zeilen hier
-- stehen.
--
-- Auch kein Ersatz fuer den Anrufer-Empfaenger. Dessen Nummer kommt aus
-- `calls.caller_phone` und steht je Anruf fest -- sie gehoert nicht in eine
-- Kundenstammtabelle.

begin;

create table if not exists public.customer_notification_recipients (
  id           uuid        primary key default gen_random_uuid(),
  customer_id  text        not null references public.customers(id) on delete cascade,

  -- E.164, normalisiert durch _lib/phone-normalize.js bevor geschrieben wird.
  -- Die Pruefung hier ist die zweite Verteidigungslinie, nicht die erste: sie
  -- faengt Direktschreibungen ab, die an der Function vorbeigehen.
  phone_e164   text        not null,

  -- Fuer die Fehlermeldung, nicht fuer die Nachricht. "Ruedi ist nicht
  -- erreichbar" ist eine brauchbare Meldung, "+41791234567 ist nicht
  -- erreichbar" muss erst jemand zuordnen.
  name         text,

  -- Heute nur 'sms'. Die Spalte steht, damit ein zweiter Kanal keine
  -- Tabellenmigration braucht -- nicht, weil einer geplant waere. WhatsApp
  -- kommt ausdruecklich NICHT in Frage (siehe Diagnose, Abschnitt 8).
  channel      text        not null default 'sms',

  -- Ausgeschiedene Mitarbeiter werden deaktiviert, nicht geloescht: sonst
  -- verliert die Versandhistorie ihren Bezug.
  active       boolean     not null default true,

  -- Reihenfolge im Versand und in der Oberflaeche. Ohne sie ist die
  -- Empfaengerliste bei jedem Laden anders sortiert.
  sort_order   integer     not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint customer_notification_recipients_phone_e164_check
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),

  constraint customer_notification_recipients_channel_check
    check (channel in ('sms')),

  -- Dieselbe Nummer zweimal beim selben Kunden hiesse: zwei SMS, zwei
  -- Kosten, ein Empfaenger. Der haeufigste Weg dorthin ist ein zweiter
  -- Eintrag mit anderer Schreibweise -- den faengt die Normalisierung vor dem
  -- Schreiben ab, diese Bedingung faengt den Rest.
  constraint customer_notification_recipients_unique_number
    unique (customer_id, channel, phone_e164)
);

-- Der Versandpfad fragt immer dasselbe: alle aktiven Empfaenger eines Kunden
-- fuer einen Kanal, in Reihenfolge.
create index if not exists idx_customer_notification_recipients_lookup
  on public.customer_notification_recipients (customer_id, channel, sort_order)
  where active;

-- set_updated_at() existiert in Produktion und Staging seit langem (sie haengt
-- an customers, invoices, offers, subscriptions und weiteren), ist aber in
-- KEINER Migrationsdatei dieses Repositories definiert -- sie wurde seinerzeit
-- direkt auf der Datenbank angelegt. In einer frisch aus den Migrationen
-- aufgebauten Umgebung bricht `create trigger ... execute function
-- set_updated_at()` deshalb mit "function does not exist" ab und rollt diese
-- Migration samt Tabelle zurueck.
--
-- Der Nachtrag steht hier und nicht in einer eigenen Migration, weil er sonst
-- genau die Reihenfolgeabhaengigkeit erzeugt, die er beheben soll.
--
-- BEWUSST `if not exists` statt `create or replace`: an dieser Funktion haengen
-- die updated_at-Trigger von customers, invoices, offers, subscriptions,
-- onboarding, admins und voxera_cases. Sie zu ersetzen waere eine Aenderung an
-- sieben Tabellen, versteckt in einer SMS-Migration -- auch dann, wenn der
-- neue Rumpf identisch ist. Hier wird nur nachgetragen, was fehlt.
--
-- Die Produktionsdefinition wurde am 2026-08-11 gelesen und stimmt mit der
-- untenstehenden ueberein (plpgsql behandelt `:=` und `=` als dieselbe
-- Zuweisung):
--
--   BEGIN NEW.updated_at = now(); RETURN NEW; END;
do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    create function public.set_updated_at()
    returns trigger
    language plpgsql
    as $fn$
    begin
      new.updated_at := now();
      return new;
    end;
    $fn$;
    raise notice 'set_updated_at() nachgetragen (fehlte in dieser Umgebung).';
  end if;
end $$;

drop trigger if exists trg_customer_notification_recipients_updated_at
  on public.customer_notification_recipients;

create trigger trg_customer_notification_recipients_updated_at
  before update on public.customer_notification_recipients
  for each row execute function public.set_updated_at();

comment on table public.customer_notification_recipients is
  'Empfaenger der Team-SMS je Kunde. Eine Zeile je Nummer, damit jeder Empfaenger '
  'einen eigenen Versandzustand bekommt -- ein Fehlschlag bei einem darf die '
  'uebrigen nicht mitreissen. Nur ueber Service-Role erreichbar (Netlify-Functions), '
  'kein Browser-Zugriff. Der Anrufer-Empfaenger steht NICHT hier, er kommt je '
  'Anruf aus calls.caller_phone.';


-- Uebernahme des Bestands aus der Einzahl-Spalte.
--
-- In Produktion ist `sms_notify_number` bei allen vier Kunden leer, hier ist
-- also nichts zu uebernehmen. Der Block steht trotzdem, weil er in Staging und
-- in jeder spaeter aufgesetzten Umgebung greifen muss -- eine Migration, die
-- nur auf dem Stand einer Umgebung richtig ist, ist keine.
--
-- Die Spalte selbst bleibt vorerst stehen und wird nicht mehr gelesen. Sie
-- faellt in einer eigenen Migration, wenn der neue Pfad nachweislich traegt;
-- sie hier fallen zu lassen, waere ein Rueckweg weniger im selben Schritt, in
-- dem der neue Weg zum ersten Mal live geht.
insert into public.customer_notification_recipients (customer_id, phone_e164, name, channel, sort_order)
select c.id,
       c.sms_notify_number,
       'Uebernommen aus sms_notify_number',
       'sms',
       0
from public.customers c
where c.sms_notify_number is not null
  and btrim(c.sms_notify_number) <> ''
  and c.sms_notify_number ~ '^\+[1-9][0-9]{7,14}$'
on conflict (customer_id, channel, phone_e164) do nothing;

-- Nicht uebernommene Nummern sichtbar machen, statt sie stillschweigend zu
-- verlieren. Betroffen waere alles, was nicht in E.164 vorliegt -- die Spalte
-- hatte keine Formatpruefung.
do $$
declare
  uebrig integer;
begin
  select count(*) into uebrig
  from public.customers c
  where c.sms_notify_number is not null
    and btrim(c.sms_notify_number) <> ''
    and c.sms_notify_number !~ '^\+[1-9][0-9]{7,14}$';

  if uebrig > 0 then
    raise warning
      '% Kunde(n) tragen eine sms_notify_number, die nicht in E.164 vorliegt und '
      'deshalb nicht uebernommen wurde. Bitte von Hand nachtragen.', uebrig;
  end if;
end $$;


-- RLS: die Tabelle wird ausschliesslich ueber Netlify-Functions mit dem
-- Service-Role-Key gelesen und geschrieben. Kein direkter Zugriff aus dem
-- Browser -- deshalb RLS an und bewusst keine Policy fuer anon/authenticated,
-- statt sich auf fehlende Grants zu verlassen. Gleiches Muster wie
-- admin_notification_settings (20260809172215) und die Haertung von
-- public.notifications.
--
-- Das ist hier nicht bloss Formsache: die Tabelle ist eine Liste privater
-- Mobilnummern von Mitarbeitern. Ein Leseleck waere ein Datenschutzvorfall,
-- kein Schoenheitsfehler.
alter table public.customer_notification_recipients enable row level security;

revoke all on public.customer_notification_recipients from anon;
revoke all on public.customer_notification_recipients from authenticated;

commit;
