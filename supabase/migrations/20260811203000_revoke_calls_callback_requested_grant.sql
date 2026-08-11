-- calls.callback_requested: UPDATE-Recht der Rolle `authenticated` zuruecknehmen.
--
-- Herkunft des Befunds: erster Produktivlauf des F6-Waechters im
-- Invariantenkatalog. Gesucht war er nicht -- der Check "calls: authenticated
-- UPDATE auf exakt 4 Spalten" meldete 5 und nannte die fuenfte beim Namen.
--
-- Ausgangsmessung im Zielsystem (Produktion, ulcofbgrovgcvowdjrge), vor dieser
-- Migration:
--   calls: callback_requested, dashboard_status, notes_customer_voxera,
--          read_at, updated_at            -> 5 Spalten
--
-- Warum die Spalte nicht dazugehoert: Kein Browser-Pfad schreibt sie. Die
-- Kundensitzung schreibt an calls ausschliesslich read_at (index.html:19023,
-- 19042), dashboard_status (20154), notes_customer_voxera (31504) und
-- updated_at. Gesetzt wird callback_requested allein serverseitig mit dem
-- Service-Role-Schluessel, aus dem Anrufeingang -- call-intake-webhook.js:153
-- und :297 sowie elevenlabs-post-call.js:300 und :415. Die einzige weitere
-- Fundstelle im Browser (index.html:12573) baut ein Ansichtsobjekt aus
-- customer_tasks-Zeilen zusammen und schreibt nichts in die Datenbank.
--
-- Das Recht war also nie in Gebrauch. Es ist trotzdem keine Kleinigkeit:
-- callback_requested entscheidet, ob ein Anruf als Rueckrufwunsch gilt --
-- damit steuert es die Aufgabenliste, die Sortierung und kuenftig den
-- SMS-Versand. Eine Kundensitzung haette den Rueckrufwunsch eines Anrufers
-- still zuruecksetzen koennen.

begin;

do $revoke$
begin
  if to_regclass('public.calls') is not null then
    execute 'revoke update (callback_requested) on table public.calls from authenticated';
  end if;
end
$revoke$;

commit;
