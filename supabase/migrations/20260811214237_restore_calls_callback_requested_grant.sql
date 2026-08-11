-- Nimmt 20260811211535_revoke_calls_callback_requested_grant.sql zurueck.
-- Jene Migration war falsch. Sie bleibt als Datei stehen, weil sie auf
-- Produktion angewandt wurde und das Verzeichnis das Ledger abbilden muss --
-- eine geloeschte Datei waere genau die Waisen-Migration, die wir anderswo
-- gerade nachdokumentieren.
--
-- Der Fehler: Die Begruendung stuetzte sich auf eine Suche nach
-- `callback_requested` in den Netlify Functions und auf EINE Fundstelle im
-- Browser-Code. Uebersehen wurden zwei weitere -- beide echte Schreibzugriffe
-- der Kundensitzung:
--
--   customer-dashboard/index.html:19634  in saveFollowUpV2(), verdrahtet an
--                                        einem Knopf im Anruf-Detail
--   customer-dashboard/index.html:20224  in saveFollowUp(), der Vorgaenger
--
-- Beide gehoeren zur Rueckruf-Konsolidierung (PATCH 2026-05-13 v2.3): Legt die
-- Kundin aus einem Anruf mit Rueckrufwunsch eine konkretere Folge-Aufgabe an
-- (Offerte, Termin, Aufgabe), wird der Rueckruf-Status am Anruf ausgeschaltet,
-- damit derselbe Vorgang nicht doppelt zaehlt -- einmal als Rueckruf am Anruf
-- und einmal als Folge-Aufgabe.
--
-- Das Recht ist also in Gebrauch, und zwar durch eine Kundenaktion. Das
-- Zeitfenster ohne das Recht lag zwischen den beiden Ledger-Eintraegen,
-- 21:15:35 bis 21:42:37 UTC. Wer in diesen 27 Minuten eine Folge-Aufgabe
-- anlegte, sah "Nachfassen gespeichert" -- die Aufgabe wurde auch angelegt --,
-- waehrend der Rueckruf-Status stehen blieb und der Vorgang doppelt zaehlt.
-- Der Fehlerpfad meldet sich nur auf der Konsole (console.warn), nicht in der
-- Oberflaeche; das ist genau die Klasse von Befund, die der laufende Auftrag
-- zu den Browser-Schreibzugriffen ohne sichtbare Fehlerbehandlung aufnimmt.
--
-- Offen bleibt die Entwurfsfrage, ob dieser Reset ueberhaupt im Browser
-- gehoert oder serverseitig aus dem Aufgaben-Anlegepfad. Sie wird getrennt
-- entschieden, nicht per Rechte-Entzug vorweggenommen.

begin;

do $grant$
begin
  if to_regclass('public.calls') is not null then
    execute 'grant update (callback_requested) on table public.calls to authenticated';
  end if;
end
$grant$;

commit;
