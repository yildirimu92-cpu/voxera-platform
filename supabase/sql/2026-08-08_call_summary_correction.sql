BEGIN;

-- Etappe 4 Teil B / Feature 3 — "KI-Zusammenfassung korrigieren".
-- Siehe docs/ANFRAGEN_DETAIL_TEIL_B_BESTANDSAUFNAHME_2026-08-08.md, Abschnitt B2.
--
-- WARUM EINE EIGENE SPALTE UND NICHT call_summary
--
-- calls.call_summary gehoert dem Post-Call-Webhook
-- (customer-dashboard/netlify/functions/elevenlabs-post-call.js). Dessen
-- Update-Pfad schreibt die Spalte auf dem gematchten Datensatz neu und setzt
-- im selben Zug dashboard_status = 'new'. Eine Kundenkorrektur in dieselbe
-- Spalte waere deshalb nicht stabil: ein verspaeteter oder wiederholter
-- Webhook (Match ueber elevenlabs_conversation_id, sonst Telefon + Zielnummer
-- im 120-Minuten-Fenster) wuerde sie still zuruecksetzen und den Eintrag
-- zusaetzlich zurueck in den Posteingang holen.
--
-- call_summary bleibt damit unveraendert das, was die KI geliefert hat. Das
-- haelt zwei Dinge intakt:
--   * "Original ansehen" im Anfrage-Detail hat eine Quelle.
--   * Die Erkennung "Analyse liegt noch nicht vor" (getCallDisplayState,
--     view-model isAnalysisPending) haengt weiterhin an der KI-Ausgabe und
--     nicht an einer Kundeneingabe.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS call_summary_corrected    text,
  ADD COLUMN IF NOT EXISTS call_summary_corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS call_summary_corrected_by text;

COMMENT ON COLUMN public.calls.call_summary_corrected IS
  'Vom Kunden korrigierte Fassung der Gespraechszusammenfassung. Hat im Dashboard Vorrang vor call_summary. NULL = keine Korrektur, es gilt die KI-Ausgabe. Wird ausschliesslich von der Function call-save-summary-correction geschrieben.';

COMMENT ON COLUMN public.calls.call_summary_corrected_at IS
  'Zeitpunkt der letzten Korrektur. timestamptz — created_at/updated_at auf calls sind eine Altlast in "timestamp without time zone"; neue Zeitfelder wiederholen das nicht.';

COMMENT ON COLUMN public.calls.call_summary_corrected_by IS
  'auth-User-ID der Person, die zuletzt korrigiert hat. text wie calendar_connections.connected_by_user_id und customer_operational_updates.created_by_user_id.';

-- BEWUSST KEIN UPDATE-GRANT FUER authenticated.
--
-- public.calls traegt seit 2026-08-06_p0_rls_tenant_isolation_hardening.sql
-- ein spaltengenaues UPDATE-Recht: authenticated darf ausschliesslich
-- read_at, notes_customer_voxera, dashboard_status und updated_at schreiben
-- (relacl zeigt fuer authenticated kein table-level "w"). Die drei neuen
-- Spalten bleiben absichtlich draussen — die Korrektur laeuft ueber
-- call-save-summary-correction mit Service-Role und Ownership-Pruefung, damit
-- Zeitstempel und Urheber nicht vom Browser gesetzt werden koennen.
--
-- SELECT ist auf calls table-level an authenticated vergeben (relacl "r"),
-- die neuen Spalten sind fuer das Dashboard daher ohne weiteren Grant lesbar.

COMMIT;
