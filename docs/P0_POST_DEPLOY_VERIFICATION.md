# P0 Post-Deploy Verification

This checklist applies only after an approved Supabase migration and Netlify deployment. It has not been run against production.

## 1. Database verification

Run:

```text
supabase/verification/p0_security_post_migration.sql
```

Required result: every named check returns `PASS`.

Additionally inspect the detailed policy and GRANT result sets and attach a redacted export to the deployment record.

## 2. Audio endpoint tests

Use real test records, not customer production calls. Never paste tokens or audio into the deployment record.

| Case | Request identity | Conversation ID | Expected |
|---|---|---|---|
| no token | none | known test call | `401 auth_token_missing` |
| invalid token | invalid/expired | known test call | `401 auth_token_invalid` |
| user without customer mapping | authenticated user with no `users.customer_id`, not admin | known test call | `403 customer_context_missing` |
| foreign tenant | customer A | customer B test call | `403 tenant_access_denied`; no ElevenLabs request |
| unknown conversation | customer A | nonexistent ID | `404 call_not_found`; no ElevenLabs request |
| own call | customer A | customer A test call | `200`, audio returned |
| admin | active canonical admin | customer B test call | `200`, audio returned |
| provider failure | authorized test request while provider is deliberately unavailable in a controlled environment | own call | `502 elevenlabs_audio_fetch_failed`, no provider body |

### CORS

- Allowed Origin echoes that exact Origin and adds `Vary: Origin`.
- Disallowed Origin returns `403 origin_not_allowed` without `Access-Control-Allow-Origin`.
- No response uses `Access-Control-Allow-Origin: *`.
- Same-origin/server requests without an Origin header remain possible but do not receive a CORS allow header.

### Logging

Inspect Netlify Function logs and confirm they do not contain:

- Bearer tokens;
- Supabase keys;
- ElevenLabs keys;
- provider response bodies;
- base64 audio;
- raw audio bytes.

## 3. Call ingestion

Trigger controlled test calls through each active server path:

1. Twilio inbound router.
2. ElevenLabs post-call webhook.
3. Any active test-call Function.

Expected:

- call rows are created by the backend;
- anon and ordinary authenticated direct inserts fail;
- existing customer SELECT/UPDATE behavior remains tenant-scoped.

## 4. Notifications

1. Complete a controlled test call that creates a notification.
2. Confirm the server-side notification row is created.
3. Attempt a direct anon INSERT: it must fail.
4. Attempt a direct ordinary authenticated INSERT: it must fail unless a separately approved tenant-scoped policy is introduced later.
5. Confirm existing notification reads still follow their live tenant policy.

## 5. AI change requests

With customer A, customer B and an admin:

- customer A can create/read/update/delete only rows whose `customer_id` equals customer A;
- customer A receives no rows belonging to customer B;
- customer A cannot change a row's `customer_id` to customer B;
- customer B has symmetric isolation;
- an active valid admin can process all rows;
- a disabled or unknown admin row does not receive admin access;
- policy `authenticated_read_all` no longer exists.

## 6. System configuration

- ordinary customer SELECT on `system_config` returns no rows or a permission-safe empty result;
- ordinary customer cannot retrieve `key = 'prompt_master_l1'`;
- active admin can read through the admin policy where the admin client requires direct access;
- `trigger-elevenlabs-sync` can still read `prompt_master_l1` using the server-side service role and complete a controlled sync.

## 7. Function privileges

Confirm via the post-migration script:

- `delete_auth_user_data(uuid)`: service role yes; PUBLIC/anon/authenticated no;
- `ensure_user_profile(text,text,text)`: authenticated and service role yes; anon/PUBLIC no;
- `ensure_user_profile(text,text)`: authenticated/anon/PUBLIC no if present;
- `current_customer_id()` and required admin helpers: authenticated execution remains available;
- trigger and backend maintenance functions have no unnecessary direct client execution.

## 8. Completion record

Record:

- Supabase project ref, without keys;
- migration execution timestamp;
- migration operator;
- post-check output;
- Netlify site name;
- production deploy ID and commit SHA;
- test identities used, without tokens or personal data;
- pass/fail result for every section;
- any rollback or exception decision.
