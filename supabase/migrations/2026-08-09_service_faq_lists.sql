-- J7: Leistungen als Eintraege, haeufige Fragen als Frage-Antwort-Paare.
--
-- Ausgangslage (Diagnose, Abschnitte 3.4 und 6.2): `ai_services` und
-- `ai_booking_faq` sind Bloecke aus Zeilen. Der Agent bekommt sie als
-- Fliesstext und muss selbst erkennen, wo eine Leistung aufhoert und die
-- naechste anfaengt. Die Vorlagen schreiben in Wahrheit laengst Struktur --
-- 137 Leistungszeilen ueber 19 Vorlagen, und alle 19 FAQ-Texte tragen die
-- Ueberschrift "Häufige Fragen:" mit 76 Frage-Antwort-Zeilen darunter. Diese
-- Migration gibt der vorhandenen Struktur einen Ort.
--
-- Gleiche Bauform wie die Oeffnungszeiten aus J5 und derselbe Grundsatz
-- (Entscheid F3): Der Parser schlaegt vor, der Kunde bestaetigt. Solange
-- nichts bestaetigt ist, fuehrt der Freitext und im Prompt aendert sich
-- nichts. Ist eine Liste bestaetigt, ersetzt sie den Freitext -- anders als
-- bei den Oeffnungszeiten, wo beide nebeneinander stehen bleiben mussten:
-- `ai_location_hours` traegt neben den Zeiten auch Adresse und Anfahrt,
-- `ai_services` traegt nur Leistungen. Zwei Fassungen desselben Inhalts
-- nebeneinander im Prompt waeren hier reine Doppelung.
--
-- Warum die Form so schmal ist:
--   `ai_service_list`  ein Array von Zeilen.
--   `ai_faq_list`      ein Array aus Objekten mit genau zwei Schluesseln,
--                      `q` und `a`. Ein dritter Schluessel (etwa ein Preis pro
--                      Frage) wird vom Schreibpfad abgewiesen -- was der Agent
--                      am Telefon sagen darf, soll nicht davon abhaengen, was
--                      jemand zusaetzlich in ein jsonb-Feld schreibt.
--
-- Die Constraints hier pruefen nur die aeussere Form (Array, Laenge). Die
-- Pruefung der Eintraege steht im Schreibpfad (_lib/service-faq.js,
-- sanitizeServiceList / sanitizeFaqList) und ist dort strenger: Zeichenlaenge,
-- geschweifte Klammern, halbe Paare. Eine CHECK-Bedingung, die jedes Element
-- einzeln prueft, braucht in Postgres eine Unterabfrage und ist an dieser
-- Stelle nicht erlaubt (Fehler 0A000, am 09.08. beim Oeffnungszeiten-Constraint
-- gelernt). Die zweite Sperre bleibt damit gröber als die erste -- das ist
-- bewusst so und nicht uebersehen.
--
-- Datenlage zum Zeitpunkt der Migration (live geprueft, 09.08.): beide Spalten
-- existieren nicht, es ist nichts umzuziehen. Genau ein Kunde traegt eigene
-- Texte in `ai_services` und `ai_booking_faq`; sie bleiben unangetastet und
-- fuehren weiter, bis jemand die vorgeschlagene Liste bestaetigt.

begin;

alter table public.customers
  add column if not exists ai_service_list jsonb,
  add column if not exists ai_faq_list jsonb;

comment on column public.customers.ai_service_list is
  'Schicht A / J7: bestaetigte Leistungen als Array von Zeilen. Fuehrt vor ai_services; NULL bedeutet, dass der Freitext gilt.';
comment on column public.customers.ai_faq_list is
  'Schicht A / J7: bestaetigte haeufige Fragen als Array aus {q, a}. Fuehrt vor ai_booking_faq; NULL bedeutet, dass der Freitext gilt.';

do $service_faq_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_ai_service_list_shape_check') then
    alter table public.customers add constraint customers_ai_service_list_shape_check
      check (
        ai_service_list is null
        or (jsonb_typeof(ai_service_list) = 'array' and jsonb_array_length(ai_service_list) <= 40)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_ai_faq_list_shape_check') then
    alter table public.customers add constraint customers_ai_faq_list_shape_check
      check (
        ai_faq_list is null
        or (jsonb_typeof(ai_faq_list) = 'array' and jsonb_array_length(ai_faq_list) <= 30)
      );
  end if;
end
$service_faq_checks$;

-- Ein eigener Schritt im Schema. Er steht bewusst nicht bei "Was Sie anbieten":
-- dort stehen Angaben ueber den Betrieb, hier stehen die Saetze, die der Agent
-- im Gespraech verwendet. Die beiden Feldtypen `list` und `faq` sind neu;
-- aeltere Renderer wuerden sie als Textfeld darstellen, deshalb gehoert der
-- Deploy unmittelbar hinter diese Migration.
update public.system_config
set value = (value::jsonb || jsonb_build_array(
      jsonb_build_object(
        'id', 'betrieb_angebot',
        'title', 'Leistungen und häufige Fragen',
        'sub', 'Was der Assistent im Gespräch nennen und beantworten darf.',
        'fields', jsonb_build_array(
          jsonb_build_object(
            'key', 'service_list',
            'column', 'ai_service_list',
            'type', 'list',
            'label', 'Leistungen',
            'hint', 'Eine Leistung pro Zeile. Sobald hier etwas steht, gilt diese Liste und nicht mehr der Text im Geschäftsprofil.',
            'suggestion', 'service_list'
          ),
          jsonb_build_object(
            'key', 'faq_list',
            'column', 'ai_faq_list',
            'type', 'faq',
            'label', 'Häufige Fragen',
            'hint', 'Frage und Antwort gehören zusammen. Sobald hier etwas steht, gilt diese Liste und nicht mehr der Text im Geschäftsprofil.',
            'suggestion', 'faq_list'
          )
        )
      )
    ))::text,
    updated_at = now()
where key = 'core_field_steps'
  and not (value::jsonb) @> '[{"id":"betrieb_angebot"}]'::jsonb;

commit;
