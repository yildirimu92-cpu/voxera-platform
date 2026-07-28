# Voxera P0 Security Implementation Report

**Repository:** `yildirimu92-cpu/voxera-platform`  
**Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`  
**Implementation branch:** `stabilization/p0-security-foundation`

## Scope and status

This package prepares repository code, an idempotent Supabase migration, read-only verification scripts, automated tests and deployment documentation. It does **not** deploy a Netlify site, apply a production migration, change Netlify settings, rotate secrets or modify product data.

The productive Supabase and Netlify state remains live-dependent. Repository findings are not presented as proof of the current production runtime.

## Root causes addressed

### Server audio endpoint

`customer-dashboard/netlify/functions/elevenlabs-conversation-audio.js` now requires a Supabase Bearer token, resolves the caller through `public.users`, checks `calls.customer_id`, permits only a server-verified active admin exception, and calls ElevenLabs only after authorization. Provider response bodies and audio payloads are not logged or included in errors. Wildcard CORS was removed.

### Actual Customer Dashboard audio client

The actual call-site was identified in the dashboard monolith as:

- `vxTryLoadElevenLabsAudioFromDashboard(btn)` in `customer-dashboard/index.html`;
- it is invoked by the “Audio abrufen” button created by `vxRenderCallAudioCardHtml(...)` when only an ElevenLabs conversation ID is present;
- the legacy implementation called the Function without an Authorization header and tried three endpoint names;
- the resulting audio was assigned to the existing modern player through a Blob URL.

`customer-dashboard/shared/offer-brand.js` is loaded synchronously by the dashboard before the monolithic inline scripts. It now contains a narrowly scoped conversation-audio client and installs a post-parse bridge on `DOMContentLoaded` that replaces the legacy global call-site before a user can activate the button.

The controlled flow now:

1. obtains the current Supabase client through `getSupabaseAuthClient()`;
2. loads the current session with `auth.getSession()`;
3. rejects a missing session or access token before any request;
4. calls only `/.netlify/functions/elevenlabs-conversation-audio`;
5. sends `Authorization: Bearer <access token>`;
6. consumes the response with `response.blob()`;
7. creates the player URL using `URL.createObjectURL(...)`;
8. revokes the previous Blob URL after a successful replacement and on page unload;
9. maps `401`, `403`, `404` and `502` to customer-safe messages;
10. does not log tokens or audio content and contains no service-role key.

The existing visual audio player and controls remain unchanged. A protected Function URL is not assigned directly to an `<audio src>`.

### Tenant-safe `ensure_user_profile(text,text,text)`

The compatibility signature remains, but all three caller parameters are ignored for tenant binding. The function no longer reads `raw_user_meta_data` or other user-controlled metadata.

Binding rules:

1. `auth.uid()` is mandatory;
2. an existing `public.users` row is loaded or created unbound;
3. an existing `users.customer_id` is returned unchanged;
4. an unbound profile is matched only against `public.customers.auth_user_id = auth.uid()`;
5. exactly one match permits assignment;
6. no match returns the unbound profile;
7. multiple matches raise a controlled ambiguity error;
8. all table references are schema-qualified and `search_path` remains `pg_catalog`.

The server-side `create-customer.js` path remains compatible because it already writes both `customers.auth_user_id` and `users.customer_id`.

### Self-only `is_admin(uuid)`

The UUID signature remains for RLS compatibility, but the function now returns true only when:

- `auth.uid()` is present;
- `p_user_id IS NOT DISTINCT FROM auth.uid()`;
- the active admin row belongs to `auth.uid()`.

An authenticated user cannot use the function to inspect another UUID. Existing policies using `is_admin(auth.uid())` retain their intended behavior. A service-role request without a user identity cannot use the argument as an arbitrary lookup oracle.

### RLS and table privileges

The migration continues to:

- remove browser/anonymous INSERT rights from `calls` and `notifications`;
- replace broad `ai_change_requests` policies with tenant policies plus `is_admin(auth.uid())`;
- make `system_config` directly readable only through the admin policy;
- preserve service-role server paths.

## Repository dependency findings

- Call creation/upsert paths found in the repository are server-side Netlify Functions.
- Notification INSERT usage was found in server-side post-call processing.
- `prompt_master_l1` is read by a server-side admin Function; no customer-browser requirement was proven.
- `current_customer_id()` and `is_admin(uuid)` are used by repository RLS SQL.
- `handle_auth_user_created()` is a trigger function and has no direct client grant.
- The legacy two-argument `ensure_user_profile` remains a removal candidate.

## Changed implementation files

- `customer-dashboard/shared/offer-brand.js`
- `customer-dashboard/tests/conversation-audio-client.test.cjs`
- `supabase/migrations/2026-07-28_p0_security_foundation.sql`
- `supabase/verification/p0_security_preflight.sql`
- `supabase/verification/p0_security_post_migration.sql`
- `scripts/verify-p0-security-foundation.mjs`
- five P0 documentation files under `docs/`

The existing server endpoint and its tests from the first P0 commit remain part of the branch.

## Validation performed

- `node --test customer-dashboard/tests/conversation-audio-client.test.cjs`
  - 9 tests passed, 0 failed.
- existing server endpoint suite remains available at `customer-dashboard/tests/elevenlabs-conversation-audio.test.cjs`.
- `node --check` completed without syntax errors for the changed JavaScript files.

The repository verification script was extended to inspect the full checked-out `customer-dashboard/index.html`, the secure shared bootstrap, migration bodies and both SQL verification scripts. In the current execution environment the private repository could not be cloned because no GitHub CLI/token and no DNS access were available; therefore the expanded full-checkout verifier must be run in an authenticated local checkout or CI before deployment.

The SQL migration was not executed against Supabase and was not parsed by a live PostgreSQL server. The read-only preflight remains mandatory.

## Remaining risks

1. Live functions, policies, overloads, triggers and GRANTs can differ from repository files.
2. `customers.auth_user_id` must exist and non-null values must map uniquely; the preflight reports duplicate bindings.
3. The dashboard monolith still contains the legacy function text, but the synchronously loaded shared bootstrap neutralizes and replaces its global runtime binding before user interaction. A later non-P0 refactor should move the call-site directly into a dedicated dashboard module.
4. The secure client bridge and server endpoint require deploy-preview browser verification with two tenants and an admin.
5. Required browser Origins outside the known Voxera domains require explicit allowlist configuration in a separate approved operational step.
6. No production migration or deployment has been performed.
