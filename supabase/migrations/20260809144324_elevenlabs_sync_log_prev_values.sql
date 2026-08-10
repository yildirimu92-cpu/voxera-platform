-- N6 (2026-08-09): trigger-elevenlabs-sync.js schreibt seit dem S9-Fix
-- `prev_values` in elevenlabs_sync_log, im Repo lag dafuer aber keine DDL.
-- Gemessen am 09.08. um 14:22 UTC fehlte die Spalte in Produktion; um 14:41
-- war sie da, also waehrend der N6-Arbeit von Hand nachgezogen. Diese Datei
-- holt den Schritt ins Repo nach, damit Staging und jede neue Umgebung
-- denselben Stand bekommen, ohne dass sich jemand daran erinnern muss.
--
-- Idempotent: auf Produktion ein No-op.
--
-- Der Code kommt seit N6 auch ohne die Spalte aus (stufenweiser Insert-
-- Fallback in trigger-elevenlabs-sync.js). Ohne sie steht im Log nur, welches
-- Feld sich geaendert hat; mit ihr auch, von welchem Wert aus.

ALTER TABLE public.elevenlabs_sync_log
  ADD COLUMN IF NOT EXISTS prev_values jsonb;

COMMENT ON COLUMN public.elevenlabs_sync_log.prev_values IS
  'Stand der vom Aufrufer gepatchten Spalten VOR dem Schreibvorgang. Basis fuer changed_fields.';
