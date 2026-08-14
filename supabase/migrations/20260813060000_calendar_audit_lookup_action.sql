-- Nachschlage-Aktion in der Audit-Tabelle erlauben.
--
-- Anlass: Testanruf vom 13.08. Ein Kunde, der einen Termin absagen will, kennt
-- dessen Uhrzeit selten -- und der Agent hat bisher keine Moeglichkeit, die
-- `external_event_id` eines Termins aus einem FRUEHEREN Gespraech zu finden.
-- Die ID existiert nur im Kontext des Buchungsgespraechs. Absagen in einem
-- neuen Anruf war damit prinzipiell unmoeglich, nicht bloss fehlerhaft.
--
-- Die neue Aktion `lookup` liest die anstehenden Termine aus
-- calendar_booking_audit -- also aus der Quelle, auf der schon heute die
-- Pruefung `calendar_event_not_managed_by_voxera` beruht. Kein zusaetzlicher
-- Kalender-Scope, keine Zeitfenster-Raterei.
--
-- Sie schreibt wie jede andere Aktion eine Audit-Zeile, und genau dafuer muss
-- der CHECK sie kennen. Ohne diese Migration wuerde der INSERT scheitern, und
-- `audit()` schluckt eigene Fehler -- die Zeile fiele still weg. Das ist
-- derselbe Mechanismus, an dem der Anbieter-Ersatzwert 'unknown' haengt.

begin;

alter table public.calendar_booking_audit
  drop constraint if exists calendar_booking_audit_action_check;

alter table public.calendar_booking_audit
  add constraint calendar_booking_audit_action_check
  check (action in ('availability','book','reschedule','cancel','lookup','connect','disconnect','verify'));

-- Die Nachschlage-Abfrage filtert auf Kunde, Aktion und Status. Heute ist die
-- Tabelle klein genug fuer einen Scan; sie waechst aber mit jedem
-- availability-Aufruf, und eine Aufbewahrungsgrenze gibt es noch nicht (#952).
create index if not exists calendar_booking_audit_customer_action_idx
  on public.calendar_booking_audit(customer_id, action, status);

commit;
