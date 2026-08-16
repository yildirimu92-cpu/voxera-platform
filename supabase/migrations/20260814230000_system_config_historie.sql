-- Aenderungen an system_config nachvollziehbar machen.
--
-- Anlass: #1000. Rund drei Viertel des ausgelieferten Systemprompts stammen aus
-- zwei Zeilen dieser Tabelle -- `prompt_master_l1` (9787 Zeichen) und
-- `core_field_steps` (6357). Wer sie aendert, aendert das Verhalten JEDES
-- Agenten. Es entsteht kein Commit, kein Diff, kein Vier-Augen-Schritt und
-- keine Moeglichkeit, auf einen frueheren Stand zurueckzugehen.
--
-- ── Warum eine Versionsspalte nicht genuegt ──────────────────────────────────
--
-- Eine Spalte, die hochzaehlt, sagt DASS sich etwas geaendert hat, nicht WAS.
-- Ohne den alten Wert gibt es weder einen Diff noch ein Rollback -- also
-- braucht es ohnehin einen Ort fuer die frueheren Fassungen. Genau den legt
-- diese Migration an.
--
-- ── Das Beduerfnis ist aelter als diese Migration ────────────────────────────
--
-- Zwei der fuenf Zeilen in system_config sind handgemachte Sicherungen:
-- `core_field_steps__backup_2026-08-09_e1e3` und
-- `prompt_master_l1__sicherung_2026-08-10_vor_c25_nachzug`. Jemand hat den
-- Bedarf gespuert und ihn improvisiert -- im SELBEN Schluesselraum, aus dem der
-- Sync liest. Diese Migration ersetzt die Improvisation, ohne sie zu loeschen:
-- beide Staende werden als Startbestand in die Historie uebernommen, die
-- Suffix-Zeilen bleiben vorerst stehen. Sie zu entfernen ist ein eigener,
-- umkehrbarer Schritt, nachdem die Historie sichtbar traegt.
--
-- ── `updated_at` ist heute falsch, nicht nur luecken haft ────────────────────
--
-- Die Spalte traegt `default now()`. Ein DEFAULT greift beim INSERT, nicht beim
-- UPDATE, und einen Trigger gab es nicht. Belegt am 14.08. an den Daten selbst:
--
--   `prompt_master_l1`            updated_at = 2026-05-07 18:04
--   Sicherung "vor c25 nachzug"   updated_at = 2026-08-10 17:09
--   Inhalte:                      NICHT identisch (9787 gegen 9140 Zeichen)
--
-- Die Sicherung wurde VOR einer Aenderung angelegt, und der Inhalt der
-- Live-Zeile weicht von ihr ab. Die Aenderung hat also nach dem 10.08.
-- stattgefunden -- und `updated_at` behauptet weiterhin den 7. Mai. Das Feld,
-- das die Frage "seit wann?" beantworten sollte, gibt eine falsche Antwort.
-- Der BEFORE-Trigger unten repariert das.
--
-- ── Was diese Migration NICHT leisten kann ───────────────────────────────────
--
-- Den Urheber im Sinne einer PERSON. Geschrieben wird ausschliesslich mit
-- `service_role` oder `postgres` (RLS ist an, `authenticated` darf nur SELECT),
-- in der Praxis aus dem SQL-Editor. Dort ist `auth.uid()` leer. Festgehalten
-- werden Datenbankrolle und Zeitpunkt; wo eine Sitzung eine Identitaet
-- mitbringt, auch diese. Die Spalte `geaendert_von_uid` ist deshalb NULLABLE
-- und darf nicht als Zusicherung gelesen werden.
--
-- Und: eine Pruefung VOR dem Schreiben. Dafuer muesste der Schreibweg ueber
-- eine Funktion laufen; im SQL-Editor laeuft nichts von uns. Diese Migration
-- zeichnet auf, sie verhindert nicht. Das Verhindern ist Aufgabe des Waechters
-- am Auslieferungspfad (#1000, Schritt C).
--
-- ── Bezug ───────────────────────────────────────────────────────────────────
--
-- #1000 -- der Befund, aus dem diese Migration stammt.
-- #929  -- fuehrt denselben Mangel seit laengerem ("L1 lebt in einem
--          SQL-Textfeld ohne Oberflaeche, Versionierung oder Vorschau").
--          Diese Migration loest den Versionierungsteil, nicht die Oberflaeche.

begin;

-- ── Die Historie ────────────────────────────────────────────────────────────
--
-- Bewusst eine eigene Tabelle statt weiterer Zeilen in system_config: die
-- Suffix-Sicherungen liegen heute im selben Schluesselraum, den der Sync liest.
-- Eine Historie, die der Lesepfad sehen kann, ist eine Fehlerquelle.
--
-- `wert_neu` ist bei DELETE NULL -- deshalb nullable, waehrend die Quellspalte
-- NOT NULL ist.
create table if not exists public.system_config_history (
  id               bigint generated always as identity primary key,
  key              text        not null,
  wert_alt         text,
  wert_neu         text,
  aktion           text        not null,
  geaendert_am     timestamptz not null default now(),
  geaendert_von    text        not null default current_user,
  geaendert_von_uid uuid,
  -- Freitext fuer den Startbestand und fuer spaetere manuelle Eintraege.
  -- Der Trigger laesst ihn leer; er hat nichts zu sagen, was nicht in den
  -- uebrigen Spalten steht.
  anmerkung        text,
  constraint system_config_history_aktion_check
    check (aktion in ('update', 'delete', 'startbestand'))
);

-- Die Frage, die an dieser Tabelle gestellt wird, lautet immer "welche
-- Fassungen hatte DIESER Schluessel, neueste zuerst".
create index if not exists system_config_history_key_zeit_idx
  on public.system_config_history (key, geaendert_am desc);

comment on table public.system_config_history is
  'Fassungshistorie von system_config (#1000). Geschrieben ausschliesslich vom '
  'Trigger trg_system_config_historie. `geaendert_von` traegt die Datenbankrolle, '
  'NICHT eine Person -- Schreibzugriffe laufen als service_role aus dem SQL-Editor.';

comment on column public.system_config_history.geaendert_von_uid is
  'Nur gefuellt, wenn die schreibende Sitzung eine Identitaet mitbringt. Bei '
  'service_role aus dem SQL-Editor ist auth.uid() leer -- dann NULL. Kein Beleg '
  'fuer Abwesenheit einer Person, nur fuer Abwesenheit einer Identitaet.';

-- ── Rechte: lesen wie system_config, schreiben nur der Trigger ───────────────
alter table public.system_config_history enable row level security;

drop policy if exists system_config_history_select_authenticated
  on public.system_config_history;

create policy system_config_history_select_authenticated
  on public.system_config_history
  for select
  to authenticated
  using (true);

-- Kein INSERT/UPDATE/DELETE fuer `authenticated`. Der Trigger laeuft als
-- SECURITY DEFINER und braucht die Policy nicht.
revoke all on public.system_config_history from anon;

-- ── Trigger 1: `updated_at` sagt wieder die Wahrheit ─────────────────────────
create or replace function public.fn_system_config_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_system_config_updated_at on public.system_config;

create trigger trg_system_config_updated_at
before update on public.system_config
for each row
execute function public.fn_system_config_updated_at();

-- ── Trigger 2: die Fassung vor der Aenderung sichern ────────────────────────
--
-- AFTER, nicht BEFORE: geschrieben wird nur, was tatsaechlich durchgegangen
-- ist. Ein UPDATE, das an einem Constraint scheitert, hinterlaesst keine
-- Historienzeile.
--
-- Ein UPDATE, das den Wert nicht veraendert, schreibt ebenfalls keine Zeile.
-- Sonst fuellte ein `update ... set value = value` die Historie mit Rauschen,
-- und die eine Zeile, auf die es ankommt, waere schwerer zu finden.
create or replace function public.fn_system_config_historie()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.system_config_history (key, wert_alt, wert_neu, aktion, geaendert_von_uid)
    values (old.key, old.value, null, 'delete', auth.uid());
    return old;
  end if;

  if new.value is distinct from old.value then
    insert into public.system_config_history (key, wert_alt, wert_neu, aktion, geaendert_von_uid)
    values (old.key, old.value, new.value, 'update', auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_system_config_historie on public.system_config;

create trigger trg_system_config_historie
after update or delete on public.system_config
for each row
execute function public.fn_system_config_historie();

-- ── Startbestand ────────────────────────────────────────────────────────────
--
-- Die beiden handgemachten Sicherungen als historische Eintraege. Ohne sie
-- begaenne die Historie am Tag ihrer Einfuehrung, und die Aenderung vom 10.08.
-- -- die einzige belegte Aenderung am Master-Prompt -- waere verloren.
--
-- `geaendert_am` traegt das `updated_at` der SICHERUNGSZEILE, nicht das der
-- Live-Zeile: die Sicherung wurde beim Anlegen gestempelt, und das ist der
-- Zeitpunkt, an dem der Stand galt. Die Live-Zeile traegt einen falschen
-- Stempel -- genau der Grund fuer Trigger 1.
--
-- `wert_neu` bleibt leer: was danach kam, ist der heutige Live-Wert, und den
-- hier zu kopieren hiesse, ihn an zwei Stellen zu fuehren.
--
-- Idempotent ueber `where not exists`: die Migration darf zweimal laufen, ohne
-- den Startbestand zu verdoppeln.
insert into public.system_config_history (key, wert_alt, wert_neu, aktion, geaendert_am, geaendert_von, anmerkung)
select
  'prompt_master_l1',
  sicherung.value,
  null,
  'startbestand',
  sicherung.updated_at,
  'migration',
  'Handgemachte Sicherung vor dem C25-Nachzug, uebernommen aus dem '
  'system_config-Schluessel prompt_master_l1__sicherung_2026-08-10_vor_c25_nachzug.'
from public.system_config as sicherung
where sicherung.key = 'prompt_master_l1__sicherung_2026-08-10_vor_c25_nachzug'
  and not exists (
    select 1 from public.system_config_history
    where key = 'prompt_master_l1' and aktion = 'startbestand'
  );

insert into public.system_config_history (key, wert_alt, wert_neu, aktion, geaendert_am, geaendert_von, anmerkung)
select
  'core_field_steps',
  sicherung.value,
  null,
  'startbestand',
  sicherung.updated_at,
  'migration',
  'Handgemachte Sicherung, uebernommen aus dem system_config-Schluessel '
  'core_field_steps__backup_2026-08-09_e1e3.'
from public.system_config as sicherung
where sicherung.key = 'core_field_steps__backup_2026-08-09_e1e3'
  and not exists (
    select 1 from public.system_config_history
    where key = 'core_field_steps' and aktion = 'startbestand'
  );

commit;
