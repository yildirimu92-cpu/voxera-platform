-- Doppelversand-Schutz fuer die Outbox scharf schalten.
--
-- webhook-outbox.js behandelt seit PR #857 eine Unique-Violation auf
-- (event_type, dedupe_key) als "schon eingereiht" und gibt die bestehende
-- Zeile zurueck, statt eine zweite anzulegen. Dieser Zweig lief bisher nie:
-- idx_outbox_events_dedupe_key ist ein gewoehnlicher Index ohne
-- Eindeutigkeit, eine Kollision konnte also gar nicht entstehen.
--
-- Relevant wird das mit der Anruf-Benachrichtigung (09.08.2026): dieser Pfad
-- wird oefter ausgeloest als jeder andere Mailtyp - Tool-Call und Post-Call
-- feuern beide fuer dasselbe Gespraech, und ElevenLabs stellt denselben
-- Webhook bei Bedarf erneut zu. _lib/call-notification.js prueft vorab, aber
-- eine Vorabpruefung ist gegen zwei gleichzeitige Laeufe machtlos; erst der
-- Unique-Index macht die Sperre verlaesslich.
--
-- Stand 09.08.2026 gibt es keine doppelten Schluessel:
--   select event_type, dedupe_key, count(*) from outbox_events
--   where dedupe_key is not null group by 1,2 having count(*) > 1;  -- 0 Zeilen
-- Der Index kann also ohne Bereinigung angelegt werden. Vor dem Anwenden
-- erneut pruefen - laeuft die Migration spaeter, koennen inzwischen Duplikate
-- entstanden sein.
--
-- CONCURRENTLY, damit die Tabelle waehrend des Aufbaus schreibbar bleibt.
-- Diese Anweisung laeuft nicht in einer Transaktion.

create unique index concurrently if not exists uq_outbox_events_type_dedupe_key
  on public.outbox_events (event_type, dedupe_key)
  where dedupe_key is not null;

-- idx_outbox_events_dedupe_key bleibt vorerst stehen. Beide Nachschlagepfade
-- (findExistingOutboxEvent in webhook-outbox.js, alreadyQueued in
-- call-notification.js) filtern auf event_type UND dedupe_key und werden damit
-- vom neuen Index bedient; der alte ist danach redundant, wird aber erst
-- entfernt, wenn die neue Sperre eine Weile in Produktion beobachtet wurde.
