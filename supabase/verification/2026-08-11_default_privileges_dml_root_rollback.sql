-- Rollback zu 20260811183000_default_privileges_dml_root.sql
--
-- Stellt die Default-Privilegien fuer INSERT/UPDATE/DELETE wieder her, also
-- den Zustand vor der Migration: `anon=arwdxtm`, `authenticated=arwdxtm`.
--
-- WANN DAS NOETIG WAERE -- und warum vermutlich nie:
--
-- Die Migration aendert kein einziges BESTEHENDES Recht. Sie wirkt
-- ausschliesslich auf Tabellen, die NACH ihr angelegt werden. Ein Ausfall in
-- einem laufenden Pfad kann durch sie also nicht entstehen; wer nach dem
-- Deploy einen Fehler sieht, sollte zuerst woanders suchen.
--
-- Der eine denkbare Fall: Eine Migration legt eine neue Tabelle an und
-- verlaesst sich stillschweigend auf das geerbte Recht, statt es ausdruecklich
-- zu vergeben. Dann fehlt dem Portal der Zugriff auf GENAU diese Tabelle.
--
-- Die richtige Antwort darauf ist NICHT dieser Rollback, sondern ein
-- ausdrueckliches Grant in der betroffenen Migration:
--
--     grant select, insert, update, delete on public.<tabelle> to authenticated;
--
-- Das ist der Weg, den elevenlabs_sync_queue schon geht, und der Sinn der
-- Massnahme: ein ausdrueckliches Grant ist eine Entscheidung, ein geerbtes
-- ist keine. Dieser Rollback wuerde die Wurzel wieder oeffnen und damit den
-- gesamten Effekt zuruecknehmen, um ein Einzelproblem zu loesen.
--
-- Er steht hier fuer den Fall, dass die Ursache nicht schnell genug gefunden
-- wird und der Betrieb Vorrang hat -- nicht als regulaerer Weg.
--
-- Idempotent: mehrfaches Ausfuehren aendert nichts.

begin;

alter default privileges in schema public grant insert, update, delete on tables to anon;
alter default privileges in schema public grant insert, update, delete on tables to authenticated;

commit;

-- Nach dem Rollback schlaegt der Katalogcheck
-- 'Default-Privilegien vergeben kein INSERT/UPDATE/DELETE an anon/authenticated'
-- wieder fehl. Das ist beabsichtigt und richtig: Der Zustand IST dann wieder
-- der alte, und ein gruener Check waere die Luege.
