# P0 Deployment and Rollback Plan

No step in this plan has been executed against production.

## Preconditions

1. Confirm the production Supabase project and Netlify customer-dashboard site.
2. Record the current production deploy SHA and Netlify deploy ID.
3. Run `supabase/verification/p0_security_preflight.sql` and save the complete result as rollback evidence.
4. Confirm `public.customers.auth_user_id` exists.
5. Confirm no non-null `customers.auth_user_id` is assigned to more than one customer.
6. Confirm `public.ai_change_requests.customer_id` exists and is compatible with `current_customer_id()`.
7. Review optional function overloads, triggers, policies, Edge Functions and Cron jobs.
8. Run the repository verifier from a full authenticated checkout:

   ```text
   node scripts/verify-p0-security-foundation.mjs
   ```

9. Confirm the actual dashboard call-site `vxTryLoadElevenLabsAudioFromDashboard` is replaced at runtime by the secure shared bootstrap.
10. Do not copy tokens, keys or audio into deployment records.

## Phase 1: Deploy-preview validation

1. Use a Netlify deploy preview only after explicit approval; do not merge.
2. Confirm `customer-dashboard/shared/offer-brand.js` is served from the approved commit.
3. In browser developer tools, activate “Audio abrufen” for a test call.
4. Confirm exactly one request is made to `/.netlify/functions/elevenlabs-conversation-audio`.
5. Confirm the request has an Authorization header without recording its value.
6. Confirm the `<audio>` source is a `blob:` URL, not the protected Function URL.
7. Load a second audio and confirm the previous Blob URL is revoked.
8. Test customer A, customer B, missing/expired session and an active admin.
9. Confirm logs contain no tokens, provider bodies or audio payloads.

## Phase 2: Supabase preflight decision

Stop before migration when any of the following is found:

- duplicate `customers.auth_user_id` bindings;
- missing required columns;
- an undocumented browser INSERT dependency;
- a policy/trigger/cron dependency on a privilege being removed;
- a live function definition incompatible with the prepared replacement.

Build a live-specific rollback SQL file from the preflight definitions, ACLs, policies and GRANTs.

## Phase 3: Apply the Supabase migration

Only after preflight approval:

1. Supabase Dashboard → SQL Editor → New query.
2. Paste the exact approved `supabase/migrations/2026-07-28_p0_security_foundation.sql`.
3. Reconfirm the project.
4. Run once; the script is transactional.
5. Immediately run `supabase/verification/p0_security_post_migration.sql`.
6. Stop if any result is `FAIL`.

## Phase 4: Production deployment

Only after the database post-check and deploy-preview tests pass:

1. Deploy the reviewed commit through the existing Git-connected process.
2. Do not alter build settings, domains, environment values or scheduled functions.
3. Confirm the deployed SHA equals the approved commit.
4. Run `P0_POST_DEPLOY_VERIFICATION.md`.

## Rollback triggers

- own-call audio fails;
- a foreign tenant can access audio;
- the dashboard sends no Bearer token or assigns the Function URL directly to audio src;
- customer provisioning becomes unbound unexpectedly;
- a customer can claim another `customer_id` through RPC parameters or metadata;
- `is_admin(uuid)` reveals another user's status;
- ingestion, notifications, AI requests or admin configuration access regress.

## Netlify rollback

Restore the recorded previous deploy from Netlify → Site → Deploys, confirm the previous SHA, and rerun audio smoke tests. This rolls back client/Function code only, not database ACLs or policies.

## Supabase rollback

If the migration fails before `COMMIT`, PostgreSQL rolls back the transaction. After a successful commit, use the preflight snapshot to restore the exact prior function definitions, ACLs, search paths, policies and table GRANTs in one transaction.

Do not restore broad P0 exposures merely to make a client work. Keep the affected feature disabled and correct the client/server path instead.
