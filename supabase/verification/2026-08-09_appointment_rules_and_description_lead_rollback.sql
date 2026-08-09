-- Rückbau der Migration 2026-08-09_appointment_rules_and_description_lead.sql.
--
-- Nicht Teil des normalen Betriebs. Hier hinterlegt aus demselben Grund wie bei
-- core_field_layer und opening_hours: die Migration veraendert die eine
-- Schema-Zeile in system_config, und das ist ohne Gegenstueck nicht ohne
-- Weiteres zuruecknehmbar.
--
-- Stand vor der Migration:
--   customers.ai_appointment_rules existierte nicht
--   system_config.core_field_steps: fuenf Schritte, der Schritt
--     'betrieb_angebot' mit genau zwei Feldern (service_list, faq_list);
--     das Feld short_description im Schritt 'betrieb_profil' ohne
--     audience-Attribut und mit dem Hinweis "Ein bis zwei Saetze. Der Assistent
--     verwendet sie, wenn jemand fragt, was Sie machen."
--
-- WARNUNG VOR DATENVERLUST. Haben Kunden seit der Migration Terminregeln
-- bestaetigt, geht diese Bestaetigung mit dem Rueckbau verloren -- und anders
-- als bei den Oeffnungszeiten faellt die Angabe dann nicht auf einen Freitext
-- zurueck, sondern ersatzlos weg: die Oberflaeche nimmt in derselben
-- Auslieferung das Freitextfeld aus dem Formular. Vor dem Ausfuehren pruefen:
--
--   select id, ai_appointment_rules from public.customers
--   where ai_appointment_rules is not null;
--
-- Ist die Liste nicht leer, zuerst sichern und den Inhalt nach ai_booking_faq
-- zurueckschreiben, sonst ist er nach dem Rueckbau nirgends mehr hinterlegt.

begin;

-- 1. Feld aus der Schema-Quelle nehmen ----------------------------------------
-- Entfernt genau den einen Eintrag, statt den Wert zu ueberschreiben: seit der
-- Migration koennen weitere Felder dazugekommen sein, die erhalten bleiben
-- muessen.
update public.system_config
set value = (
  select jsonb_agg(
    case
      when step->>'id' = 'betrieb_angebot'
        then jsonb_set(step, '{fields}', coalesce((
          select jsonb_agg(field order by ford)
          from jsonb_array_elements(step->'fields') with ordinality as f(field, ford)
          where field->>'key' <> 'appointment_rules'
        ), '[]'::jsonb))
      else step
    end
    order by ord
  )
  from jsonb_array_elements(value::jsonb) with ordinality as t(step, ord)
),
updated_at = now()
where key = 'core_field_steps';

-- 2. Kurzbeschreibung wieder als Kundenfrage ----------------------------------
update public.system_config
set value = (
  select jsonb_agg(
    jsonb_set(step, '{fields}', (
      select jsonb_agg(
        case
          when field->>'key' = 'short_description'
            then (field - 'audience') || jsonb_build_object(
              'hint', 'Ein bis zwei Sätze. Der Assistent verwendet sie, wenn jemand fragt, was Sie machen.'
            )
          else field
        end
        order by ford
      )
      from jsonb_array_elements(step->'fields') with ordinality as f(field, ford)
    ))
    order by ord
  )
  from jsonb_array_elements(value::jsonb) with ordinality as t(step, ord)
),
updated_at = now()
where key = 'core_field_steps';

-- 3. Spalte entfernen ----------------------------------------------------------
-- Bewusst zuletzt: waere die Spalte vor dem Schema weg, zeigte die Oberflaeche
-- zwischenzeitlich ein Feld ohne Ziel.
alter table public.customers
  drop column if exists ai_appointment_rules;

commit;
