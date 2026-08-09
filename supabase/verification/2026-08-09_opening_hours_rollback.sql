-- Rückbau der Migration 2026-08-09_opening_hours.sql.
--
-- Nicht Teil des normalen Betriebs. Hier hinterlegt aus demselben Grund wie
-- beim Rückbau von core_field_layer: die Migration veraendert die eine
-- Schema-Zeile in system_config, und das ist ohne Gegenstueck nicht ohne
-- Weiteres zuruecknehmbar.
--
-- Stand vor der Migration, live abgefragt am 09.08.2026 unmittelbar davor:
--   customers.ai_opening_hours existierte nicht
--   system_config.core_field_steps enthielt genau drei Felder:
--     coverage_mode:radio, appointment_mode:radio, online_booking_url:text
--   (Laenge des Wertes: 1947 Zeichen)
--
-- Anders als bei core_field_layer enthaelt diese Migration KEINE
-- Datenaenderung an Kundenzeilen: die Spalte ist neu und ueberall NULL.
-- Der Rueckbau verliert deshalb nur, was seither bestaetigt wurde -- und
-- genau das nennt Schritt 1 ausdruecklich, statt es stillschweigend zu
-- loeschen.

begin;

-- 1. Warnung vor Datenverlust ------------------------------------------------
-- Haben Kunden seit der Migration Oeffnungszeiten bestaetigt, geht diese
-- Bestaetigung mit dem Rueckbau verloren und der Freitext fuehrt wieder.
-- Vor dem Ausfuehren pruefen:
--
--   select id, ai_opening_hours from public.customers
--   where ai_opening_hours is not null;
--
-- Ist die Liste nicht leer, zuerst sichern.

-- 2. Feld aus der Schema-Quelle nehmen ---------------------------------------
-- Entfernt genau den einen Eintrag, statt den Wert zu ueberschreiben: seit der
-- Migration koennen weitere Felder dazugekommen sein, die erhalten bleiben
-- muessen.
update public.system_config
set value = jsonb_set(
      value::jsonb,
      '{0,fields}',
      (
        select coalesce(jsonb_agg(field order by ordinality), '[]'::jsonb)
        from jsonb_array_elements(value::jsonb #> '{0,fields}') with ordinality as entry(field, ordinality)
        where entry.field ->> 'key' <> 'opening_hours'
      )
    )::text,
    updated_at = now()
where key = 'core_field_steps'
  and (value::jsonb #> '{0,fields}') @> '[{"key":"opening_hours"}]'::jsonb;

-- 3. Spalte und Formpruefung zuruecknehmen -----------------------------------
alter table public.customers drop constraint if exists customers_ai_opening_hours_shape_check;
alter table public.customers drop column if exists ai_opening_hours;

commit;
