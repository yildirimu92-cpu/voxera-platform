-- Migration: outbox_events access hardening
-- Date: 2026-04-07
-- Description: Restrict outbox_events to backend service role only.

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

-- No RLS policies are created on purpose:
-- - anon/authenticated get no row access
-- - service_role keeps access via BYPASSRLS

REVOKE ALL ON TABLE public.outbox_events FROM anon;
REVOKE ALL ON TABLE public.outbox_events FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.outbox_events TO service_role;
