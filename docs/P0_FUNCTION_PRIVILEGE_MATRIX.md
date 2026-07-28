# P0 Function Privilege Matrix

**Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

This matrix separates repository evidence from live verification. The live function definitions, owners, ACLs, trigger dependencies and cron usage must be captured with `supabase/verification/p0_security_preflight.sql` before the migration is run.

| Function | Repository usage / dependency | RLS | Trigger | Netlify / frontend | Required direct roles after P0 | Search path after P0 | Migration behavior |
|---|---|---:|---:|---|---|---|---|
| `delete_auth_user_data(uuid)` | Repository SQL states backend-only auth deletion | No repository RLS use found | No | Intended service-role backend use; no active RPC call confirmed | `service_role` only | `pg_catalog` | Canonical fully qualified definition; PUBLIC/anon/authenticated revoked |
| `ensure_user_profile(text,text,text)` | Repository provisioning SQL; authenticated `auth.uid()` invariant | Possible customer provisioning helper | No | Exact active RPC call not found; authenticated contract retained | `authenticated`, `service_role` | `pg_catalog` | Canonical definition preserves `auth.uid()` check and qualified tables |
| `ensure_user_profile(text,text)` | No active repository dependency found; designated legacy signature | Not found | Not found | Not found | `service_role` only, if present | `pg_catalog, public, auth` | Not dropped; exact signature guarded; removal candidate |
| `cleanup_old_notifications()` | No active repository invocation found | No repository policy use found | No repository trigger found | No Netlify invocation found | `service_role` only, if present | `pg_catalog, public` | Body preserved; exact signature guarded |
| `handle_auth_user_created()` | Created as auth-user trigger function in repository SQL | No | Yes, `auth.users` after insert | No direct call required | no direct client grant | `pg_catalog` | Canonical qualified trigger body; all client/service direct grants revoked |
| `current_customer_id()` | Used by customer RLS policies for customers, calls, onboarding and cases | Yes | No | No direct browser RPC requirement found | `authenticated`, `service_role` | `pg_catalog` | Canonical qualified definition and explicit grants |
| `is_admin(uuid)` | Used by admin RLS policies; default argument permits `is_admin()` style invocation | Yes | No | No direct frontend RPC requirement found | `authenticated`, `service_role` | `pg_catalog` | Canonical active-role/status check and explicit grants |
| `is_admin()` exact overload | No exact repository definition or call found; may exist live | Live policy dependency unknown | Unknown | Not found | `authenticated`, `service_role`, if present | `pg_catalog, public, auth` | Body preserved; exact signature guarded |
| `is_super_admin()` | No repository use found | Live policy dependency unknown | Unknown | Not found | `authenticated`, `service_role`, if present | `pg_catalog, public, auth` | Body preserved; exact signature guarded |
| `next_customer_code(integer)` | No repository call found; customer creation currently constructs an ID in Netlify code | No repository policy use found | No repository trigger found | No active RPC call found | `service_role` only, if present | `pg_catalog, public` | Body preserved; exact signature guarded |

## Role rules implemented

| Role | Default P0 rule |
|---|---|
| `PUBLIC` | EXECUTE revoked from all listed SECURITY DEFINER functions |
| `anon` | No EXECUTE retained |
| `authenticated` | Retained only for RLS helpers and the canonical three-argument profile function |
| `service_role` | Retained for backend functions and helpers required by server paths |
| function owner / trigger engine | Ownership is not changed; trigger invocation remains governed by the trigger definition |

## Legacy removal candidate

`public.ensure_user_profile(text,text)` is intentionally not dropped in this package. After live dependency inspection confirms no policy, trigger, frontend RPC, Netlify Function or external automation depends on it, it should be removed in a separate migration with its own rollback evidence.

## Live evidence required before application

1. `pg_get_functiondef` for every listed overload.
2. `proacl`, `proconfig`, owner and `prosecdef` from `pg_proc`.
3. trigger references from `information_schema.triggers`.
4. policy expressions from `pg_policies`.
5. Supabase Cron/pg_cron jobs and Edge Functions that may call maintenance RPCs.
6. API logs or code for external clients not represented in this repository.
