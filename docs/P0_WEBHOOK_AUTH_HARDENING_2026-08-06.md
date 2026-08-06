# P0 Auth Hardening: AI Report Token Check + Twilio Status Callback Signature — 2026-08-06

**Baseline:** `origin/codex/restore-customer-launch-checks` (includes the merged PR #805 RLS migration)
**Source finding:** `SECURITY_BESTANDSAUFNAHME_2026-08-06.md`, P0-3, P0-4

No step in this document has been executed against production. No Netlify deploy has
been made. This session has no Supabase credentials or Netlify deploy access.

## Scope

| Finding | File | Problem | Fix |
|---|---|---|---|
| P0-3 | `customer-dashboard/netlify/functions/ai-daily-report.js` | Auth check only tested `authHeader.startsWith('Bearer ')` — never validated the token, so any string worked. Result: an unauthenticated, unbounded proxy to the Anthropic API on the platform's key | Replace with `requireCustomerCaller`, the same guard used by 25 neighboring customer-dashboard functions |
| P0-4 | `customer-dashboard/netlify/functions/twilio-status-callback.js` | No `X-Twilio-Signature` verification at all, unlike its sibling `twilio-inbound-router.js`. Anyone could POST a fake `CallSid`/`CallStatus`/`CallDuration` and write `calls.duration_seconds`, which feeds billing | Add the same HMAC-SHA1 signature check `twilio-inbound-router.js:112-125` already does correctly, via a new shared helper |

## P0-3 detail

`ai-daily-report.js` is called exclusively through the dashboard's
`callDashboardFunction()` helper (`customer-dashboard/index.html:12989`), which always
attaches a real Supabase `Authorization: Bearer <access_token>` header — the same
calling convention every other guarded customer-dashboard function relies on. There
was therefore no reason for this one function to hand-roll its own (broken) check
instead of using the existing guard.

The fix drops in `requireCustomerCaller` exactly as used by, e.g.,
`get-available-voices.js` and `customer-cancel-contract.js`: it resolves the caller's
Supabase user via `auth.getUser(token)` (not just header shape), then their
`customer_id`, then requires an active contract (the guard's default, kept here for
consistency with every other guarded AI-adjacent endpoint — a lapsed customer
shouldn't be spending paid model inference either). The prompt-building and Anthropic
call logic is otherwise byte-identical to before; only the auth check and response
shape (now routed through a `response()` helper for consistent CORS headers, matching
the sibling functions) changed.

**Not changed:** rate limiting per caller. The guard fixes the "anyone at all" problem;
a legitimate but chatty customer session could still call this repeatedly. Out of
scope for this PR — flag if you want it added.

## P0-4 detail

New shared module: `customer-dashboard/netlify/functions/_lib/twilio-signature.js`.

- `requestHeader`, `computeTwilioSignature`, `validateTwilioSignature` are modeled
  byte-for-byte on `twilio-inbound-router.js:100-125` (the correct, already-relied-upon
  implementation named in the request).
- `resolveStatusCallbackUrl` (+ `normalizeBaseUrl`) duplicates
  `twilio-inbound-router.js:9-30` on purpose, not by oversight: the signature can only
  validate against the *exact* URL string that was registered with Twilio as
  `StatusCallback` when the call was attached
  (`twilio-inbound-router.js`'s `attachTwilioStatusCallback`, which uses this same
  construction) — it cannot be reconstructed from the incoming request's own
  path/headers, because Netlify's `/twilio/status-callback` → `/.netlify/functions/...`
  redirect can change what the Lambda event reports. Reusing the identical,
  already-correct construction removes any guessing.
- `twilio-inbound-router.js` itself is **not modified** by this PR. It already
  contains this exact logic inline and is correct today; touching a file that routes
  live inbound phone calls was judged out of proportion for a PR whose target is the
  status-callback sibling. The header comment in the new shared module states this
  duplication is intentional and must be kept in sync if the router's construction
  ever changes — a follow-up could point the router at the shared module too, but that
  carries its own regression risk and wasn't requested.
- `twilio-status-callback.js` reuses the identical `TWILIO_WEBHOOK_SIGNATURE_ENFORCEMENT_ENABLED`
  flag the router already uses (default: enforced; `'false'` disables it), so one
  setting governs both Twilio webhooks rather than introducing a second flag name.
  The fail-open nature of that flag itself is a separate, already-documented finding
  (P2-12 in the audit) and is not addressed here.
- The signature check runs immediately after `parseBody(event)`, before any Supabase
  interaction — matching where the router places its own check — so a forged request
  never reaches the database.

## Verification performed (no live credentials available)

Everything below ran locally in this session; nothing touched Supabase or Netlify.

1. **Syntax:** `node --check` on all three touched/new files — clean.
2. **External, independently-known-correct test vector.** Twilio's own
   ["Validating Requests"](https://www.twilio.com/docs/usage/security#validating-requests)
   documentation publishes a fixed example: auth token `12345`, URL
   `https://mycompany.com/myapp.php?foo=1&bar=2`, a specific parameter set, and the
   expected signature `RSOYDt4T1cUTdK1PDd93/VVr8B8=`. Running
   `computeTwilioSignature()` from the new shared module against that exact input
   reproduces `RSOYDt4T1cUTdK1PDd93/VVr8B8=` byte-for-byte. This confirms the HMAC
   implementation is correct against an authority outside this repository, not just
   self-consistent.
3. **Behavioral test of `twilio-status-callback.js`**, run against the real handler
   with `@supabase/supabase-js` stubbed out (so it never needs a live database) and a
   correct signature computed via `resolveStatusCallbackUrl()` + the real auth token:
   - no `X-Twilio-Signature` header → `403`
   - wrong signature → `403`
   - **correct signature, but the POST body tampered after signing** (`CallDuration`
     changed from `42` to `99999`) → `403` — proves the check is over the actual
     payload, not just header presence
   - correct signature, untampered body → passes the gate and reaches the
     pre-existing "Supabase env missing" `500` (env vars deliberately left unset in
     the test), proving a legitimate Twilio request still flows through
   - `TWILIO_WEBHOOK_SIGNATURE_ENFORCEMENT_ENABLED=false` + a bad signature → bypassed
     as designed, matching the router's own escape hatch
4. **Behavioral test of `ai-daily-report.js`**, with `@supabase/supabase-js` stubbed
   to simulate a real customer session (valid user → `users.customer_id` → an active
   `contracts` row) and a fake `ANTHROPIC_API_KEY`-unset environment so the guard's
   pass/fail is observable without calling Anthropic:
   - no `Authorization` header → `401 auth_token_missing`
   - **`Authorization: Bearer x`** — the exact string that satisfied the old
     `startsWith('Bearer ')` check — → `401 auth_token_invalid`
   - a well-formed but wrong/expired token → `401 auth_token_invalid`
   - a genuinely valid session token → passes the guard, reaches the pre-existing
     `500 API key not configured` (confirms it got past auth, not that the feature
     fully works without real credentials)
   - `OPTIONS` preflight → `204`

All test scripts and stub modules were written and run from the sandbox's scratch
directory, never committed, and removed after the run.

## Deploy-preview checklist (for whoever applies this)

- [ ] `TWILIO_AUTH_TOKEN` and one of `TWILIO_STATUS_CALLBACK_BASE_URL` / `URL` /
      `DEPLOY_PRIME_URL` / `DEPLOY_URL` are set on the Customer Dashboard Netlify site
      exactly as they already must be for `twilio-inbound-router.js` to attach status
      callbacks at all — this PR adds no new required configuration, it only starts
      checking a signature that was always computable.
- [ ] Place a real test call through the existing Twilio number and confirm the
      status callback still updates `calls.live_status` / `duration_seconds` in the
      dashboard (proves signature validation passes for genuine Twilio traffic).
- [ ] `curl` the status-callback endpoint directly with a forged `CallSid`/`CallStatus`
      and confirm `403 Forbidden`, no database row touched.
- [ ] Log into the customer dashboard, confirm the AI daily-report banner on the home
      screen still renders (proves a real session token now passes the new guard).
- [ ] Confirm a stale/expired dashboard session shows the existing "Sitzung nicht
      verfügbar" re-login message rather than a raw 401 leaking through (this is
      `callDashboardFunction`'s existing client-side handling, unchanged by this PR).

## Rollback

Both changes are pure code (no migration, no schema, no data). Reverting the commit
and redeploying the previous build is a complete rollback.

## Not in scope for this PR

- Rate limiting on `ai-daily-report.js` per authenticated caller.
- Fixing the `TWILIO_WEBHOOK_SIGNATURE_ENFORCEMENT_ENABLED` fail-open design (P2-12).
- Pointing `twilio-inbound-router.js` at the new shared `_lib/twilio-signature.js`
  module instead of its own inline copy — deliberately untouched, see P0-4 detail.
- P0-1, P0-2, P0-5 — already in PR #805 (merged into
  `codex/restore-customer-launch-checks`). Remaining P1/P2 items from the audit —
  separate PRs.
