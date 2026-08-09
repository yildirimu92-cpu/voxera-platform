-- Rückbau der Migration 2026-08-09_core_field_layer.sql.
--
-- Nicht Teil des normalen Betriebs. Hier hinterlegt, weil die Migration eine
-- Datenaenderung enthaelt und Vorlagen bearbeitet -- beides ist ohne
-- Gegenstueck nicht ohne Weiteres zuruecknehmbar.
--
-- Stand vor der Migration, live abgefragt am 09.08.2026 unmittelbar davor:
--   customers.sprechstunden_modus = 'rund_um_die_uhr' bei allen vier Kunden
--     cust_1786034079785_z8voxt, cust_1786038570979_7r8y29,
--     cust_1786042447224_k879a8, cust_1786050506781_pswyft
--   customers.ai_appointment_mode existierte nicht
--   system_config.core_field_steps existierte nicht
--   industry_templates: 39 extra_steps-Felder in 7 Vorlagen
--
-- Schritte 1-3 stellen den Ausgangszustand exakt wieder her.

begin;

-- 1. Datenaenderung zuruecknehmen ---------------------------------------------
-- Nur dort, wo die Migration genullt hat. Ein Wert, den seither jemand
-- ausdruecklich gesetzt hat, bleibt unangetastet.
update public.customers
set sprechstunden_modus = 'rund_um_die_uhr'
where sprechstunden_modus is null
  and id in (
    'cust_1786034079785_z8voxt',
    'cust_1786038570979_7r8y29',
    'cust_1786042447224_k879a8',
    'cust_1786050506781_pswyft'
  );

-- 2. Schema und Spalte zuruecknehmen ------------------------------------------
alter table public.customers drop constraint if exists customers_sprechstunden_modus_check;
alter table public.customers drop constraint if exists customers_ai_appointment_mode_check;
alter table public.customers drop column if exists ai_appointment_mode;
alter table public.customers alter column sprechstunden_modus set default 'rund_um_die_uhr';
delete from public.system_config where key = 'core_field_steps';

commit;

-- 3. Vorlagen ------------------------------------------------------------------
--
-- Bewusst NICHT automatisiert. Die Migration hat aus sieben Vorlagen die
-- Felder `sprechstunden_modus` (7x), `termin_modus` (5x) und `booking_url`
-- (4x) entfernt, insgesamt 16 von 39. Welche Vorlage welches Feld trug, steht
-- vollstaendig in Abschnitt 4.3 der Diagnose
-- (docs/GESCHAEFTSWISSEN_FREITEXTFELDER_DIAGNOSE_2026-08-09.md).
--
-- Ein Rueckbau waere nur dann noetig, wenn Schicht A insgesamt aufgegeben wird.
-- Solange sie steht, sind diese drei Fragen zentral gestellt und in den
-- Vorlagen bewusst nicht mehr vorhanden -- ein Wiedereinsetzen erzeugte genau
-- die Doppelung, die J4 beseitigt hat.
