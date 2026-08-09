-- S4 / Stufe 0 — elevenlabs_sync_log.prev_values nachziehen.
--
-- Warum diese Migration existiert (Diagnose 2026-08-09):
-- Der S9-Fix (PR #863) schreibt changed_fields UND prev_values in dieselbe
-- Insert-Zeile:
--
--   const syncLogRow = { …, changed_fields: …, prev_values: …, created_at };
--   await sb.from('elevenlabs_sync_log').insert(syncLogRow);
--
-- Die Spalte prev_values existierte aber weder in Produktion noch in Staging,
-- und es gab keine Migration dafuer. PostgREST weist eine Insert-Zeile mit
-- unbekannter Spalte grundsaetzlich zurueck (PGRST204) -- unabhaengig davon,
-- ob der Wert null ist. Der primaere Insert schlug deshalb bei JEDEM Sync
-- fehl, und der defensive Fallback in trigger-elevenlabs-sync.js entfernte
-- dabei changed_fields gleich mit:
--
--   const { changed_fields: _cf, prev_values: _pv, ...fallbackRow } = syncLogRow;
--
-- Ergebnis: changed_fields war in Produktion in ALLEN Zeilen null, auch nach
-- dem S9-Merge. Der Fix war im Code korrekt und in CI gruen, in Produktion
-- aber strukturell wirkungslos. Das Sicherheitsnetz hat genau den Fehler
-- verdeckt, den es melden sollte.
--
-- Die Spalte haelt den Vorher-Zustand, den der Aufrufer mitschickt;
-- changed_fields haelt das daraus berechnete Delta. Beide sind reine
-- Audit-Daten und werden ausschliesslich von der Sync-Funktion geschrieben.

BEGIN;

ALTER TABLE public.elevenlabs_sync_log
  ADD COLUMN IF NOT EXISTS prev_values jsonb;

COMMENT ON COLUMN public.elevenlabs_sync_log.prev_values IS
  'Audit: Feldwerte VOR dem Patch, wie vom Aufrufer mitgeschickt. Nur Wizard/admin_save/customer_request senden das; fehlt es, bleibt changed_fields leer statt geraten zu werden. Wird nur von der Sync-Funktion geschrieben.';

COMMIT;
