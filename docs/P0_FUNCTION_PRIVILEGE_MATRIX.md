# P0 Function Privilege Matrix

**Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

Live definitions, ACLs, owners, triggers and cron dependencies must be captured with `supabase/verification/p0_security_preflight.sql` before application.

| Function | Repository dependency | Required direct roles after P0 | Search path | P0 behavior |
|---|---|---|---|---|
| `delete_auth_user_data(uuid)` | Backend-only auth deletion | `service_role` | `pg_catalog` | PUBLIC/anon/authenticated revoked; qualified auth tables |
| `ensure_user_profile(text,text,text)` | Authenticated profile compatibility RPC | `authenticated`, `service_role` | `pg_catalog` | Parameters retained but ignored for tenant binding; no user metadata; only unique `customers.auth_user_id = auth.uid()` match may bind |
| `ensure_user_profile(text,text)` | No active dependency found; legacy signature | `service_role` only, if present | `pg_catalog, public, auth` | Not dropped; authenticated/anon/PUBLIC revoked; removal candidate |
| `cleanup_old_notifications()` | No repository invocation found | `service_role` only, if present | `pg_catalog, public` | Existing body preserved behind exact-signature guard |
| `handle_auth_user_created()` | Trigger on `auth.users` | no direct role | `pg_catalog` | Qualified trigger body; direct grants revoked |
| `current_customer_id()` | Customer RLS helper | `authenticated`, `service_role` | `pg_catalog` | Resolves only `auth.uid()` from `public.users` |
| `is_admin(uuid)` | Admin RLS helper, called as `is_admin(auth.uid())` | `authenticated`, `service_role` | `pg_catalog` | Parameter retained, but caller can evaluate only `auth.uid()`; foreign UUID returns false |
| `is_admin()` exact overload | Live existence/dependency unknown | authenticated/service role only if live dependency is confirmed | `pg_catalog, public, auth` | Existing body preserved behind guard |
| `is_super_admin()` | Live dependency unknown | authenticated/service role only if confirmed | `pg_catalog, public, auth` | Existing body preserved behind guard |
| `next_customer_code(integer)` | No active repository call found | `service_role` only, if present | `pg_catalog, public` | Existing body preserved behind guard |

## Tenant-binding invariants

`ensure_user_profile(text,text,text)` must never derive `customer_id` from:

- `p_customer_id`;
- `p_dashboard_id`;
- `p_email`;
- `raw_user_meta_data`;
- any other caller-controlled metadata.

A missing server-side match leaves the profile unbound. Multiple `customers.auth_user_id` matches are treated as an error and must be corrected before rollout.

## Admin-helper invariant

`is_admin(uuid)` is not an admin-directory lookup RPC. Its argument exists only for compatibility with policies that pass `auth.uid()`. The function body requires the supplied UUID to equal `auth.uid()` and checks the admin row using `auth.uid()` itself.

## Legacy removal candidate

`public.ensure_user_profile(text,text)` remains present only for rollback-safe compatibility. Remove it later in a separate migration after live policies, triggers, RPC logs, Edge Functions and external automations confirm no dependency.
