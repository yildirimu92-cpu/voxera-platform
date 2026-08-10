-- Geschäftsprofil entschlacken / Entscheide E1 und E3.
--
-- Ausgangslage: docs/GESCHAEFTSPROFIL_ENTSCHLACKEN_ZIELBILD_2026-08-09.md.
-- Die Geschäftsprofil-Seite zeigt jedes Thema zweimal -- oben als Freitext,
-- unten strukturiert. Bevor die Oberfläche die Freitextfelder wegnehmen darf,
-- müssen zwei Inhalte ein Zuhause bekommen, die es heute nicht haben.
--
-- E1 -- `ai_appointment_rules`. Der schwerwiegendere der beiden Punkte, und er
--   ist ein latenter Datenverlust, kein Schönheitsfehler: `parseFaqList()`
--   trennt den Freitext `ai_booking_faq` in Frage-Antwort-Paare UND in
--   Regelzeilen ("Absagen: mindestens 24 Stunden vorher -- sonst ggf.
--   Ausfallgebühr."). Die Oberfläche verspricht dazu wörtlich "Sie bleiben im
--   Text stehen". Der Prompt-Builder wählt aber mit
--   `faqList || customer.ai_booking_faq` -- sobald der Kunde die Liste
--   bestätigt, verschwindet der ganze Text und mit ihm die Regeln. Heute
--   folgenlos, weil `ai_faq_list` bei allen vier Kunden null ist; der erste
--   Kunde, der auf "Vorschlag übernehmen" klickt, verliert sie.
--
--   J8 hat diese Zeilen ausdrücklich in `default_booking_faq` gelassen und im
--   eigenen Migrationskommentar festgehalten, dass sie etwas anderes sind als
--   die Aufnahme-Checkliste: "Was bleibt: echte Terminregeln." Sie sind
--   Auskunft am Telefon und brauchen deshalb eine eigene Spalte -- dieselbe
--   Bewegung wie bei der Adresse in J6, nur ein Feld später erkannt.
--
-- E3 -- `short_description` verlässt die Kundenoberfläche. Kurzbeschreibung und
--   Unternehmensbeschreibung fragen dasselbe; ihr einziger Unterschied ist die
--   erwartete Länge. Zwei Felder, die sich nur darin unterscheiden, sind für
--   die Zielgruppe aus Grundsatz 15 nicht auseinanderzuhalten. Führend bleibt
--   `ai_business_description` -- dort liegt bei allen vier Kunden der Inhalt,
--   dorthin schreiben Website-Analyse und Admin-Wizard, und drei der vier
--   Statusmessungen lesen genau diese Spalte.
--
--   `ai_short_description` wird NICHT gelöscht und NICHT geleert: der
--   Admin-Wizard pflegt sie weiter, und der Prompt-Builder stellt sie
--   unverändert voran, wenn sie sich vom langen Text unterscheidet. Sie
--   verschwindet nur aus dem Formular des Kunden.
--
-- Zwei neue Schema-Attribute, beide rein additiv (ältere Renderer ignorieren
-- sie und verhalten sich wie bisher):
--
--   "audience": "admin"  -- diese Frage stellt nur der Admin-Wizard. Das Schema
--       bestimmt seit J4, WELCHE Frage gestellt wird; hier bestimmt es
--       zusätzlich, WEM. Das Kunden-Dashboard filtert solche Felder in beiden
--       Richtungen -- aus der Darstellung und aus dem Schreibpfad. Nur die
--       Darstellung zu filtern wäre eine Sperre, die ein direkter POST umgeht.
--
--   "max": <zahl>  -- Zeichenlimit für dieses Textfeld. Ohne das gilt weiterhin
--       CORE_TEXT_LIMIT (400), was für mehrere Regelzeilen zu knapp ist. Der
--       Schreibpfad deckelt den Wert zusätzlich hart (CORE_TEXT_HARD_LIMIT),
--       damit eine Zeile in system_config kein unbegrenztes Schreibrecht wird
--       -- gleiche Begründung wie bei der Spalten-Allowlist im Code.
--
-- Zur Abgrenzung, unverändert seit J4: das Schema bestimmt nicht, welche Spalte
-- beschrieben werden darf. Diese Liste steht im Code (CORE_FIELD_COLUMNS in
-- prompt-builder-v2.js, customer-update-assistant.js,
-- customer-assistant-profile.js und CORE_FIELD_COLUMN_MAP in
-- admin-panel/index.html) und wird mit dieser Migration in allen vier Dateien
-- um `ai_appointment_rules` ergänzt.
--
-- Datenlage zum Zeitpunkt der Migration (live geprüft, 09.08.): `ai_faq_list`
-- ist bei allen vier Kunden null, es ist also noch nichts verlorengegangen.
-- `ai_appointment_rules` existiert nicht, es ist nichts umzuziehen. Die
-- bestehenden Regelzeilen bleiben in `ai_booking_faq` stehen und werden dem
-- Kunden als Vorschlag angeboten -- nie automatisch übernommen (Entscheid F3).

begin;

-- 1. Spalte --------------------------------------------------------------------

alter table public.customers
  add column if not exists ai_appointment_rules text;

comment on column public.customers.ai_appointment_rules is
  'Schicht A / E1: Regeln rund um Termine (Absagefristen, Vorlauf, Mitzubringendes). Bis hierher als Regelzeilen im Freitext ai_booking_faq, wo sie die bestaetigte FAQ-Liste verdraengt haette.';

-- 2. Schema: neues Feld im bestehenden Schritt "Leistungen und häufige Fragen" --
--
-- Das Feld steht bewusst NACH den häufigen Fragen und nicht bei den Terminen im
-- ersten Schritt: der Kunde findet es dort, wo sein alter Text stand, und der
-- Vorschlag aus genau diesem Text steht direkt daneben. Die Terminbefugnis im
-- ersten Schritt beantwortet eine andere Frage -- was der Assistent DARF, nicht
-- welche Regeln er NENNT.

update public.system_config
set value = (
  select jsonb_agg(
    case
      when step->>'id' = 'betrieb_angebot'
        then jsonb_set(step, '{fields}', (step->'fields') || jsonb_build_array(
          jsonb_build_object(
            'key', 'appointment_rules',
            'column', 'ai_appointment_rules',
            'type', 'textarea',
            'label', 'Regeln rund um Termine',
            'hint', 'Eine Regel pro Zeile. Zum Beispiel Absagefristen, Vorlaufzeiten oder was mitzubringen ist.',
            'placeholder', 'Zum Beispiel: Absagen bitte mindestens 24 Stunden vorher.',
            'max', 1200
            -- Bewusst OHNE "suggestion": das ist der Marker fuer die einzeilige
            -- Vorschlagszeile ("Aus Ihren Stammdaten: <Adresse> [Übernehmen]"),
            -- und die ist fuer einen mehrzeiligen Regeltext die falsche
            -- Bauform. Am Bildschirm stand der Vorschlag dadurch zweimal
            -- untereinander. Die Regeln bekommen den Kasten mit vollem
            -- Wortlaut, wie die Listen und das Wochenraster auch.
          )
        ))
      else step
    end
    order by ord
  )
  from jsonb_array_elements(value::jsonb) with ordinality as t(step, ord)
),
updated_at = now()
where key = 'core_field_steps'
  -- Idempotent: ohne diese Bedingung haengt ein zweiter Lauf das Feld ein
  -- zweites Mal an.
  and not (value::jsonb @? '$[*].fields[*] ? (@.key == "appointment_rules")');

-- 3. Schema: die Kurzbeschreibung wird eine Admin-Frage (E3) -------------------

update public.system_config
set value = (
  select jsonb_agg(
    -- coalesce, nicht weil ein Schritt heute ohne Felder waere, sondern weil
    -- jsonb_agg ueber null Zeilen NULL liefert und jsonb_set(step, …, NULL)
    -- den ganzen Schritt zu NULL machen wuerde. Ein kuenftiger leerer Schritt
    -- soll leer bleiben und nicht das Schema zerlegen.
    jsonb_set(step, '{fields}', coalesce((
      select jsonb_agg(
        case
          when field->>'key' = 'short_description'
            then field || jsonb_build_object(
              'audience', 'admin',
              'hint', 'Wird nur im Admin gepflegt. Der Kunde pflegt die Beschreibung seines Betriebs im Geschäftsprofil.'
            )
          else field
        end
        order by ford
      )
      from jsonb_array_elements(step->'fields') with ordinality as f(field, ford)
    ), '[]'::jsonb))
    order by ord
  )
  from jsonb_array_elements(value::jsonb) with ordinality as t(step, ord)
),
updated_at = now()
where key = 'core_field_steps';

-- 4. Selbstkontrolle -----------------------------------------------------------
--
-- Gleiche Bauform wie in der J8-Migration: findet die Änderung ihr Ziel nicht,
-- bricht die Migration ab, statt eine halbe Umstellung zu hinterlassen. Ein
-- stillschweigend nicht angewandtes Schema wäre hier besonders teuer -- die
-- Oberfläche nimmt in derselben Auslieferung die Freitextfelder weg und der
-- Kunde stünde ohne Ersatzfeld da.

do $verify_e1_e3$
declare
  schema_value jsonb;
begin
  select value::jsonb into schema_value from public.system_config where key = 'core_field_steps';

  if schema_value is null then
    raise exception 'core_field_steps fehlt -- J4/J6/J7 sind auf dieser Datenbank nicht angewandt';
  end if;

  if not (schema_value @? '$[*].fields[*] ? (@.key == "appointment_rules" && @.column == "ai_appointment_rules")') then
    raise exception 'E1: Feld appointment_rules wurde nicht in core_field_steps eingefuegt';
  end if;

  if not (schema_value @? '$[*].fields[*] ? (@.key == "short_description" && @.audience == "admin")') then
    raise exception 'E3: short_description wurde nicht auf audience=admin gesetzt';
  end if;

  -- Der Schritt "Leistungen und häufige Fragen" trägt jetzt drei Felder. Weniger
  -- hiesse, dass das Anhängen eine bestehende Liste überschrieben hat.
  if (select jsonb_array_length(step->'fields')
      from jsonb_array_elements(schema_value) as step
      where step->>'id' = 'betrieb_angebot') <> 3 then
    raise exception 'E1: Schritt betrieb_angebot hat nicht die erwarteten drei Felder';
  end if;
end
$verify_e1_e3$;

commit;
