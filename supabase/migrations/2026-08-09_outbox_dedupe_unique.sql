-- NACHDOKUMENTIERT am 2026-08-09. Diese Datei wurde nicht vorab geschrieben und
-- dann angewandt, sondern umgekehrt: die Aenderung lief am 2026-08-09 direkt auf
-- der Produktions-DB (Ledger-Version 20260809142631, ausgefuehrt von
-- info@voxera.ch) und hatte danach keine Entsprechung im Repo.
--
-- Der Ledger-Check des 6-Stunden-Laufs hat das zutreffend als Waise gemeldet
-- ("keine DB-Migration ohne Repo-Datei"). Diese Datei schliesst die Luecke.
--
-- Herkunft des SQL: woertlich aus supabase_migrations.schema_migrations.statements
-- uebernommen, also aus dem, was tatsaechlich ausgefuehrt wurde -- nicht
-- rekonstruiert und nicht aus dem Anwendungscode abgeleitet. Gegen den
-- Live-Katalog geprueft, der Index existiert exakt in dieser Form:
--   CREATE UNIQUE INDEX uq_outbox_events_type_dedupe_key
--     ON public.outbox_events USING btree (event_type, dedupe_key)
--     WHERE (dedupe_key IS NOT NULL)
--
-- Die Migration steht bereits im Ledger und wird dadurch NICHT erneut
-- ausgefuehrt. `if not exists` macht ein versehentliches Nachziehen (z.B. beim
-- Aufsetzen einer neuen Umgebung) folgenlos.

create unique index if not exists uq_outbox_events_type_dedupe_key
  on public.outbox_events (event_type, dedupe_key)
  where dedupe_key is not null;
