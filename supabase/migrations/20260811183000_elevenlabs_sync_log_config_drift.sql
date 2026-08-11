-- #932 — Rueckleseprüfung nach dem Sync.
--
-- Nach jedem PATCH wird der Agent zurueckgelesen und gegen den gesendeten
-- Sollzustand verglichen. Weicht er ab, stehen hier die betroffenen Feldnamen
-- samt Soll- und Ist-Auszug -- und `status` traegt 'drift' statt 'success',
-- damit eine Abweichung den Erfolg nicht unwidersprochen laesst.
--
-- Form:
--   {
--     "source": "patch_response" | "get" | "failed",
--     "error":  null | "…",                 -- gesetzt, wenn die Pruefung nicht lief
--     "deviations": [
--       { "path": "conversation_config.agent.prompt.thinking_budget",
--         "reason": "missing" | "mismatch",
--         "expected": "1024",
--         "actual": null }
--     ]
--   }
--
-- Eine Zeile mit `deviations: []` und gesetztem `error` heisst: der Sync lief,
-- die Pruefung nicht. Das ist ausdruecklich etwas anderes als `config_drift IS
-- NULL` (geprueft, kein Befund) und soll unterscheidbar bleiben.
--
-- `status` bekommt bewusst KEINE CHECK-Beschraenkung: die Spalte hat heute auch
-- keine, und eine nachtraeglich eingefuehrte wuerde einen Deploy, der einen
-- weiteren Statuswert einfuehrt, in Produktion zum Insert-Fehler machen --
-- genau die Klasse Ausfall, gegen die die Stufenleiter beim Log-Insert gebaut
-- wurde.

alter table if exists public.elevenlabs_sync_log
  add column if not exists config_drift jsonb;

comment on column public.elevenlabs_sync_log.config_drift is
  '#932: Ergebnis der Rueckleseprüfung nach dem Sync. NULL = geprueft, keine Abweichung. Gesetzt = Abweichung (deviations) und/oder Pruefung nicht durchfuehrbar (error). Siehe _lib/elevenlabs-agent-config.js.';

-- Nur die Zeilen mit Befund; die grosse Mehrheit traegt NULL und gehoert nicht
-- in den Index.
create index if not exists elevenlabs_sync_log_config_drift_idx
  on public.elevenlabs_sync_log (created_at desc)
  where config_drift is not null;
