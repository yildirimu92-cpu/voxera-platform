-- #930: `business_hours` bekommt einen ehrlichen "noch nicht bestaetigt"-Zustand.
--
-- Ausgangslage: die Spalte war `not null default Mo-Fr 08:00-17:00` und hatte
-- bis zum 2026-08-10 keinen Leser. Mit dem Buchungsfenster aus #930 bekommt sie
-- einen -- und damit wuerde der Vorgabewert schlagartig zur Regel: jeder Kunde,
-- der samstags arbeitet und den Wert nie gesetzt hat, bekaeme ab dem Merge
-- Ablehnungen. Ein Vorgabewert, den niemand gewaehlt hat, waere zur stillen
-- Einschraenkung geworden.
--
-- Erschwerend: es gab keinen Schreibpfad. Die Allowlist in
-- calendar-connections.js (`save_settings`) fuehrte die Spalte nicht, und das
-- Kunden-Dashboard zeigte sie ausdruecklich als wirkungslos an. Der Wert war
-- also nachweislich von niemandem gewaehlt -- live geprueft: alle Zeilen tragen
-- exakt den Vorgabewert, keine einzige weicht ab.
--
-- Zwei Wege standen zur Wahl:
--
--   (a) beim ersten Speichern aus den Oeffnungszeiten vorbelegen
--   (b) bei ungesetztem Wert nicht sperren
--
-- Entschieden ist (b), aus zwei Gruenden. Erstens beantworten die beiden Felder
-- verschiedene Fragen -- "ist offen" und "darf gebucht werden" -- und aus der
-- einen die andere abzuleiten hiesse, eine Buchungsregel zu erfinden, die der
-- Kunde nie formuliert hat. Zweitens loest (a) den Fall gar nicht: wer
-- samstags arbeitet und seine Oeffnungszeiten ebenfalls nicht bestaetigt hat,
-- bekaeme aus einer leeren Quelle wieder eine Einschraenkung.
--
-- (b) braucht aber einen Zustand, den es bisher nicht gab: "nicht gesetzt".
-- `not null default` kann ihn nicht ausdruecken -- eine bewusst gewaehlte
-- Mo-Fr-Woche und ein nie angefasster Vorgabewert sehen identisch aus.
--
-- Deshalb wird die Spalte nullable, der Default faellt weg, und alle Zeilen,
-- die noch exakt den Vorgabewert tragen, werden auf NULL gesetzt. Das ist
-- verlustfrei, weil es keinen Schreibpfad gab: kein Kunde kann diesen Wert
-- absichtlich gewaehlt haben.
--
-- Dieselbe Bedeutung wie bei `customers.ai_opening_hours` (siehe
-- 20260809154231_opening_hours.sql): "NULL bedeutet: noch nicht bestaetigt".
-- Ein zweites Vokabular fuer denselben Zustand waere die naechste Doppelquelle.

alter table public.calendar_settings
  alter column business_hours drop default,
  alter column business_hours drop not null;

update public.calendar_settings
set business_hours = null
where business_hours = '{"mon":[["08:00","17:00"]],"tue":[["08:00","17:00"]],"wed":[["08:00","17:00"]],"thu":[["08:00","17:00"]],"fri":[["08:00","17:00"]],"sat":[],"sun":[]}'::jsonb;

comment on column public.calendar_settings.business_hours is
  'Buchungszeiten, Struktur identisch mit customers.ai_opening_hours. NULL bedeutet: noch nicht bestaetigt -- dann schraenken allein die Oeffnungszeiten ein (#930). Buchungszeiten sind stets eine Teilmenge der Oeffnungszeiten, nie eine Erweiterung.';
