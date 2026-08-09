-- S4 / Stufe 2 — Warteschlange fuer den Fan-out.
--
-- Warum eine Warteschlange und nicht eine Schleife im Endpunkt:
-- Netlify-Funktionen laufen synchron maximal ~26 Sekunden
-- (trigger-elevenlabs-sync-v2.js setzt selbst 24s an), ein Sync kostet 4-7
-- ElevenLabs-Aufrufe. Ab etwa drei bis fuenf Kunden passt ein Durchlauf nicht
-- mehr in eine Invocation. Der "einfachste Ansatz" braucht also ohnehin eine
-- Warteschlange -- dann lieber gleich die, die auch Stufe 3 tragen kann.
--
-- Muster uebernommen von outbox_events/outbox-retry-worker.js: Claiming per
-- bedingtem Status-Update, Backoff ueber attempts, Batch-Groesse per Env.
--
-- Canary (wave): Welle 1 enthaelt genau einen Kunden. Der Worker gibt Welle 2
-- erst frei, wenn Welle 1 erfolgreich durch ist. Ein Deploy, der den Prompt
-- kaputt macht, erreicht damit einen Agenten statt aller -- das war der
-- schwerwiegendste Einwand gegen einen automatischen Fan-out.

BEGIN;

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

-- Ein Kunde steht nie zweimal gleichzeitig an. Ohne diesen Index wuerde ein
-- zweiter Planungslauf, der vor dem Ende des ersten startet, denselben Kunden
-- doppelt synchronisieren -- zwei PATCHes auf denselben Agenten, deren
-- Reihenfolge niemand kontrolliert.
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

-- ── Zugriff ────────────────────────────────────────────────────────────────
-- Die Tabelle enthaelt keine Mandantendaten, die ein Kunde sehen muesste, und
-- wird von keinem Browser gelesen. anon und authenticated bekommen deshalb gar
-- keine Rechte -- nicht "RLS haelt sie schon zurueck", sondern kein Grant.
-- Beides zusammen, weil db_security_invariants Grants und Policies als
-- unabhaengige Kontrollen fuehrt und eine neue Tabelle ohne RLS ausserdem den
-- Baseline-Check bricht.
ALTER TABLE public.elevenlabs_sync_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.elevenlabs_sync_queue FROM public;
REVOKE ALL ON TABLE public.elevenlabs_sync_queue FROM anon;
REVOKE ALL ON TABLE public.elevenlabs_sync_queue FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.elevenlabs_sync_queue TO service_role;

-- service_role hat rolbypassrls, die Policy wird heute also nicht konsultiert.
-- Sie steht trotzdem da: faellt bypassrls jemals weg, arbeitet der Worker
-- weiter und anon/authenticated kommen trotzdem nicht heran.
DROP POLICY IF EXISTS elevenlabs_sync_queue_service ON public.elevenlabs_sync_queue;
CREATE POLICY elevenlabs_sync_queue_service ON public.elevenlabs_sync_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
