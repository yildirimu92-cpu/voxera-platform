-- J5 / Schicht A: Öffnungszeiten werden maschinenlesbar.
--
-- Ausgangslage (Diagnose GESCHAEFTSWISSEN_FREITEXTFELDER_DIAGNOSE_2026-08-09.md,
-- Abschnitt 3.3): `ai_location_hours` traegt in den 19 Vorlagen bis zu sechs
-- Informationstypen als Fliesstext -- Adresse (19/19), Zeiten (19/19),
-- Notfallnummer (7/19), Anfahrt (5/19), Einsatzgebiet (2/19), Vorbereitung
-- (3/19). Die Zeiten daraus sind fuer den Agenten lesbar, fuer Code nicht.
--
-- Zwei Konsumenten brauchen sie maschinenlesbar:
--   1. `sprechstunden_modus = 'ausserhalb_sprechstunde'` (Schicht A seit J4)
--      setzt voraus, dass "ausserhalb" ueberhaupt bestimmbar ist. Die Frage
--      wird heute gestellt und ist nicht beantwortbar (Abschnitt 4.2).
--   2. `calendar_settings.business_hours` (Befund G2) ist definiert, hat
--      denselben Zuschnitt und keinen Leser. Die Terminbuchung prueft heute
--      nicht gegen Oeffnungszeiten -- das ist als eigener Auftrag entschieden
--      (F5/J3, nach J5) und baut auf genau dieser Struktur auf.
--
-- Deshalb ist die Struktur bewusst identisch mit `business_hours`:
--   {"mon":[["08:00","17:00"]],"tue":[...],...,"sat":[],"sun":[]}
-- Tagesschluessel mon..sun, je eine Liste von [von,bis]-Paaren. Mehrere Paare
-- pro Tag bilden Mittagspausen ab, die in den Vorlagen der Normalfall sind
-- ("Montag–Freitag 08:30–12:00 und 13:30–17:30 Uhr"). Eine leere Liste heisst
-- geschlossen.
--
-- NULL heisst "noch nicht bestaetigt" und ist der Ausgangszustand aller
-- Kunden. Solange NULL, fuehrt der Freitext (Entscheid F3): der Parser schlaegt
-- vor, der Kunde bestaetigt, erst die Bestaetigung schreibt hier hinein. Ein
-- automatisch geparster Zeitplan, den niemand geprueft hat, wuerde sonst zur
-- Aussage des Assistenten am Telefon.
--
-- Kein Spalten-Default -- aus demselben Grund wie bei sprechstunden_modus in
-- der Migration davor: ein unbestaetigter Default darf nicht als Fakt gelten.

begin;

alter table public.customers
  add column if not exists ai_opening_hours jsonb;

comment on column public.customers.ai_opening_hours is
  'Schicht A: regulaere Oeffnungszeiten, Struktur identisch mit calendar_settings.business_hours ({"mon":[["08:00","17:00"]],...}). NULL bedeutet: noch nicht bestaetigt, dann fuehrt der Freitext in ai_location_hours.';

-- Formpruefung in der Datenbank. Sie ist die zweite Sperre, nicht die erste --
-- die inhaltliche Pruefung (Zeitformat, von < bis, keine Ueberschneidungen)
-- macht der Schreibpfad in _lib/opening-hours.js. Hier steht nur, was ohne
-- Anwendungscode gelten muss: ein Objekt, ausschliesslich die sieben
-- Tagesschluessel, und je Tag eine Liste.
do $opening_hours_check$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_ai_opening_hours_shape_check') then
    -- Bewusst ohne Unterabfrage: CHECK-Constraints duerfen in PostgreSQL keine
    -- enthalten (Fehler 0A000, im Staging-Lauf aufgefallen). Stattdessen zwei
    -- mengenwertige Ausdruecke:
    --   1. Nach dem Entfernen der sieben bekannten Tagesschluessel muss ein
    --      leeres Objekt uebrig bleiben -- damit sind Fremdschluessel
    --      ausgeschlossen, ohne ueber die Schluessel zu iterieren.
    --   2. Je Tag muss der Wert eine Liste sein. Fehlt der Schluessel, liefert
    --      `->` SQL-NULL und der Vergleich ist unbestimmt; `coalesce(..., true)`
    --      erklaert das ausdruecklich fuer zulaessig -- ein fehlender Tag heisst
    --      geschlossen, nicht ungueltig.
    alter table public.customers add constraint customers_ai_opening_hours_shape_check
      check (
        ai_opening_hours is null
        or (
          jsonb_typeof(ai_opening_hours) = 'object'
          and (ai_opening_hours - 'mon' - 'tue' - 'wed' - 'thu' - 'fri' - 'sat' - 'sun') = '{}'::jsonb
          and coalesce(jsonb_typeof(ai_opening_hours -> 'mon') = 'array', true)
          and coalesce(jsonb_typeof(ai_opening_hours -> 'tue') = 'array', true)
          and coalesce(jsonb_typeof(ai_opening_hours -> 'wed') = 'array', true)
          and coalesce(jsonb_typeof(ai_opening_hours -> 'thu') = 'array', true)
          and coalesce(jsonb_typeof(ai_opening_hours -> 'fri') = 'array', true)
          and coalesce(jsonb_typeof(ai_opening_hours -> 'sat') = 'array', true)
          and coalesce(jsonb_typeof(ai_opening_hours -> 'sun') = 'array', true)
        )
      );
  end if;
end
$opening_hours_check$;

-- Das Feld in die eine Schema-Quelle aufnehmen (J4). Neuer Feldtyp `hours`:
-- die bisherigen Typen (radio, text, textarea) bilden ein Wochenraster nicht
-- ab. Renderer und Schreibpfad kennen ihn ab dieser Aenderung; aeltere
-- Renderer wuerden ihn als Textfeld darstellen, deshalb gehoert der Deploy
-- unmittelbar hinter diese Migration.
update public.system_config
set value = jsonb_set(
      value::jsonb,
      '{0,fields}',
      (value::jsonb #> '{0,fields}') || jsonb_build_array(
        jsonb_build_object(
          'key', 'opening_hours',
          'column', 'ai_opening_hours',
          'type', 'hours',
          'label', 'Reguläre Öffnungszeiten',
          'hint', 'Gilt als verbindliche Auskunft am Telefon. Ferien und kurzfristige Änderungen gehören in „Aktuelle Infos".'
        )
      )
    )::text,
    updated_at = now()
where key = 'core_field_steps'
  and not (value::jsonb #> '{0,fields}') @> '[{"key":"opening_hours"}]'::jsonb;

commit;
