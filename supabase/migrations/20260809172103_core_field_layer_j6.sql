-- J6 / Schicht A, zweiter Teil: die restlichen generischen Betriebsangaben.
--
-- J4 hat den Mechanismus gebaut (typisierte Spalten, Schema in
-- system_config.core_field_steps, Spalten-Allowlist im Code), J5 die
-- Oeffnungszeiten. Diese Migration fuellt die Schicht mit den uebrigen Feldern,
-- die der Plan in docs/GESCHAEFTSWISSEN_FREITEXTFELDER_DIAGNOSE_2026-08-09.md
-- unter J6 auffuehrt: Kurzbeschreibung, Zielgruppen, Einsatzgebiet, Adresse,
-- Anfahrt, Vorbereitung -- und den Preishinweis aus Entscheid F4.
--
-- Vier Dinge sind hier bewusst so und nicht anders entschieden:
--
-- 1. Der Preishinweis ist KEIN Freitextfeld, sondern vier typisierte Spalten
--    (Preisart, Betrag, Einheit, Gueltigkeit). Entscheid F4, Abschnitt 11.4:
--    ein Kundensatz, den der Agent woertlich vorliest, legt den Preis aus
--    Kundenhand direkt in den Agentenmund. Aus typisierten Teilen formuliert
--    der Prompt-Builder den Satz selbst und haengt einen Unverbindlichkeits-
--    baustein an, den kein Kundenfeld ueberschreiben kann.
--
--    Warum vier Spalten und nicht ein jsonb-Feld: die bestehenden Renderer in
--    beiden Oberflaechen (Admin-Wizard und Kunden-Dashboard) beherrschen
--    radio/text/textarea. Ein zusammengesetzter Typ haette in beiden einen
--    neuen Renderer gebraucht, ohne dass die Angabe dadurch besser gespeichert
--    waere. Vier Spalten sind ausserdem abfragbar; ein jsonb-Bag nicht ohne
--    Weiteres.
--
-- 2. Die Adresse wird NICHT aus street/zip/city uebernommen, sondern nur
--    daraus vorgeschlagen. G7 nennt diese Spalten als Quelle, und sie sind bei
--    allen vier Kunden gefuellt -- aber sie stammen aus Offerte und Vertrag
--    (admin-panel/index.html, offer-street/ow-street) und sind damit die
--    Rechnungsadresse, nicht zwingend die Adresse, die Anrufenden genannt
--    werden soll. Sie ungefragt als Betriebsadresse zu sprechen waere derselbe
--    Fehler wie der unbestaetigte Default in sprechstunden_modus, den J4
--    zuruecknehmen musste. Die Oberflaeche schlaegt sie vor, gespeichert wird
--    erst, was der Kunde bestaetigt -- dieselbe Bauform wie der
--    Oeffnungszeiten-Vorschlag aus J5 (Entscheid F3).
--
-- 3. `ai_short_description` bekommt keine neue Spalte. Sie existiert seit
--    2026-05-09_wizard_v2_customer_fields.sql, wird vom Admin-Wizard gepflegt
--    und war bis heute im Prompt nicht sichtbar (G7). Sie wird angeschlossen,
--    nicht neu erfunden.
--
-- 4. Der Buchungslink wird nur noch gefragt, wenn ueberhaupt Termine vergeben
--    werden. Das loest die in Abschnitt 11.3 notierte Abweichung auf: bisher
--    stand das Feld unabhaengig von der Terminbefugnis im Formular, und der
--    Builder musste die Angabe im Nachhinein unterdruecken. Die Bedingung
--    steht als `show_if` im Schema; der Prompt-Builder unterdrueckt den Link
--    zusaetzlich bei Terminbefugnis "none", damit eine aeltere Antwort nicht
--    durch die Hintertuer wirksam bleibt.
--
-- Zur Abgrenzung, unveraendert seit J4: das Schema bestimmt, WELCHE Frage
-- gestellt wird. Es bestimmt NICHT, welche Spalte beschrieben werden darf --
-- diese Liste steht im Code (CORE_FIELD_COLUMNS in prompt-builder-v2.js,
-- customer-update-assistant.js, customer-assistant-profile.js und
-- CORE_FIELD_COLUMN_MAP in admin-panel/index.html). Sonst waere eine Zeile in
-- system_config eine Schreibberechtigung auf beliebige Kundenspalten.
--
-- Datenlage zum Zeitpunkt der Migration (live geprueft, 09.08.): keine der neun
-- neuen Spalten existiert, es ist also nichts umzuziehen. `ai_short_description`
-- ist bei allen vier Kunden null. Ein Kunde hat inzwischen die J4-Fragen
-- beantwortet (sprechstunden_modus = backup, ai_appointment_mode = direct) --
-- diese Antworten bleiben unangetastet.

begin;

-- 1. Spalten ------------------------------------------------------------------

alter table public.customers
  add column if not exists ai_public_address text,
  add column if not exists ai_target_groups text,
  add column if not exists ai_service_area text,
  add column if not exists ai_arrival_note text,
  add column if not exists ai_visit_preparation text,
  add column if not exists ai_pricing_mode text,
  add column if not exists ai_pricing_amount text,
  add column if not exists ai_pricing_unit text,
  add column if not exists ai_pricing_validity text;

comment on column public.customers.ai_public_address is
  'Schicht A: die Adresse, die Anrufenden genannt werden darf. Bestaetigt durch den Kunden; street/zip/city sind nur Vorschlagsquelle.';
comment on column public.customers.ai_target_groups is
  'Schicht A: fuer wen der Betrieb da ist. Bis J6 in ai_business_description eingeklebt (Zeile "Zielgruppen: …").';
comment on column public.customers.ai_service_area is
  'Schicht A: geografisches Einsatzgebiet.';
comment on column public.customers.ai_arrival_note is
  'Schicht A: Anfahrt, Parkieren, Zugang.';
comment on column public.customers.ai_visit_preparation is
  'Schicht A: was Anrufende zum Termin mitbringen oder vorbereiten sollen.';
comment on column public.customers.ai_pricing_mode is
  'Schicht A / Entscheid F4: auf_anfrage | ab_preis | fixpreis. NULL bedeutet: nicht beantwortet, der Agent behandelt es wie auf_anfrage.';
comment on column public.customers.ai_pricing_amount is
  'Schicht A / Entscheid F4: Betrag als Text, weil Waehrung und Format zur Angabe gehoeren. Nur bei ab_preis/fixpreis wirksam.';
comment on column public.customers.ai_pricing_unit is
  'Schicht A / Entscheid F4: Bezugsgroesse des Betrags, z. B. "pro Stunde". Nur bei ab_preis/fixpreis wirksam.';
comment on column public.customers.ai_pricing_validity is
  'Schicht A / Entscheid F4: Gueltigkeitshinweis, z. B. "Stand 2026". Wird dem gesprochenen Satz beigefuegt.';

-- Zweite Sperre, nicht die erste: der Schreibpfad prueft gegen das Schema
-- (sanitizeCoreFields). Diese Constraint haelt auch dann, wenn jemand direkt
-- auf der Datenbank arbeitet.
do $core_checks_j6$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_ai_pricing_mode_check') then
    alter table public.customers add constraint customers_ai_pricing_mode_check
      check (ai_pricing_mode is null or ai_pricing_mode in ('auf_anfrage','ab_preis','fixpreis'));
  end if;
end
$core_checks_j6$;

-- 2. Schema der generischen Felder -------------------------------------------
--
-- Der erste Schritt ist derselbe wie aus J4/J5, ergaenzt um die Bedingung am
-- Buchungslink. Neu sind die drei Schritte darunter.

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
          "column": "sprechstunden_modus",
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
          "key": "opening_hours",
          "column": "ai_opening_hours",
          "type": "hours",
          "label": "Reguläre Öffnungszeiten",
          "hint": "Gilt vor dem Text im Geschäftsprofil. Kurzfristige Abweichungen gehören in „Aktuelle Infos“."
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
          "placeholder": "https://",
          "show_if": { "key": "appointment_mode", "in": ["request", "direct"] }
        }
      ]
    },
    {
      "id": "betrieb_profil",
      "title": "Was Sie anbieten",
      "sub": "Damit der Assistent das Unternehmen in einem Satz erklären kann.",
      "fields": [
        {
          "key": "short_description",
          "column": "ai_short_description",
          "type": "textarea",
          "label": "Kurzbeschreibung",
          "hint": "Ein bis zwei Sätze. Der Assistent verwendet sie, wenn jemand fragt, was Sie machen.",
          "placeholder": "Zum Beispiel: Wir sind eine Zahnarztpraxis in Luzern mit Schwerpunkt Kinderzahnmedizin."
        },
        {
          "key": "target_groups",
          "column": "ai_target_groups",
          "type": "textarea",
          "label": "Für wen Sie da sind",
          "hint": "Hilft dem Assistenten zu erkennen, ob ein Anliegen zu Ihnen passt.",
          "placeholder": "Zum Beispiel: Privatpersonen und kleine Betriebe; keine Grossbaustellen."
        },
        {
          "key": "service_area",
          "column": "ai_service_area",
          "type": "text",
          "label": "Einsatzgebiet",
          "hint": "Nur ausfüllen, wenn Sie auch ausser Haus tätig sind.",
          "placeholder": "Zum Beispiel: Stadt Luzern und Umgebung, bis 20 km"
        }
      ]
    },
    {
      "id": "betrieb_besuch",
      "title": "Anfahrt und Besuch",
      "sub": "Was Anrufende wissen müssen, bevor sie vorbeikommen.",
      "fields": [
        {
          "key": "public_address",
          "column": "ai_public_address",
          "type": "text",
          "label": "Adresse für Anrufende",
          "hint": "Diese Adresse nennt der Assistent am Telefon. Solange sie leer ist, nennt er keine.",
          "placeholder": "Strasse Nr., PLZ Ort",
          "suggestion": "public_address"
        },
        {
          "key": "arrival_note",
          "column": "ai_arrival_note",
          "type": "textarea",
          "label": "Anfahrt und Parkieren",
          "hint": "Zum Beispiel Eingang, Stockwerk, Parkplätze oder Haltestelle.",
          "placeholder": "Zum Beispiel: Eingang im Hof, 2. Stock. Parkplätze hinter dem Haus."
        },
        {
          "key": "visit_preparation",
          "column": "ai_visit_preparation",
          "type": "textarea",
          "label": "Was mitgebracht werden soll",
          "hint": "Der Assistent sagt das bei Terminvereinbarungen von sich aus.",
          "placeholder": "Zum Beispiel: Versichertenkarte und bisherige Befunde."
        }
      ]
    },
    {
      "id": "betrieb_preise",
      "title": "Preisauskunft",
      "sub": "Was der Assistent auf Preisfragen antworten darf. Ohne Angabe bietet er an, dass Sie sich mit einer Offerte melden.",
      "fields": [
        {
          "key": "pricing_mode",
          "column": "ai_pricing_mode",
          "type": "radio",
          "label": "Preisauskunft am Telefon",
          "hint": "Genannt wird ausschliesslich, was Sie hier hinterlegen. Der Assistent leitet keine Preise ab.",
          "options": [
            { "val": "auf_anfrage", "label": "Keine Preise nennen", "sub": "Der Assistent bietet an, dass Sie sich mit einer Offerte melden." },
            { "val": "ab_preis", "label": "Ab-Preis nennen", "sub": "Der Assistent nennt einen Richtwert nach oben offen." },
            { "val": "fixpreis", "label": "Festen Preis nennen", "sub": "Der Assistent nennt einen festen Betrag als Richtwert." }
          ]
        },
        {
          "key": "pricing_amount",
          "column": "ai_pricing_amount",
          "type": "text",
          "label": "Betrag",
          "hint": "Mit Währung, so wie er gesprochen werden soll.",
          "placeholder": "Zum Beispiel: CHF 120",
          "show_if": { "key": "pricing_mode", "in": ["ab_preis", "fixpreis"] }
        },
        {
          "key": "pricing_unit",
          "column": "ai_pricing_unit",
          "type": "text",
          "label": "Wofür der Betrag gilt",
          "hint": "Ohne diese Angabe bleibt der Betrag im Gespräch unklar.",
          "placeholder": "Zum Beispiel: pro Stunde",
          "show_if": { "key": "pricing_mode", "in": ["ab_preis", "fixpreis"] }
        },
        {
          "key": "pricing_validity",
          "column": "ai_pricing_validity",
          "type": "text",
          "label": "Gültigkeitshinweis (optional)",
          "hint": "Wird mitgesprochen, damit ein alter Richtwert erkennbar bleibt.",
          "placeholder": "Zum Beispiel: Stand 2026",
          "show_if": { "key": "pricing_mode", "in": ["ab_preis", "fixpreis"] }
        }
      ]
    }
  ]$core_schema$,
  now()
)
on conflict (key) do update set value = excluded.value, updated_at = now();

commit;
