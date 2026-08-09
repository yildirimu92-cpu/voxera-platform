-- S4 / Stufe 1 — Prompt-Fingerprint: der Soll-Zustand wird festgehalten.
--
-- Diagnose 2026-08-09: buildPromptV2() liefert eine Version
-- (PROMPT_BUILDER_VERSION), die nur in HTTP-Antworten auftaucht und nirgends
-- gespeichert wird. Master-Prompt (system_config.prompt_master_l1) und
-- Branchenvorlagen (industry_templates.prompt_block) werden ausschliesslich
-- gelesen, nie geschrieben. Damit war nicht beantwortbar, mit welchem Stand von
-- Code und Vorlagen ein Agent zuletzt bespielt wurde.
--
-- Belegter Fall: der Sync um 12:25 UTC lief 73 Minuten nach dem S13-Merge und
-- trug den Fehler trotzdem noch (Prompt-Laenge unveraendert 16'674). Es ist
-- also nicht nur so, dass ein Fix erst beim naechsten Sync wirkt -- auch ein
-- Sync nach dem Fix traegt ihn nicht zwingend, und man sah es den Daten nicht
-- an. Genau das macht diese Spalte sichtbar.
--
-- ABGELEITETE SPALTEN -- NICHT MANUELL PFLEGEN.
--   customers.prompt_fingerprint          Ist-Zustand: was der Agent zuletzt
--                                         ERFOLGREICH bekommen hat.
--   elevenlabs_sync_log.prompt_fingerprint Der bei diesem Versuch berechnete
--                                         Wert, auch bei Fehlschlag -- sonst
--                                         fehlt im Log genau die Zeile, die
--                                         erklaert, warum ein Kunde veraltet
--                                         blieb.
--
-- Der Soll-Wert wird nirgends gespeichert: er ist jederzeit aus denselben
-- Eingaben berechenbar (_lib/prompt-fingerprint.js). Ein gespeicherter
-- Soll-Wert koennte veralten, ein berechneter nicht.

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS prompt_fingerprint text;

ALTER TABLE public.elevenlabs_sync_log
  ADD COLUMN IF NOT EXISTS prompt_fingerprint text;

COMMENT ON COLUMN public.customers.prompt_fingerprint IS
  'Abgeleitet: Fingerprint (Builder-Version + Hash Master-Prompt + Hash Branchenblock) des letzten ERFOLGREICHEN ElevenLabs-Syncs. Nur von der Sync-Funktion geschrieben. Weicht er vom zur Laufzeit berechneten Soll ab, laeuft der Agent auf einem veralteten Prompt.';

COMMENT ON COLUMN public.elevenlabs_sync_log.prompt_fingerprint IS
  'Abgeleitet: Fingerprint des bei diesem Sync-Versuch verwendeten Stands, auch bei Fehlschlag.';

-- Der Fan-out fragt "welche Kunden mit Agent haben einen abweichenden
-- Fingerprint". Ohne Index ist das bei vier Kunden egal und bei vierhundert
-- ein Full Scan pro Planungslauf.
CREATE INDEX IF NOT EXISTS customers_prompt_fingerprint_idx
  ON public.customers (prompt_fingerprint)
  WHERE elevenlabs_agent_id IS NOT NULL;

COMMIT;
