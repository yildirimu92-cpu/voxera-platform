-- NACHDOKUMENTIERT am 2026-08-09. Am 2026-08-09 direkt auf der Produktions-DB
-- ausgefuehrt (Ledger-Version 20260809144607, von info@voxera.ch), ohne
-- Entsprechung im Repo -- vom Ledger-Check des 6-Stunden-Laufs als Waise
-- gemeldet.
--
-- Herkunft des SQL: woertlich aus
-- supabase_migrations.schema_migrations.statements, also aus dem tatsaechlich
-- Ausgefuehrten. Gegen den Live-Katalog geprueft:
--   * public.customers.prompt_fingerprint            text  -- vorhanden
--   * public.elevenlabs_sync_log.prompt_fingerprint  text  -- vorhanden
--   * customers_prompt_fingerprint_idx, partiell auf elevenlabs_agent_id
--     is not null -- vorhanden, exakt in dieser Form
--
-- Steht bereits im Ledger und wird nicht erneut ausgefuehrt; `if not exists`
-- haelt ein versehentliches Nachziehen folgenlos.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS prompt_fingerprint text;

ALTER TABLE public.elevenlabs_sync_log
  ADD COLUMN IF NOT EXISTS prompt_fingerprint text;

COMMENT ON COLUMN public.customers.prompt_fingerprint IS
  'Abgeleitet: Fingerprint (Builder-Version + Hash Master-Prompt + Hash Branchenblock) des letzten ERFOLGREICHEN ElevenLabs-Syncs. Nur von der Sync-Funktion geschrieben. Weicht er vom zur Laufzeit berechneten Soll ab, laeuft der Agent auf einem veralteten Prompt.';

COMMENT ON COLUMN public.elevenlabs_sync_log.prompt_fingerprint IS
  'Abgeleitet: Fingerprint des bei diesem Sync-Versuch verwendeten Stands, auch bei Fehlschlag.';

CREATE INDEX IF NOT EXISTS customers_prompt_fingerprint_idx
  ON public.customers (prompt_fingerprint)
  WHERE elevenlabs_agent_id IS NOT NULL;
