-- Migration: Core table schema source-of-truth (governance, non-breaking)
-- Date: 2026-04-08
-- Scope: public.customers, public.users, public.calls, public.cases, public.onboarding, public.admins
--
-- IMPORTANT:
-- - This migration is additive/documenting only.
-- - Existing productive tables are NOT replaced.
-- - CREATE TABLE IF NOT EXISTS blocks provide canonical DDL baselines for environments
--   where the historical table-creation migrations are missing in-repo.
-- - "✅ sicher" = evidenced by existing code and/or existing migrations in this repo.
-- - "⚠️ inferred" = reconstructed from runtime usage/docs, not guaranteed by historic DDL.

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
  -- ✅ sicher: tenant key used across code and RLS
  id text PRIMARY KEY,

  -- ⚠️ inferred: mirrored link to auth principal, used as fallback in delete flows
  auth_user_id uuid REFERENCES auth.users(id),

  -- ✅ sicher (runtime writes/reads)
  customer_name text NOT NULL,
  email text,
  tel_nr text,
  plan text,
  street text,
  zip text,
  city text,
  country text,

  -- ⚠️ inferred (runtime writes/reads, no complete historic DDL in repo)
  contact_first_name text,
  contact_last_name text,
  contact_name text,
  voxera_number text,
  dashboard_id text,
  notes text,

  -- ✅ sicher (existing migrations and runtime)
  status text NOT NULL DEFAULT 'onboarding',
  invite_status text NOT NULL DEFAULT 'not_sent',
  welcome_sent boolean NOT NULL DEFAULT false,
  welcome_sent_at timestamptz,
  payment_status text NOT NULL DEFAULT 'none',
  setup_fee_amount numeric(10,2),
  payment_link text,
  payment_sent_at timestamptz,
  payment_received_at timestamptz,
  forwarding_setup_completed boolean NOT NULL DEFAULT false,
  forwarding_status text NOT NULL DEFAULT 'not_started',
  forwarding_mode text,
  setup_device_type text,
  activation_started_at timestamptz,
  activation_test_mode text,
  activation_test_candidate_call_id text,
  last_confirmed_setup_device_type text,
  last_confirmed_forwarding_mode text,
  start_date date,

  -- ✅ sicher (existing migration 2026-04-07_notification_mode_single_source.sql)
  notification_mode text NOT NULL DEFAULT 'none',
  notification_active boolean,
  new_log_email_active boolean,
  missed_call_email_active boolean,
  phone_notification_to text,

  -- ✅ sicher (existing migrations around subscriptions)
  subscription_id uuid REFERENCES public.subscriptions(id),
  activated_at timestamptz,

  -- ✅ sicher (runtime writes + common Supabase convention)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ✅ sicher: check values are set by existing migrations
  CONSTRAINT customers_status_check CHECK (status IN ('onboarding', 'ready', 'invited', 'activated', 'live', 'paused', 'deleted')),
  CONSTRAINT customers_invite_status_check CHECK (invite_status IN ('not_sent', 'sent', 'activated')),
  CONSTRAINT customers_payment_status_check CHECK (payment_status IN ('none', 'pending', 'paid')),
  CONSTRAINT customers_notification_mode_check CHECK (notification_mode IN ('none', 'callback_only', 'all_calls')),
  CONSTRAINT customers_forwarding_status_check CHECK (forwarding_status IN ('not_started', 'pending_test', 'active', 'inactive')),
  CONSTRAINT customers_forwarding_mode_check CHECK (forwarding_mode IS NULL OR forwarding_mode IN ('no_answer', 'unreachable', 'always', 'busy')),
  CONSTRAINT customers_activation_test_mode_check CHECK (activation_test_mode IS NULL OR activation_test_mode IN ('system_call', 'manual_call')),
  CONSTRAINT customers_last_confirmed_setup_device_type_check CHECK (last_confirmed_setup_device_type IS NULL OR last_confirmed_setup_device_type IN ('mobile', 'landline')),
  CONSTRAINT customers_last_confirmed_forwarding_mode_check CHECK (last_confirmed_forwarding_mode IS NULL OR last_confirmed_forwarding_mode IN ('no_answer', 'unreachable', 'always', 'busy')),
  CONSTRAINT customers_setup_device_type_check CHECK (setup_device_type IS NULL OR setup_device_type IN ('mobile', 'landline'))
);

-- ⚠️ inferred: unique semantics used operationally; keep nullable-compatible uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_email ON public.customers (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_dashboard_id ON public.customers (dashboard_id) WHERE dashboard_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  -- ✅ sicher: auth principal mapping used by current_customer_id()/RLS
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ✅ sicher (runtime writes/reads)
  customer_id text REFERENCES public.customers(id),

  -- ⚠️ inferred (runtime writes, no full historical DDL in repo)
  email text,
  role text,
  is_admin boolean,

  -- ✅ sicher (runtime writes)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ inferred operational uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON public.users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_customer_id ON public.users (customer_id);

-- ---------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calls (
  -- ⚠️ inferred: legacy systems commonly used text IDs for call rows
  id text PRIMARY KEY,

  -- ⚠️ inferred: provider-side call id often unique
  call_id text,

  -- ✅ sicher: required by RLS predicate and runtime joins
  customer_id text NOT NULL REFERENCES public.customers(id),

  -- ⚠️ inferred: runtime-mapped fields
  caller_name text,
  caller_phone text,
  called_number text,
  voxera_number text,
  date date,
  created_date_raw date,
  duration_seconds integer,
  summary text,
  call_summary text,
  call_summary_short text,
  category text,
  quality text,
  lead_quality text,
  callback_requested boolean,
  dashboard_status text NOT NULL DEFAULT 'new',
  next_action text,
  follow_up_at date,
  transcript text,
  transcript_json jsonb,
  assigned_to uuid REFERENCES auth.users(id),
  status text,
  notes text,
  direction text NOT NULL DEFAULT 'inbound',

  -- ✅ sicher (runtime sorting + display)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,

  -- ✅ sicher: existing migration canonicalizes this domain
  CONSTRAINT calls_dashboard_status_check CHECK (dashboard_status IN ('new', 'in_progress', 'follow_up_scheduled', 'closed')),
  CONSTRAINT calls_direction_check CHECK (direction IN ('inbound', 'outbound'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_call_id ON public.calls (call_id) WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_customer_id_created_at ON public.calls (customer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cases (
  -- ⚠️ inferred: runtime inserts without id imply default-generated PK
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ✅ sicher: required by RLS predicate and runtime joins
  customer_id text NOT NULL REFERENCES public.customers(id),

  -- ✅ sicher: canonicalized by runtime + backfill migration
  title text,
  note text,
  status text NOT NULL DEFAULT 'open',

  -- ⚠️ inferred: runtime optional fields / compatibility
  priority text,
  owner text,
  mail_template text,

  -- ⚠️ inferred: legacy compatibility fields still referenced as fallback
  type text,
  notes text,

  -- ✅ sicher (runtime write + read)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ✅ sicher: existing migration canonicalizes this domain
  CONSTRAINT cases_status_check CHECK (status IN ('open', 'in_progress', 'waiting', 'done'))
);

CREATE INDEX IF NOT EXISTS idx_cases_customer_id_status ON public.cases (customer_id, status);

-- ---------------------------------------------------------------------------
-- onboarding
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.onboarding (
  -- ⚠️ inferred: runtime inserts uuid ids
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ✅ sicher: 1:1 logical model in runtime (one onboarding row per customer)
  customer_id text NOT NULL UNIQUE REFERENCES public.customers(id),

  -- ✅ sicher: canonicalized by existing migrations/runtime
  status text NOT NULL DEFAULT 'not_started',
  progress integer NOT NULL DEFAULT 0,

  -- ⚠️ inferred: runtime write/read fields
  next_step text,
  blocker text,
  owner text,

  -- ✅ sicher (runtime)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT onboarding_status_check CHECK (status IN ('not_started', 'in_progress', 'blocked', 'ready', 'completed')),
  CONSTRAINT onboarding_progress_check CHECK (progress >= 0 AND progress <= 100)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_status_progress ON public.onboarding (status, progress);

-- ---------------------------------------------------------------------------
-- admins
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admins (
  -- ✅ sicher: is_admin() resolves authorization via admins.id = auth.uid()
  id uuid PRIMARY KEY REFERENCES auth.users(id),

  -- ✅ sicher (runtime)
  email text,
  role text NOT NULL DEFAULT 'admin',
  status text NOT NULL DEFAULT 'active',
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- ⚠️ inferred (runtime + docs)
  name text,
  force_password_change boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admins_status_check CHECK (replace(lower(status), '_', '-') IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admins_email ON public.admins (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admins_role ON public.admins (role);
CREATE INDEX IF NOT EXISTS idx_admins_status ON public.admins (status);

-- End of governance DDL snapshot.
