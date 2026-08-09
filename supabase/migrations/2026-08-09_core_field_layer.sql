-- J4 / Schicht A: generische Betriebsfelder bekommen einen eigenen Ort.
--
-- Ausgangslage (Diagnose GESCHAEFTSWISSEN_FREITEXTFELDER_DIAGNOSE_2026-08-09.md,
-- Abschnitte 4.2 und 7): Drei der zwanzig `extra_steps`-Schluessel sind gar
-- nicht branchenspezifisch. `sprechstunden_modus` steht wortgleich in allen
-- sieben Vorlagen mit `extra_steps`, `termin_modus` in fuenf, `booking_url` in
-- vier -- und den zwoelf Vorlagen ohne `extra_steps` fehlen sie vollstaendig.
-- Wer heute `handwerk`, `anwalt`, `zahnarzt`, `treuhand` oder `it-support`
-- zugeordnet bekommt, kann seinen Einsatz-Modus nicht angeben, obwohl die
-- Frage mit der Branche nichts zu tun hat.
--
-- Diese Migration macht drei Dinge:
--   1. zwei typisierte Spalten fuer die generischen Antworten,
--   2. das Schema der generischen Felder als eine Quelle in system_config,
--   3. die drei Schluessel aus den sieben Branchenvorlagen entfernen.
--
-- Warum typisierte Spalten und nicht `customers.ai_branch_extra` (Entscheid F1):
--   customer-update-assistant.js antwortet mit HTTP 409 `no_industry_template`,
--   sobald ein Kunde keine `industry_template_id` hat. Das trifft aktuell 3 von
--   4 Kunden. Generische Felder in denselben Bag zu legen hiesse: der
--   Einsatz-Modus waere erst nach der Branchenzuordnung erfassbar. Ausserdem
--   braucht `ai_appointment_mode` einen zweiten Leser (die Terminlogik), und
--   die Oeffnungszeiten aus J5 werden gegen `calendar_settings.business_hours`
--   geprueft -- beides ist aus einem vorlagenabhaengigen jsonb-Bag heraus nicht
--   sauber les- oder migrierbar.
--
-- Warum das Schema trotzdem in der Datenbank liegt und nicht im Code:
--   admin-panel und customer-dashboard sind zwei getrennte Netlify-Sites ohne
--   gemeinsamen Modulpfad (je `publish = "."`, eigene functions-Verzeichnisse).
--   Ein JS-Modul muesste in beide Baeume kopiert werden -- genau die Doppelung,
--   die dieser Auftrag beseitigt. Die Datenbank ist der einzige Ort, den beide
--   Seiten ohne Kopie lesen. Die Form ist absichtlich identisch mit
--   `industry_templates.extra_steps`, damit Renderer und Allowlist dieselben
--   bleiben.
--
--   Wichtig zur Abgrenzung: das Schema bestimmt, WELCHE Frage gestellt wird und
--   wie sie heisst. Es bestimmt NICHT, welche Spalte beschrieben werden darf --
--   diese Liste steht im Code (CORE_FIELD_COLUMNS). Sonst waere eine Zeile in
--   system_config eine Schreibberechtigung auf beliebige Kundenspalten.
--
-- Datenlage zum Zeitpunkt der Migration (live geprueft, 09.08.):
--   `ai_branch_extra` ist bei allen 4 Kunden null, kein Kunde traegt eine
--   `[WIZARD]`-Zeile in `ai_internal_notes`, `ai_online_booking_url` ist
--   ueberall null. Es gibt also keine Antwort, die umgezogen werden muesste --
--   deshalb enthaelt diese Migration bewusst keine Datenuebernahme. Dieses
--   Fenster schliesst sich, sobald der erste Kunde Branchenfelder ausfuellt.
--
-- Keine Spalten-Grants noetig: beide Schreibpfade (customer-update-assistant.js
-- und admin-mutate) laufen ueber den Service-Role-Key und damit an RLS und
-- Spaltenrechten vorbei. Die Allowlist aus 2026-08-06_p0_rls_tenant_isolation
-- (UPDATE fuer `authenticated` auf genau drei Spalten) bleibt unangetastet --
-- kein Kundenbrowser schreibt diese Felder direkt.

begin;

-- 1. Typisierte Spalten -------------------------------------------------------
--
-- `ai_appointment_mode` loest zugleich eine bestehende Doppelung auf: dieselbe
-- Entscheidung lag bisher zweimal vor, als `termin_modus` (aufnehmen|direkt) in
-- den Branchenvorlagen und als `appointmentMode` (none|request|direct) in der
-- `[PROMPT_V2]`-Zeile. Uebernommen wird das reichere Vokabular; der
-- Prompt-Builder liest ab jetzt die Spalte zuerst und faellt nur fuer Kunden,
-- die seither nicht neu gespeichert wurden, auf die Notiz-Zeile zurueck --
-- dieselbe Rangfolge wie bei ai_branch_extra seit D4/E10.

alter table public.customers
  add column if not exists ai_coverage_mode text,
  add column if not exists ai_appointment_mode text;

comment on column public.customers.ai_coverage_mode is
  'Schicht A: wann der Assistent Anrufe uebernimmt. rund_um_die_uhr | ausserhalb_sprechstunde | backup. Schema in system_config.core_field_steps.';
comment on column public.customers.ai_appointment_mode is
  'Schicht A: Terminbefugnis. none | request | direct. Fuehrende Quelle vor [PROMPT_V2].appointmentMode.';

-- Werte werden im Schreibpfad gegen das Schema geprueft (sanitizeCoreFields).
-- Die Constraints hier sind die zweite Sperre, nicht die erste: sie halten auch
-- dann, wenn jemand direkt auf der Datenbank arbeitet.
do $core_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_ai_coverage_mode_check') then
    alter table public.customers add constraint customers_ai_coverage_mode_check
      check (ai_coverage_mode is null or ai_coverage_mode in ('rund_um_die_uhr','ausserhalb_sprechstunde','backup'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_ai_appointment_mode_check') then
    alter table public.customers add constraint customers_ai_appointment_mode_check
      check (ai_appointment_mode is null or ai_appointment_mode in ('none','request','direct'));
  end if;
end
$core_checks$;

-- 2. Schema der generischen Felder -------------------------------------------
--
-- Gleiche Form wie extra_steps, plus `column` je Feld: damit kennt der
-- Schreibpfad Ziel und Regel aus derselben Quelle. Die Optionstexte sind
-- bewusst neu formuliert und nennen keinen Assistentennamen -- die
-- Vorlagentexte tun das ("Lara springt ein wenn der Salon geschlossen ist")
-- und muessen deshalb im Builder nachbehandelt werden. Hier faellt das weg.

insert into public.system_config (key, value, updated_at)
values (
  'core_field_steps',
  $core_schema$[
    {
      "id": "betrieb_kern",
      "title": "Erreichbarkeit und Termine",
      "sub": "Diese Angaben gelten für jeden Betrieb, unabhängig von der Branche.",
      "fields": [
        {
          "key": "coverage_mode",
          "column": "ai_coverage_mode",
          "type": "radio",
          "label": "Wann übernimmt der Assistent",
          "hint": "Bestimmt, welche Anrufe überhaupt beim Assistenten landen.",
          "options": [
            { "val": "rund_um_die_uhr", "label": "Immer", "sub": "Alle Anrufe werden entgegengenommen, auch nachts und am Wochenende." },
            { "val": "ausserhalb_sprechstunde", "label": "Nur ausserhalb der Öffnungszeiten", "sub": "Der Assistent springt ein, wenn der Betrieb geschlossen ist." },
            { "val": "backup", "label": "Nur wenn niemand abhebt", "sub": "Der Assistent übernimmt erst, wenn im Betrieb niemand den Anruf annimmt." }
          ]
        },
        {
          "key": "appointment_mode",
          "column": "ai_appointment_mode",
          "type": "radio",
          "label": "Termine",
          "hint": "Was der Assistent bei Terminwünschen tun darf.",
          "options": [
            { "val": "none", "label": "Keine Termine", "sub": "Es werden keine Termine vereinbart; bei Bedarf wird ein Rückruf angeboten." },
            { "val": "request", "label": "Terminwunsch aufnehmen", "sub": "Wunschzeit und Kontakt werden erfasst; der Betrieb bestätigt selbst." },
            { "val": "direct", "label": "Direkt buchen", "sub": "Nur mit verbundenem Kalender: freie Zeiten prüfen und verbindlich buchen." }
          ]
        },
        {
          "key": "online_booking_url",
          "column": "ai_online_booking_url",
          "type": "text",
          "label": "Online-Buchungslink (optional)",
          "hint": "Nur nötig, wenn Anrufende stattdessen selbst online buchen sollen.",
          "placeholder": "https://"
        }
      ]
    }
  ]$core_schema$,
  now()
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- 3. Die drei Schluessel aus den Branchenvorlagen entfernen -------------------
--
-- Entscheid F6. Ein Schritt, dessen Felder dabei vollstaendig entfallen, wird
-- mit entfernt -- sonst bliebe im Wizard eine leere Seite stehen.

with cleaned as (
  select
    t.id,
    coalesce(
      jsonb_agg(jsonb_set(step.value, '{fields}', f.fields_clean) order by step.ordinality)
        filter (where jsonb_array_length(f.fields_clean) > 0),
      '[]'::jsonb
    ) as new_steps
  from public.industry_templates t
  cross join lateral jsonb_array_elements(t.extra_steps) with ordinality as step(value, ordinality)
  cross join lateral (
    select coalesce(jsonb_agg(fld.value order by fld.ordinality), '[]'::jsonb) as fields_clean
    from jsonb_array_elements(coalesce(step.value -> 'fields', '[]'::jsonb)) with ordinality as fld(value, ordinality)
    where coalesce(fld.value ->> 'key', '') not in ('sprechstunden_modus', 'termin_modus', 'booking_url')
  ) f
  where jsonb_typeof(t.extra_steps) = 'array'
  group by t.id
)
update public.industry_templates t
set extra_steps = c.new_steps
from cleaned c
where c.id = t.id
  and t.extra_steps is distinct from c.new_steps;

commit;
