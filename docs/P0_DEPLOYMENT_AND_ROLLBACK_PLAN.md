# P0 Deployment and Rollback Plan

No step in this plan has been executed against production.

## Preconditions

1. Confirm the intended production Supabase project and Netlify customer-dashboard site.
2. Record the current production deploy SHA and Netlify deploy ID.
3. Run `supabase/verification/p0_security_preflight.sql` in the Supabase SQL Editor with a role allowed to inspect catalog metadata.
4. Export the complete preflight results. This is the rollback source of truth.
5. Review every optional function overload, trigger, policy and table GRANT against external integrations, Edge Functions and Cron jobs.
6. Confirm `public.ai_change_requests.customer_id` exists and is compatible with `public.current_customer_id()`.
7. Confirm the deployed dashboard sends its current Supabase access token as `Authorization: Bearer <token>` when requesting conversation audio.
8. Confirm every required browser Origin is one of:
   - `https://dashboard.voxera.ch`
   - `https://admin.voxera.ch`
   - `https://voxera.ch`
   - or is explicitly configured in `VOXERA_ALLOWED_ORIGINS`.

Do not copy secret values into tickets, screenshots or repository files.

## Recommended rollout sequence

### Phase 1: Deploy-preview validation

1. Push the branch only; do not merge.
2. Create a Netlify deploy preview for the customer dashboard if previews are enabled.
3. Use test users for customer A, customer B and an active admin.
4. Execute the HTTP checks in `P0_POST_DEPLOY_VERIFICATION.md`.
5. Confirm the preview function logs contain no authorization tokens, provider response bodies or audio payloads.

### Phase 2: Supabase preflight decision

1. Compare live functions and policies with the matrices in this package.
2. Stop if an undocumented browser INSERT, trigger, policy dependency or cron invocation is found.
3. Build a live-specific rollback SQL file from the preflight definitions and ACLs. Do not use a generic broad-access rollback.

### Phase 3: Apply the Supabase migration

1. Open Supabase Dashboard → SQL Editor → New query.
2. Paste the exact contents of `supabase/migrations/2026-07-28_p0_security_foundation.sql`.
3. Reconfirm that the selected project is production.
4. Run once. The script uses a transaction and aborts on an incompatible required object.
5. Immediately run `supabase/verification/p0_security_post_migration.sql`.
6. Do not continue if any result is `FAIL`.

### Phase 4: Netlify production deploy

Only after the database post-check is clean:

1. Deploy the reviewed branch commit to the existing customer-dashboard site using the normal Git-connected production process.
2. Do not alter build settings, domains, environment values or scheduled functions during this rollout.
3. Confirm the deployed commit SHA equals the approved P0 commit.
4. Run the complete post-deploy verification checklist.

## Rollback triggers

Rollback immediately when any of the following occurs:

- customer audio requests fail for own calls;
- another tenant's audio is accessible;
- Twilio/ElevenLabs call ingestion fails after privilege changes;
- notifications are no longer created by the backend;
- customer AI change requests cannot be created or managed within their tenant;
- admin access to `system_config` fails;
- normal customers can still read `prompt_master_l1`;
- RLS helper functions fail with permission or search-path errors.

## Netlify rollback

1. Netlify Dashboard → affected site → Deploys.
2. Select the recorded previous production deploy.
3. Publish/restore that deploy according to the existing Netlify workflow.
4. Confirm the previous commit SHA is active.
5. Repeat the audio endpoint smoke tests.

This rolls back the Function code only. It does not restore Supabase policies or ACLs.

## Supabase rollback

### Preferred rollback during execution

If the migration errors before its final `COMMIT`, PostgreSQL rolls back the transaction. Record the error and do not retry until the live incompatibility is understood.

### Rollback after a successful commit

Use the preflight snapshot to restore exactly:

1. original `pg_get_functiondef` definitions where this migration replaced canonical functions;
2. original function owners, search-path settings and EXECUTE ACLs;
3. original policy definitions for `calls`, `notifications`, `ai_change_requests` and `system_config`;
4. original role table GRANTs.

Apply the live-specific rollback in one transaction, then rerun the preflight queries and targeted application smoke tests.

Do **not** restore `WITH CHECK (true)`, `authenticated_read_all` or broad `system_config` reads merely to make a failing client work. If rollback would reintroduce a P0 exposure, keep the affected feature disabled and correct the client/server path instead.

## Secret handling

No key rotation is included in this package. If logs or live inspection reveal exposure of a service-role key, ElevenLabs key, provider token or SMTP credential, treat rotation as a separate incident procedure after endpoint access is contained.
