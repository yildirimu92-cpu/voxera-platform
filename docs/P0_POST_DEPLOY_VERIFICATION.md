# P0 Post-Deploy Verification

This checklist applies only after an approved Supabase migration and Netlify deployment. It has not been run against production.

## 1. Repository and database checks

Run from a full checkout:

```text
node --test customer-dashboard/tests/elevenlabs-conversation-audio.test.cjs
node --test customer-dashboard/tests/conversation-audio-client.test.cjs
node scripts/verify-p0-security-foundation.mjs
```

Run in Supabase after migration:

```text
supabase/verification/p0_security_post_migration.sql
```

Every named database check must return `PASS`.

## 2. Customer Dashboard audio client

Use test calls only. Do not capture token values or audio content.

1. Open a call with only `elevenlabs_conversation_id` available.
2. Confirm the “Audio abrufen” button invokes `vxTryLoadElevenLabsAudioFromDashboard`.
3. Confirm the network request targets only `/.netlify/functions/elevenlabs-conversation-audio`.
4. Confirm an Authorization header is present.
5. Confirm the response is consumed as a Blob.
6. Confirm the rendered audio element uses a `blob:` URL.
7. Confirm no `<audio src>` points directly at the protected Function.
8. Load another recording and confirm the old Blob URL is revoked.
9. Reload/close the page and confirm the active Blob URL is released.

Expected customer messages:

| Result | Expected message behavior |
|---|---|
| no session / no access token / 401 | session expired; request re-login |
| 403 | no access to this recording |
| 404 | no recording found for the call |
| 502 | provider temporarily unavailable |

## 3. Audio endpoint authorization

| Case | Expected |
|---|---|
| no token | `401 auth_token_missing` |
| invalid token | `401 auth_token_invalid` |
| user without customer mapping | `403 customer_context_missing` |
| customer A requests customer B call | `403 tenant_access_denied`; no provider request |
| unknown conversation | `404 call_not_found`; no provider request |
| own call | `200`, binary audio |
| active admin | `200`, binary audio |
| provider failure | `502 elevenlabs_audio_fetch_failed`; no provider body |

Confirm CORS uses an allowed exact Origin and never `*`. Confirm logs contain no Bearer tokens, keys, provider bodies, base64 audio or raw audio bytes.

## 4. Tenant-safe profile binding

Use disposable test identities.

1. Existing `users.customer_id` remains unchanged when `ensure_user_profile` is called with different parameter values.
2. An unbound user with exactly one `customers.auth_user_id = auth.uid()` match is bound to that customer.
3. An unbound user with no server match remains unbound.
4. A caller cannot claim a known customer by supplying `p_customer_id`.
5. `p_dashboard_id`, `p_email` and auth metadata do not affect binding.
6. Duplicate customer rows for one `auth_user_id` are a deployment blocker and cause a controlled ambiguity error.
7. The existing `create-customer.js` flow still creates a customer with both `customers.auth_user_id` and `users.customer_id` populated.

## 5. Self-only admin helper

1. An ordinary authenticated user calling `is_admin(auth.uid())` receives false.
2. An active admin calling `is_admin(auth.uid())` receives true.
3. Any authenticated user calling `is_admin(<different UUID>)` receives false.
4. Existing admin RLS policies using `is_admin(auth.uid())` continue to work.
5. A service-role context without `auth.uid()` cannot use the parameter to enumerate admin status.

## 6. Existing P0 database controls

- anon and ordinary authenticated INSERT into `calls` fail;
- anon and ordinary authenticated INSERT into `notifications` fail;
- customer A cannot access customer B `ai_change_requests`;
- `authenticated_read_all` is absent;
- ordinary customers cannot read `prompt_master_l1`;
- backend ingestion, notification creation and ElevenLabs sync continue to work.

## 7. Protected Admin operations

1. Without a Bearer token, `trigger-elevenlabs-sync`, `elevenlabs-provision-agent`, `ai-apply-change` and `scrape-website` are rejected before tenant data is read.
2. An authorized Admin with `customer:write` can complete each operation.
3. Website extraction succeeds for a disposable public HTTPS site and rejects localhost, private/reserved IPs, embedded credentials, unsupported ports and private redirect targets.
4. The Admin AI workspace remains open for at least ten minutes without a full splash reload or loss of unsaved form state.
5. A newly provisioned and an existing synced ElevenLabs agent both show provider retention of 90 days.

## 8. Call intake secret

1. Production has a configured `CALL_INTAKE_WEBHOOK_SECRET` and the upstream caller sends the matching value.
2. Missing configuration returns `503 retention_configuration_missing` only in the isolated negative test; production must not remain in this state.
3. Missing or invalid caller secrets return `401`.
4. A valid signed test call maps to the correct tenant and creates or updates exactly one call.
5. Logs contain no secret, raw transcript or complete webhook body.

## 9. Data retention

1. Confirm the scheduled `enforce-data-retention` Function exists.
2. With the enable flag absent, it reports `enabled: false` and mutates nothing.
3. In a disposable dataset, rows just newer than 90 days remain unchanged.
4. Rows older than 90 days retain summaries and operational fields but have `transcript`, `transcript_json` and `elevenlabs_conversation_id` cleared.
5. Rows just newer than 180 days remain; rows older than 180 days are deleted.
6. Production enablement occurs only after snapshot and foreign-key review.
7. Provider-side agent privacy reports `retention_days = 90`.
8. `cleanup-stale-calls` remains a separate two-minute live-status safety net and is not counted as retention enforcement.

## 10. Completion record

Record project ref, migration timestamp/operator, redacted post-check output, Netlify site/deploy ID/SHA, test identities without personal data, retention cutoff counts, each pass/fail result, and any rollback decision.
