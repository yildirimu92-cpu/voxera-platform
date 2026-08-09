-- NACHDOKUMENTIERT am 2026-08-09. Am 2026-08-09 direkt auf der Produktions-DB
-- ausgefuehrt (Ledger-Version 20260809145738, von info@voxera.ch), ohne
-- Entsprechung im Repo -- vom Ledger-Check des 6-Stunden-Laufs als Waise
-- gemeldet.
--
-- Herkunft des SQL: woertlich aus
-- supabase_migrations.schema_migrations.statements, also aus dem tatsaechlich
-- Ausgefuehrten. Gegen den Live-Katalog geprueft:
--   * Tabelle public.elevenlabs_sync_queue existiert, RLS aktiv, genau eine
--     Policy (elevenlabs_sync_queue_service)
--   * Grants: ausschliesslich service_role (und der Eigentuemer postgres).
--     anon und authenticated halten NICHTS -- die Tabelle ist damit auch nicht
--     Teil der eingefrorenen anon-Grant-Baseline.
--   * alle drei Indizes vorhanden, inkl. des partiellen Unique-Index auf
--     customer_id fuer status in ('pending','running')
--
-- Sicherheitsseitig ist an dieser Migration nichts nachzuziehen: sie macht von
-- sich aus, was der P0-Nachzug fuer andere Tabellen erst nachholen musste --
-- RLS an, `revoke all` von public/anon/authenticated, Rechte nur fuer
-- service_role.
--
-- Steht bereits im Ledger und wird nicht erneut ausgefuehrt; alle Anweisungen
-- sind idempotent.

CREATE TABLE IF NOT EXISTS public.elevenlabs_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  customer_id text NOT NULL,
  agent_id text,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  wave integer NOT NULL DEFAULT 1,
  attempts integer NOT NULL DEFAULT 0,
  expected_fingerprint text,
  error_message text,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elevenlabs_sync_queue_status_check
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'dead', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS elevenlabs_sync_queue_open_customer_idx
  ON public.elevenlabs_sync_queue (customer_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS elevenlabs_sync_queue_due_idx
  ON public.elevenlabs_sync_queue (status, wave, created_at);

CREATE INDEX IF NOT EXISTS elevenlabs_sync_queue_run_idx
  ON public.elevenlabs_sync_queue (run_id);

COMMENT ON TABLE public.elevenlabs_sync_queue IS
  'S4-Fan-out: geplante Re-Syncs zu ElevenLabs. Wird ausschliesslich serverseitig geschrieben (Planer und Worker mit Service-Role). Kein Mandantenzugriff.';
COMMENT ON COLUMN public.elevenlabs_sync_queue.wave IS
  'Canary-Welle. Welle 1 ist ein einzelner Kunde; hoehere Wellen laufen erst, wenn die vorherige vollstaendig erfolgreich war.';
COMMENT ON COLUMN public.elevenlabs_sync_queue.reason IS
  'Warum der Kunde eingeplant wurde: fingerprint_stale, fingerprint_unknown, operational_expired oder manual.';

ALTER TABLE public.elevenlabs_sync_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.elevenlabs_sync_queue FROM public;
REVOKE ALL ON TABLE public.elevenlabs_sync_queue FROM anon;
REVOKE ALL ON TABLE public.elevenlabs_sync_queue FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.elevenlabs_sync_queue TO service_role;

DROP POLICY IF EXISTS elevenlabs_sync_queue_service ON public.elevenlabs_sync_queue;
CREATE POLICY elevenlabs_sync_queue_service ON public.elevenlabs_sync_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);
