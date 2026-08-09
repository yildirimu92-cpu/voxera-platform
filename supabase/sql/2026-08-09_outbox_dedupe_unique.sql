-- Doppelversand-Schutz fuer die Outbox scharf schalten.
--
-- webhook-outbox.js behandelt seit PR #857 eine Unique-Violation auf
-- (event_type, dedupe_key) als "schon eingereiht" und gibt die bestehende
-- Zeile zurueck, statt eine zweite anzulegen. Dieser Zweig lief bisher nie:
-- idx_outbox_events_dedupe_key ist ein gewoehnlicher Index ohne
-- Eindeutigkeit, eine Kollision konnte also gar nicht entstehen.
--
-- Am deutlichsten sieht man das an invoice-mail-dispatch.js: der Code dort
-- verzweigt vollstaendig auf outbox.duplicate (200 bei bereits versendet, 202
-- bei pending, 409 bei fehlgeschlagen) und verschickt in diesen Faellen
-- bewusst nicht erneut. Dieser Zweig war ohne Unique-Index unerreichbar - ein
-- zweiter Mahnversand derselben Stufe legte einfach eine zweite Zeile an und
-- ging raus. Der Index macht die vorhandene Absicht erst wirksam.
--
-- Ausloeser ist die Anruf-Benachrichtigung (09.08.2026): dieser Pfad wird
-- oefter angestossen als jeder andere Mailtyp - Tool-Call und Post-Call
-- feuern beide fuer dasselbe Gespraech, und ElevenLabs stellt denselben
-- Webhook bei Bedarf erneut zu.
--
-- Was der Index NICHT abdeckt: _lib/mail-delivery.js wertet outbox.duplicate
-- nicht aus und verschickt auch dann, wenn createOutboxEvent die bestehende
-- Zeile zurueckgibt. Bei zwei exakt gleichzeitigen Laeufen entsteht deshalb
-- weiterhin eine zweite Mail - nur keine zweite Outbox-Zeile mehr. Den realen
-- Fall (erneute Zustellung Minuten spaeter) faengt die Vorabpruefung in
-- _lib/call-notification.js ab. deliverMail auf dasselbe Verhalten wie
-- invoice-mail-dispatch.js zu bringen, betrifft auch Vertrags- und
-- Lifecycle-Mails und gehoert deshalb in einen eigenen Schritt.
--
-- Stand 09.08.2026: 25 Zeilen, davon 23 mit dedupe_key, keine doppelten
-- Schluessel:
--   select event_type, dedupe_key, count(*) from outbox_events
--   where dedupe_key is not null group by 1,2 having count(*) > 1;  -- 0 Zeilen
-- Der Index kann also ohne Bereinigung angelegt werden. Vor einem erneuten
-- Anwenden auf einer anderen Umgebung diese Abfrage wiederholen.
--
-- Bewusst ohne CONCURRENTLY: bei dieser Tabellengroesse ist der Aufbau
-- augenblicklich, und die Anweisung bleibt so in einer Transaktion
-- anwendbar.

create unique index if not exists uq_outbox_events_type_dedupe_key
  on public.outbox_events (event_type, dedupe_key)
  where dedupe_key is not null;

-- idx_outbox_events_dedupe_key bleibt vorerst stehen. Beide Nachschlagepfade
-- (findExistingOutboxEvent in webhook-outbox.js, alreadyQueued in
-- call-notification.js) filtern auf event_type UND dedupe_key und werden damit
-- vom neuen Index bedient; der alte ist danach redundant, wird aber erst
-- entfernt, wenn die neue Sperre eine Weile in Produktion beobachtet wurde.
