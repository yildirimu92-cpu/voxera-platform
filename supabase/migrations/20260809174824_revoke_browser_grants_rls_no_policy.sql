-- Gürtel nachziehen: Browser-Grants auf Tabellen, die keinen Browser-Zugriff haben sollen.
--
-- Ausgangslage: Ausloeser war die ungeschuetzte Sicherungstabelle aus
-- 2026-08-09_notification_mode_gating.sql (RLS aus + Default-Grants = echter
-- oeffentlicher Lese- und Schreibzugriff auf Kundendaten). Der Scan danach hat
-- acht weitere Tabellen gefunden, die denselben Zustand eine Stufe harmloser
-- tragen: RLS ist an, aber es gibt keine einzige Policy -- und trotzdem stehen
-- die Default-Privileges fuer anon und authenticated noch drauf.
--
-- Heute kommt dort nichts durch: RLS ohne Policy liefert diesen Rollen keine
-- Zeile. Der Grund, es trotzdem zu schliessen, ist der Zustand danach -- eine
-- spaeter ergaenzte Policy, egal wie eng gemeint, macht aus dem stehen
-- gebliebenen Grant sofort echten Zugriff. Die Policy waere dann der sichtbare
-- Teil der Aenderung, der Grant der unsichtbare.
--
-- Bewusst NICHT angefasst: Tabellen mit mindestens einer Policy. Dort ist der
-- Browser-Zugriff gewollt und die Grants sind die Voraussetzung dafuer -- ein
-- Revoke wuerde das Kunden-Dashboard zerlegen.

begin;

revoke all on public.credit_note_sequences             from anon, authenticated;
revoke all on public.elevenlabs_sync_log               from anon, authenticated;
revoke all on public.invoice_financial_actions         from anon, authenticated;
revoke all on public.invoice_refunds                   from anon, authenticated;
revoke all on public.telephony_number_assignment_audit from anon, authenticated;
revoke all on public.telephony_numbers                 from anon, authenticated;
revoke all on public.voxera_addons                     from anon, authenticated;
revoke all on public.voxera_voices                     from anon, authenticated;

commit;

-- ── Was dabei sichtbar wurde, aber hier nicht behoben wird ──────────────────
--
-- Vier Stellen im Admin-Panel fragen zwei dieser Tabellen ueber den
-- Browser-Client ab:
--   admin-panel/index.html:7588   voxera_voices        (Stimmen-Katalog)
--   admin-panel/index.html:16480, :16538, :16670  elevenlabs_sync_log (Sync-Verlauf)
--
-- Beide Tabellen tragen Daten (4 Stimmen, 20 Sync-Zeilen), die Abfragen liefern
-- aber schon vor dieser Migration nichts: RLS an, keine Policy. Der Revoke
-- aendert daran nichts Inhaltliches, nur die Fehlerform:
--   voxera_voices       - wertet `error` gar nicht aus und faellt auf [] zurueck.
--                         Vorher wie nachher eine leere Liste, keine sichtbare
--                         Aenderung.
--   elevenlabs_sync_log - :16480 macht `if (error) throw error`. Vorher zeigte
--                         die Ansicht "Noch kein Sync durchgefuehrt" fuer einen
--                         Kunden mit 20 Sync-Zeilen; jetzt schlaegt sie hoerbar
--                         fehl. Das ist ehrlicher, aber es ist eine Aenderung.
--
-- Die eigentliche Reparatur gehoert nicht hierher: entweder lesen diese
-- Ansichten kuenftig ueber eine Netlify-Function mit Service-Role, oder die
-- beiden Tabellen bekommen eine echte Admin-Policy. Beides ist eine
-- Produktentscheidung im Admin-Arbeitsstrang, kein Zugriffsrechte-Nachtrag.
