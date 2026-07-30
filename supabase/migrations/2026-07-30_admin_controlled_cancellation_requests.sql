-- Admin-controlled cancellation workflow.
-- Customer actions create/withdraw requests only; contract writes remain server-side admin commands.

CREATE TABLE IF NOT EXISTS public.cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  processing_action text,
  reason text NOT NULL,
  requested_effective_at timestamptz NOT NULL,
  approved_effective_at timestamptz,
  requested_by uuid NOT NULL,
  reviewed_at timestamptz,
  reviewed_by uuid,
  admin_note text,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cancellation_requests_status_check
    CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'withdrawn', 'finalized')),
  CONSTRAINT cancellation_requests_processing_action_check
    CHECK (processing_action IS NULL OR processing_action IN ('approve', 'finalize'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cancellation_requests_open_contract
  ON public.cancellation_requests(contract_id)
  WHERE status IN ('pending', 'processing', 'approved');

CREATE INDEX IF NOT EXISTS idx_cancellation_requests_customer_created
  ON public.cancellation_requests(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cancellation_requests_status_effective
  ON public.cancellation_requests(status, approved_effective_at, requested_effective_at);

ALTER TABLE public.cancellation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cancellation_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cancellation_requests FROM authenticated;
GRANT SELECT ON TABLE public.cancellation_requests TO authenticated;

DROP POLICY IF EXISTS cancellation_requests_admin_select ON public.cancellation_requests;
CREATE POLICY cancellation_requests_admin_select
  ON public.cancellation_requests
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

COMMENT ON TABLE public.cancellation_requests IS
  'Customer cancellation requests. Customers mutate only through authenticated server functions; contract state changes require an authorized admin command.';
