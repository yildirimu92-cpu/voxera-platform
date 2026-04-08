# Voxera Repository – Internal Technical System Documentation (Repo-verified)

_Date:_ 2026-04-06  
_Method:_ Static code inspection of repository contents only.

## Evidence policy
- This document only describes behavior verifiable from files in this repository.
- If implementation is not present in code, it is marked as **not verifiable from repo**, **external dependency**, or **assumption required**.

---

## A. Executive summary

Voxera is implemented as two static frontend applications (`admin-panel`, `customer-dashboard`) plus Netlify serverless functions under `admin-panel/netlify/functions`. The customer dashboard is Supabase-direct (reads/writes tables from the browser via `supabase-js`). The admin portal currently combines one real backend flow (create customer via function) with extensive in-browser mock state for customers/calls/cases/onboarding in `admin-panel/index.html`.

Customer activation is implemented via backend functions: `activate-subscription` validates customer status, upserts a `subscriptions` row, updates `customers`, and triggers `send-welcome`; `send-welcome` generates a Supabase recovery link and posts payload to a Make webhook.

Database usage observable in code centers on tables: `admins`, `users`, `customers`, `calls`, `onboarding`, `subscriptions`, `contracts`. A provisioning RPC `ensure_user_profile` links auth users to `public.users.customer_id`.

Key gaps: no transactional integrity in multi-step function flows, admin UI remains largely local-state/mocked, explicit hardcoded Supabase anon key in frontend HTML, and several business domains (telephony ingestion, invoice pipeline, Twilio/ElevenLabs integration) are **not verifiable from repo**.

---

## B. Full system architecture documentation

### 1) Repository structure

#### Major folders/files
- `admin-panel/` – Admin SPA-like HTML app (`index.html`, `login.html`), Netlify functions, deploy config.
- `customer-dashboard/` – Customer dashboard SPA-like HTML app (`index.html`, `activate.html`), deploy config.
- `supabase/sql/` – SQL migrations/functions for user provisioning, subscription/contracts, auth-user deletion helper.
- Root contains additional audit/plan Markdown files and two standalone JS snippet files (`activate-subscription.js`, `delete-customer.js`) that are not wired to Netlify runtime.

#### Admin portal files
- UI: `admin-panel/index.html` (single-file app with CSS+JS, route sections and local state model).
- Auth screen: `admin-panel/login.html` (Supabase auth + admin table check).
- Backend: `admin-panel/netlify/functions/*.js` (`create-customer`, `activate-subscription`, `send-welcome`, `delete-customer`).
- Deploy config: `admin-panel/netlify.toml`, `admin-panel/_redirects`.

#### Customer dashboard files
- Main app: `customer-dashboard/index.html` (single-file app with login, setup wizard, call handling, settings).
- Activation page: `customer-dashboard/activate.html` (password set via recovery session).
- Deploy config: `customer-dashboard/netlify.toml`, `customer-dashboard/_redirects`.

#### Backend / serverless functions
- Only verifiable backend runtime code is in `admin-panel/netlify/functions`.
- No separate API server, no Express/Fastify app, no queue worker code present.

#### Config files
- Netlify config in both apps (`netlify.toml`) and redirect rules (`_redirects`).
- Supabase URL/anon key are hardcoded in frontend HTML (admin login/index, dashboard index/activate).

### 2) Frontend architecture

#### Admin panel structure
- Single HTML file with section-based internal navigation using hash routes (`overview`, `customers`, `onboarding`, `ai-setup`, `cases`, `activity`, `insights`, `settings`).
- Route rendering toggles section visibility and updates page metadata.
- Data source is mostly in-memory `state` object initialized with demo/mock customers/calls/cases/etc.
- One real backend write flow exists: create customer modal submits to `/.netlify/functions/create-customer`; response is merged into local state.
- Auth: sidebar user can hydrate from Supabase session if available, but code explicitly allows “preview mode” without active session.

#### Customer dashboard structure
- Single HTML file with login screen and tabbed app content.
- Uses Supabase client with persisted session (`localStorage` key `voxera-auth`) and URL session detection.
- Resolves customer context by chain: auth user → `users.customer_id` (fallback URL param) → `customers` record → load `calls` for that customer.
- Includes setup wizard, callback/call list management, follow-up editing, note editing, notification preference updates, and account/settings display.

#### Routing approach
- Admin: hash-based section routing in same page (`#overview`, etc.).
- Customer dashboard: UI tab switching within single page; login/app mode switching by DOM visibility.
- Activation route is separate static page (`/activate` mapped to `activate.html`).

#### State handling
- Admin: central mutable JS object (`state`) + manual render functions (no framework/store library).
- Dashboard: module-level mutable variables (`allRecords`, `customerMeta`, `customerContext`, etc.) + direct DOM rendering.
- Both are imperative render/update architectures (framework-free).

#### Key UI flows (verifiable)
- Admin login + admin-role gate via `admins` table.
- Admin create customer modal → Netlify function call.
- Dashboard login/logout, password reset, recovery flow.
- Dashboard call lifecycle updates (`dashboard_status`, notes, follow-up fields).
- Dashboard notification mode persisted to `customers.notification_mode`.

### 3) Backend architecture

#### Netlify function entry points
- `create-customer`: validates payload, inserts `customers`, inserts `onboarding`, best-effort rollback delete if onboarding insert fails.
- `activate-subscription`: requires customer in `pending`, upserts `subscriptions`, updates `customers` to `active`, calls `send-welcome`.
- `send-welcome`: fetches `customers`, creates Supabase recovery link (`auth.admin.generateLink`), sends Make webhook, updates `customers.welcome_sent*` fields.
- `delete-customer`: hard-delete sequence across `contracts`, `subscriptions`, `calls`, `users`, `customers`, then Supabase Auth user.

#### Supabase access model
- Frontend-direct (anon key):
  - Admin login (`admins` table read + auth methods).
  - Dashboard core app (`users`, `customers`, `calls`, RPC `ensure_user_profile`, auth methods).
- Function-based (service role key):
  - Customer creation, activation/subscription handling, welcome webhook dispatch, hard deletion.

#### Frontend-direct vs function-based split
- Dashboard business operations are largely direct table updates from browser.
- Admin operational data display is currently local mock data, with only partial backend write integration (`create-customer`); no live read sync for calls/cases/onboarding in admin UI is verifiable.

---

## C. Data model documentation (repo-observable)

## Tables directly referenced in code
- `admins` (admin login authorization check).
- `users` (customer mapping by auth user ID; hard delete cleanup).
- `customers` (core customer metadata, status, notification mode, subscription link).
- `calls` (dashboard call records/read-update; delete in hard delete function).
- `onboarding` (created on customer creation function).
- `subscriptions` (activation upsert + link from customer).
- `contracts` (hard delete cleanup).

## Fields read/written in implementation

### `customers`
- **Reads:** `id`, `status`, `email`, `customer_name`, `plan`, `voxera_number`, `dashboard_id`, `start_date`, `forwarding_setup_completed`, plus any fields returned by `select('*')` in dashboard context resolution.
- **Writes (functions):** `id`, `customer_name`, `plan`, `voxera_number`, `dashboard_id`, `tel_nr`, `email`, `invite_status`, `welcome_sent`, `forwarding_setup_completed`, `status`, `start_date`, `created_at`, `updated_at`, address/contact fields, `notes`, `subscription_id`, `activated_at`, `welcome_sent_at`.
- **Writes (dashboard frontend):** `notification_mode` (and potentially other settings updates via `patchCustomerRecord`).

### `calls`
- **Reads:** full row via `select('*')` then UI uses fields like `customer_id`, `created_at`, `created_date_raw`, `caller_name`, `company_name`, `phone_number`, `caller_phone`, `call_summary`, `callback_requested`, `dashboard_status`, `follow_up_at`, `next_action`, `lead_quality`, `notes_customer_voxera`.
- **Writes:** `dashboard_status`, `follow_up_at`, `next_action`, `notes_customer_voxera` (and generic patch fields via `patchCallRecord`).

### `users`
- **Reads:** `id`, `customer_id` by auth user ID.
- **Writes:** via SQL RPC/trigger (`ensure_user_profile`, `handle_auth_user_created`) and delete-customer function.

### `onboarding`
- **Writes in function:** `id`, `customer_id`, `status`, `progress`, `next_step`, `blocker`, `owner`, timestamps.
- **No frontend reads/writes to DB onboarding table verifiable in current admin UI file.

### `subscriptions`
- **Writes:** `customer_id`, `plan`, `billing_cycle`, `start_date`, `status`, `updated_at` (upsert).
- **Reads:** subscription `id` returned and written into `customers.subscription_id`.

### `contracts`
- **Deletes only** in `delete-customer` function.

## Schema/implementation mismatches
- `customer-dashboard/readme.md` mentions `call_logs`, while runtime code uses table `calls` (`CALLS_TABLE = 'calls'`).
- `activate-subscription` requires customers in status `pending`, while `create-customer` currently inserts status `onboarding`; this can block activation unless another process changes status.
- `admin-panel/index.html` contains duplicated `admins`, `featureFlags`, and `aiGlobal/aiConfigs/aiChanges` blocks in initial state object (potential overwrite/maintenance risk).

## Implied relationships (from SQL + code)
- `users.id` ↔ `auth.users.id` (via provisioning trigger and RPC).
- `users.customer_id` → `customers.id` (resolved in dashboard context).
- `calls.customer_id` → `customers.id` (query filter in dashboard, delete in backend).
- `subscriptions.customer_id` → `customers.id` (unique, one-per-customer in current migration).
- `customers.subscription_id` → `subscriptions.id`.
- `contracts.customer_id` → `customers.id`; `contracts.subscription_id` → `subscriptions.id`.

---

## D. Flow-by-flow documentation

### 1) Customer creation
1. Admin UI collects required fields in modal.
2. Frontend POSTs to `/.netlify/functions/create-customer`.
3. Function validates required fields.
4. Function inserts `customers` row.
5. Function inserts `onboarding` row.
6. On onboarding failure: best-effort rollback of customer row (non-transactional).
7. Frontend inserts returned customer/onboarding into local in-memory state for display.

### 2) Onboarding
- DB onboarding row is created in backend function.
- Admin onboarding board in `admin-panel/index.html` is computed from local `state.customers` and local checklist logic, not from DB onboarding queries.
- Therefore full production onboarding data sync in admin UI is **not verifiable from repo**.

### 3) Send access / activation
- `activate-subscription` function is backend entrypoint for activation.
- Preconditions: customer exists and has status `pending`.
- It upserts `subscriptions` as `active`, updates customer to `active`, sets `activated_at`, and triggers `send-welcome`.
- `send-welcome` generates Supabase recovery link and posts payload to Make webhook.
- `customer-dashboard/activate.html` consumes recovery session and sets password via `sb.auth.updateUser`.

### 3a) Forwarding activation – state machine

The forwarding activation state is tracked via customer record fields:

| Field | Type | Description |
|---|---|---|
| `forwarding_status` | string | Always one of: `not_started`, `pending_test`, `active`, `inactive` |
| `activation_started_at` | ISO-8601 timestamp | Set when `pending_test` begins |
| `activation_confirmation_mode` | string \| null | `null` (not started), `'test'` (explicit test call), `'live'` (auto on first real call) |
| `forwarding_setup_completed` | boolean | True once setup has been completed at least once |
| `last_confirmed_setup_device_type` | string \| null | Device type at last confirmed activation |
| `last_confirmed_forwarding_mode` | string \| null | Forwarding mode at last confirmed activation |

**Activation flows:**

1. **Standard test flow** (`activation_confirmation_mode = 'test'`):
   - Triggered by "Jetzt aktivieren" (smartphone) or "Testanruf starten" (landline).
   - Sets `forwarding_status = 'pending_test'`, `activation_confirmation_mode = 'test'`, `activation_started_at = now()`.
   - First matching call after `activation_started_at` is surfaced as `candidateCall`; user manually confirms.
   - On confirmation: `forwarding_status = 'active'`, `forwarding_setup_completed = true`, `last_confirmed_*` fields set.

2. **Skip flow** (`canSkipActivationTest`):
   - Available only when current config matches last confirmed config.
   - Sets `forwarding_status = 'active'` directly (no `pending_test` phase).

3. **"Ohne Test starten" / live-confirmation flow** (`activation_confirmation_mode = 'live'`):
   - Available when `forwarding_setup_completed === true` and `forwarding_status !== 'active'`.
   - Does NOT require `canSkipActivationTest`.
   - Sets `forwarding_status = 'pending_test'`, `activation_confirmation_mode = 'live'`, `activation_started_at = now()`.
   - First matching call after `activation_started_at` **auto-activates** without user interaction:
     `forwarding_status = 'active'`, `forwarding_setup_completed = true`, `last_confirmed_*` set.
   - User can switch to explicit test mode via "Jetzt doch testen" (sets `activation_confirmation_mode = 'test'`).

**Reset logic:**
- If `setup_device_type` or `forwarding_mode` changes while `forwarding_status === 'pending_test'`:
  - `forwarding_status` → `not_started`, `activation_started_at` → `null`, `activation_confirmation_mode` → `null`.
  - `candidateCall` cleared, polling stopped.

**Validation (backend `customer-update-settings.js`):**
- `activation_confirmation_mode`: `null | 'test' | 'live'` (null accepted to reset field).

### 4) Calls ingestion
- Dashboard reads calls from `calls` table filtered by `customer_id`.
- Comments indicate webhook-origin timestamp in `created_date_raw`, but actual ingest endpoint/webhook handler for call creation is **not verifiable from repo**.

### 5) Callback / follow-up handling
- Dashboard computes callback/open status from `callback_requested` + `dashboard_status`.
- Follow-up modal updates `notes_customer_voxera`, `next_action`, `follow_up_at`, optionally `dashboard_status`; closes clear `follow_up_at`.
- All persisted via direct `calls` table update from frontend.

### 6) Case handling
- Admin has case UI/tables/actions, but these operate on local `state.cases` only.
- No backend persistence for cases is verifiable.
- Therefore case handling is currently UI-local simulation (for admin app).

### 7) Invoice creation / billing
- Dashboard has computed plan/minutes/usage UI logic.
- Upgrade/add-on actions use `mailto:` links.
- No backend invoice object creation, billing ledger, payment provider integration, or subscription amendment workflow is verifiable in code.

---

## E. Repo-verified facts vs non-verifiable external dependencies

## Twilio
- **Verifiable from repo:** no direct Twilio SDK/API usage found in runtime code.
- **Missing / not verifiable:** telephony ingestion path and whether Twilio is upstream source.
- **Classification:** external dependency / assumption required.

## ElevenLabs
- **Verifiable from repo:** no ElevenLabs SDK/API usage found.
- **Missing / not verifiable:** any TTS/voice agent runtime integration.
- **Classification:** not verifiable from repo.

## Make / webhooks
- **Verifiable from repo:** `send-welcome` posts to Make webhook URL (`MAKE_WELCOME_WEBHOOK` env with hardcoded fallback) and includes activation payload.
- **Missing / not verifiable:** Make scenario internals, retries, mail provider routing, error workflows.
- **Classification:** external dependency.

## SMTP / mail provider
- **Verifiable from repo:** `nodemailer` dependency exists in `admin-panel/package.json` but no function currently imports or uses it.
- **Verifiable from repo:** outbound welcome path uses Make webhook, not direct SMTP in runtime code.
- **Missing / not verifiable:** actual SMTP credentials/provider and final email dispatch chain.
- **Classification:** external dependency / not verifiable from repo.

## Netlify deployment behavior
- **Verifiable from repo:** admin app defines functions directory; both apps define security headers and SPA-style redirects; customer dashboard has global redirect to `/index.html`; activation route mapped in `_redirects`.
- **Missing / not verifiable:** actual Netlify site-level env vars, branch deploy settings, preview/prod separation.
- **Classification:** partially verifiable; runtime environment external.

---

## F. Risks / gaps and recommended missing information

## Technical risks / gaps (repo-observable)
1. **Admin UI data realism gap:** most admin operational features run from local seeded arrays, not DB-backed reads.
2. **Activation status mismatch risk:** `create-customer` uses `status='onboarding'`, activation requires `pending`.
3. **Non-transactional backend sequences:** create-customer rollback is best-effort; delete-customer is multi-step hard delete without transaction boundary.
4. **Hardcoded public keys in frontend files:** Supabase anon key embedded in HTML.
5. **Config/doc mismatch:** README says `call_logs`; code uses `calls`.
6. **Duplicate state blocks in admin index:** repeated keys in same object increase accidental overwrite risk.
7. **No verifiable ingest worker/queue:** call ingestion resilience, retries, idempotency, and dead-letter handling not present.
8. **Billing flow incomplete for production:** mailto-based requests, no invoice/payout system in code.

## Missing information required for complete internal handbook
1. Supabase canonical schema export (tables, constraints, RLS policies, indexes) for all production tables.
2. Definitive call ingestion architecture (source system, webhook contracts, retry policy, idempotency keys).
3. External integration specs (Make scenario design, SMTP provider, any telephony/AI vendors).
4. Environment configuration matrix (Netlify env vars per environment).
5. Admin portal backend roadmap/status: which admin modules should be DB-backed vs mock.
6. Activation lifecycle state machine (allowed status transitions and ownership).
7. Billing domain model and source-of-truth for subscriptions/contracts/invoices.
8. Operational runbooks for user/customer deletion and data retention/compliance.

---

## Appendix: Files inspected (primary implementation evidence)
- `admin-panel/index.html`
- `admin-panel/login.html`
- `customer-dashboard/index.html`
- `customer-dashboard/activate.html`
- `admin-panel/netlify/functions/create-customer.js`
- `admin-panel/netlify/functions/activate-subscription.js`
- `admin-panel/netlify/functions/send-welcome.js`
- `admin-panel/netlify/functions/delete-customer.js`
- `supabase/sql/2026-04-02_user_profile_provisioning.sql`
- `supabase/sql/2026-04-03_add_subscriptions_and_contracts.sql`
- `supabase/sql/2026-04-03_delete_auth_user_data.sql`
- `admin-panel/netlify.toml`, `admin-panel/_redirects`
- `customer-dashboard/netlify.toml`, `customer-dashboard/_redirects`
- `customer-dashboard/readme.md`
- `admin-panel/package.json`
