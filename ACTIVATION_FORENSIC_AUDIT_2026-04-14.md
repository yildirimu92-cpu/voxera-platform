# Voxera Activation Module – Forensic Root-Cause Audit (2026-04-14)

## Scope
This audit covers:
- Canonical activation data model (frontend/backend/DB)
- `customer-update-settings` persistence path
- Activation V2 frontend state architecture
- Navigation/surface determinism
- Test-call lifecycle
- Help/codes coupling

---

## A) Exact root causes

### 1) Data model root causes

1. **Canonical model is split across three layers, but the live DB can lag behind the backend write contract.**
   - Backend accepts and writes eight activation-state fields plus `forwarding_setup_completed`/timestamps.
   - Frontend writes these fields aggressively in reset/retry/start/confirm flows.
   - DB migration that introduces/normalizes these columns/check constraints exists but can be unapplied in live environments.

2. **No enforced cross-field invariants in DB or backend for invalid combinations.**
   - Example: `forwarding_status='active'` can coexist with null/empty `last_confirmed_*` in persistence logic.
   - Example: `pending_test` relies on `activation_started_at` semantically, but invariant is not enforced in database constraints.

3. **Frontend treats persisted selections and in-session selections as interchangeable “effective state”, hiding model drift.**
   - Render reads `current flow || persisted` while control gates require `current flow` for progression.

### 2) Backend persistence root causes

1. **Primary 500 cause: schema-fallback retry is capped to 4 attempts while payloads can include >4 missing columns.**
   - `updateCustomerWithSchemaFallback` removes one missing column per attempt and retries at most 4 times.
   - Activation reset payloads include up to 9 activation fields; on a DB missing many of these columns, update fails with 42703 after retry budget is exhausted and returns HTTP 500.

2. **Secondary silent-failure cause: fallback deletes unknown columns and still returns success, so UI believes save worked although specific field was dropped.**
   - Device/mode saves can appear successful in-session but disappear after reload when column absent.

3. **Whitelist/validation mismatch is not the main production failure pattern.**
   - Backend accepts expected activation fields and validates value enums correctly.
   - Most observed “cannot save” behavior aligns with DB schema mismatch + fallback behavior, not frontend sending invalid enums.

### 3) Frontend state architecture root causes

1. **Two activation architectures coexist (legacy activation module + Activation V2 state machine) and both are still executed from shared lifecycle points.**
   - `loadData()` calls both `renderActivationModule()` (legacy) and `safeMountActivationV2()` (new).
   - This duplicates side effects and complicates reasoning about truth source.

2. **Activation V2 rehydrates localStorage state on every render, which can overwrite just-updated in-memory flow state.**
   - `renderActivationV2()` calls `restoreActivationV2FlowState()` every render.
   - Reset/restart paths can be followed by stale local value restoration unless storage is fully coherent.

3. **Step gating and display source differ.**
   - CTA enablement depends on `confirmed*` current-flow values.
   - Display labels use “effective” values that may come from persisted data.
   - This creates “looks selected but cannot proceed” and “state reappears after reset/re-entry” patterns.

4. **Reset/retry mutates local state optimistically and then verifies persisted state with strict equality, making UX brittle under partial backend persistence failures.**

### 4) Routing/navigation root causes

1. **Activation and Help are hard-coupled via direct navigation actions from activation controls.**
   - Multiple activation actions route immediately to `showTab('hilfe')` via `openHelpSection('forwarding')`.

2. **Help, setup guidance, and activation actions are mixed across surfaces rather than strictly separated.**
   - Setup overlay, help tab direct-apply/copy controls, and activation CTA paths all overlap.

3. **Session-tab restoration rules interact with setup-finished flags and can produce non-obvious tab outcomes after retries/re-entry.**

### 5) Test-call flow root causes

1. **Test flow is dependent on settings persistence path before Twilio orchestration.**
   - Both smartphone and landline test start first persist `pending_test` and activation fields through `customer-update-settings`.
   - If persistence fails/partially fails, test state machine breaks before or during system call orchestration.

2. **Candidate detection uses in-memory `candidateCall` + polling, not persisted canonical candidate state.**
   - Candidate is detected from calls list each refresh; in-memory marker can reset on reload.
   - `activation_test_candidate_call_id` exists but is not used as primary source of truth during detection/confirmation.

3. **Timeout window mismatch risk.**
   - Pending state timeout is 3 minutes in client test logic, while UI-state failure heuristic elsewhere uses 45 minutes.

### 6) Help/codes root causes

1. **Help section contains execution controls (direct apply/copy) that affect activation behavior semantics without being part of the activation state machine.**

2. **Device capability heuristics in help (`userAgent`/viewport/pointer) determine direct-apply affordances separately from activation flow logic, creating diverging paths for smartphone/landline behavior.**

---

## B) Exact evidence map

### Data model / allowed values / nullability
- DB SoT fields and constraints: `forwarding_setup_completed` (NOT NULL default false), `forwarding_status` (NOT NULL default `not_started`), nullable `forwarding_mode`, `setup_device_type`, `activation_started_at`, `activation_test_mode`, `activation_test_candidate_call_id`, `last_confirmed_*`, `activated_at`. Value constraints are explicit for enums/checks.【supabase/sql/2026-04-08_core_tables_schema_sot.sql:51-87】
- Migration explicitly added “activation V2 customer state columns” to avoid 500s in customer updates; indicates historical schema drift in live environments.【supabase/sql/2026-04-14_activation_v2_customer_state_columns.sql:1-12】

### Backend persistence (`customer-update-settings`)
- Accepted activation-related fields and validators/whitelist logic are implemented in one handler (`setup_device_type`, `forwarding_status`, `activation_started_at`, `activated_at`, `forwarding_mode`, `activation_test_mode`, `activation_test_candidate_call_id`, `last_confirmed_*`, plus `forwarding_setup_completed`).【customer-dashboard/netlify/functions/customer-update-settings.js:79-185】
- Retry fallback deletes only one missing column per attempt and stops after 4 attempts; if more missing columns are present in payload, request still fails with 500.【customer-dashboard/netlify/functions/customer-update-settings.js:21-42】
- Error path returns 500 with message `Customer settings konnten nicht gespeichert werden.` and includes DB error code/details.【customer-dashboard/netlify/functions/customer-update-settings.js:205-217】

### Frontend state architecture
- Frontend write wrapper always calls `customer-update-settings` and throws on non-OK payloads; activation writes funnel through this path.【customer-dashboard/index.html:2964-2980】
- Activation V2 stores local flow state in localStorage and restores it repeatedly in render cycle.【customer-dashboard/index.html:6868-6885】【customer-dashboard/index.html:7397-7404】
- Effective values merge persisted DB state with current in-session state, while progression gates require in-session confirmations only.【customer-dashboard/index.html:6892-6900】【customer-dashboard/index.html:7417-7420】
- Retry/reset performs large multi-field resets and strict post-write verification, then mutates both customerMeta and cached context record.【customer-dashboard/index.html:7189-7247】【customer-dashboard/index.html:7254-7303】

### Routing/navigation / surfaces
- Setup tab now only renders `#activation-v2-shell`, but legacy activation rendering logic still exists and is called from load paths.【customer-dashboard/index.html:1928-1931】【customer-dashboard/index.html:5532-5599】【customer-dashboard/index.html:3761-3765】
- Activation actions route into Help tab via `openHelpSection('forwarding')` (`open-help-forwarding` action).【customer-dashboard/index.html:4964-4971】【customer-dashboard/index.html:7363-7365】
- Settings CTA opens activation; separate Help CTA opens help, contributing to cross-surface branching behavior.【customer-dashboard/index.html:1994-1995】【customer-dashboard/index.html:2075】

### Test-call flow
- Start flows (smartphone/landline) first persist `pending_test` + activation fields via settings update; failure there blocks test progression.【customer-dashboard/index.html:6116-6143】【customer-dashboard/index.html:6152-6173】
- System test-call function hard-requires customer `forwarding_status='pending_test'` and `activation_started_at` before Twilio call can be started.【customer-dashboard/netlify/functions/activation-start-system-test-call.js:151-158】
- Candidate detection is derived from calls list: outbound marker `category='activation_test_outbound'` then first qualifying inbound within timeout window; stored in in-memory `candidateCall` variable.【customer-dashboard/index.html:6018-6077】
- Polling/retry lifecycle is in-memory driven (`candidateCall`, intervals), not DB-first for candidate confirmation state.【customer-dashboard/index.html:6092-6114】【customer-dashboard/index.html:6271-6279】

### Help/codes interference
- Help tab includes code rendering, copy, and direct-apply controls (`tel:` deep links) and device heuristics, independent from activation state machine state transitions.【customer-dashboard/index.html:4986-5025】【customer-dashboard/index.html:5038-5065】【customer-dashboard/index.html:5153-5166】

---

## C) Architecture assessment

**Assessment: salvageable with targeted refactor (not full rewrite), but only if done as a bounded architecture correction, not tactical button fixes.**

Why salvageable:
- There is already a mostly complete canonical field set and value constraints in SQL and backend validators.
- Activation V2 has a coherent intent (3-step guided flow), but state ownership boundaries are violated.

Why refactor is mandatory:
- Persistence adapter currently masks schema drift and causes both hard 500s and silent data loss patterns.
- Activation and help/test surfaces are not isolated enough to remain deterministic under failures.

---

## D) Recommended fix order (highest leverage first)

1. **Persistence hardening first (blocker).**
   - Remove partial-success schema fallback behavior in production path.
   - Fail-fast with explicit missing-column diagnostics and telemetry.
   - Ensure DB migration parity across all environments before accepting writes.

2. **Define and enforce one canonical activation state contract.**
   - Add backend invariants for invalid combinations (e.g., `pending_test` requires `activation_started_at`; `active` requires confirmed device/mode snapshot).
   - Enforce in one server-side state transition function (or equivalent) rather than many ad-hoc updates.

3. **Unify frontend to one state owner.**
   - Keep Activation V2 only; remove legacy `renderActivationModule` flow calls and dead side-effects.
   - Separate persisted server state vs local transient UI state; no implicit `current || persisted` merges for step gating.

4. **Split activation and help surfaces.**
   - Help should be read-only guidance by default.
   - Activation execution actions stay in activation module; help links open docs/content only.

5. **Refactor test-call flow to DB-backed session state.**
   - Persist test session id/outbound id/candidate id deterministically.
   - Client should render from persisted status and poll idempotent backend endpoint, not infer solely from in-memory call scans.

6. **Then cleanup UX/text/buttons.**
   - Only after architecture and persistence are stable.

---

## E) Minimum viable stable customer-ready activation version

### Must include
1. **Deterministic 3-step activation flow in one module (Activation V2 only).**
2. **Reliable save of device + forwarding mode + status transitions via one backend transition API.**
3. **System test-call start/retry/confirm with persisted session identifiers.**
4. **Robust reset that clears canonical activation fields server-side and confirms readback.**
5. **Clear failure states with actionable recovery messages (no silent fallback).**

### Temporarily disable/remove
1. **Schema-fallback column-dropping writes in `customer-update-settings`.**
2. **Legacy activation module execution path (`renderActivationModule` lifecycle calls).**
3. **Help “direct apply” controls that execute activation-adjacent actions outside the activation flow (temporarily read-only help).**
4. **Any UI path that can navigate users into help mid-transition without preserving/explicitly resuming activation context.**

---

## Canonical activation fields summary (as implemented in code/DB)

- `setup_device_type`: `mobile | landline | null`
- `forwarding_mode`: `no_answer | unreachable | always | busy | null`
- `forwarding_status`: `not_started | pending_test | active | inactive` (NOT NULL)
- `forwarding_setup_completed`: `boolean` (NOT NULL)
- `activation_started_at`: `timestamptz | null`
- `activated_at`: `timestamptz | null`
- `activation_test_mode`: `system_call | manual_call | null`
- `activation_test_candidate_call_id`: `text | null`
- `last_confirmed_setup_device_type`: `mobile | landline | null`
- `last_confirmed_forwarding_mode`: `no_answer | unreachable | always | busy | null`

(Last two are required for skip/confirmation semantics in frontend, even though they were listed as candidate-adjacent fields.)
