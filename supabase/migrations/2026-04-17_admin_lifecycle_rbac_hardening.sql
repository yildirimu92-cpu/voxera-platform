-- Migration: Admin lifecycle + RBAC hardening for server-side provisioning.

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS status text;

UPDATE public.admins
SET status = 'active'
WHERE status IS NULL OR btrim(status) = '';

ALTER TABLE public.admins
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE public.admins
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.admins
  DROP CONSTRAINT IF EXISTS admins_status_check;

ALTER TABLE public.admins
  ADD CONSTRAINT admins_status_check
  CHECK (replace(lower(status), '_', '-') IN ('active', 'disabled'));

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_admins_status ON public.admins (status);

CREATE TABLE IF NOT EXISTS public.admin_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_admin_id uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  actor_role text,
  target_admin_id uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  action text NOT NULL,
  previous_role text,
  new_role text,
  previous_status text,
  new_status text,
  meta jsonb,
  happened_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_lifecycle_audit_target_time
  ON public.admin_lifecycle_audit (target_admin_id, happened_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_lifecycle_audit_actor_time
  ON public.admin_lifecycle_audit (actor_admin_id, happened_at DESC);
