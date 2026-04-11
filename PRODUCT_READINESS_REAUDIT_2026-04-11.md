# Voxera V1 Product Readiness Re-Audit (Current Repo State)
**Date:** 2026-04-11  
**Branch basis:** current working branch at audit time (repository state re-reviewed from code + SQL migrations in-repo only)

---

## 1) Executive summary

### Current overall verdict
**Verdict:** **Conditionally launchable for a very small controlled pilot, not yet safe for broader paid rollout.**

- **Controlled pilot (1–5 customers):** **GO (conditional)**, with operational guardrails and daily manual monitoring.
- **Pilot (5–10 customers):** **GO with caution**, only after fixing/mitigating P0 items below.
- **Broader paid launch:** **NO-GO** until P0 blockers are closed and at least one full billing cycle is proven end-to-end.

### Why
What is strong now (verified):
- Entitlement/payment gate exists in both DB policy layer and function layer for customer dashboard access.
- Setup fee and subscription operations are now explicit and callable from admin flows.
- Daily billing runner + outbox retry + dead-letter status are implemented.
- Invoice system V1 exists with invoice numbering, invoice + invoice_items schema, and admin/manual operations.
- Phone normalization is implemented in intake/runtime and one-time SQL cleanup.

What still prevents broader launch:
- State can drift across `customers.payment_status`, `subscriptions.payment_status/billing_state`, and `invoices.status`.
- Critical billing operations are not transactionally consistent (partial-write risk across related tables).
- Multiple operational controls are implied but not verifiable in repo (schedules, monitoring, alerting, replay tooling UX).
- RLS/policy coverage for new billing tables is not verifiable from migrations in this repo.

---

## 2) What was previously risky and is now resolved (verified in code)

1. **Centralized entitlement gate exists and is enforced at DB + app levels.**
   - DB function `is_customer_entitled()` and customer policies were tightened to require `payment_status='paid'` and allowed lifecycle statuses.
   - Customer dashboard Netlify functions also re-check entitlement (`require-customer` + `evaluateCustomerEntitlement`).

2. **Phone normalization was hardened.**
   - Runtime normalization helper (`normalizePhoneE164`) is used by intake + customer creation.
   - One-time SQL cleanup normalizes existing phone columns in `customers` and `calls`.

3. **Billing runner state model added.**
   - `subscriptions.payment_status`, `billing_state`, `next_reminder_at`, plus metadata fields like `last_billing_sent_at`/`last_paid_at`/`last_billing_link` were added.
   - Daily billing runner computes usage from `calls.duration_seconds` and sends payment-link webhooks with outbox persistence.

4. **Invoice system V1 implemented in schema and backend helpers.**
   - New tables: `invoices`, `invoice_items`, `invoice_sequences`.
   - `next_invoice_number_v1()` function generates deterministic invoice numbers.
   - Admin billing function can create setup/subscription invoices and mark invoice paid.

5. **Outbox reliability improved.**
   - `outbox_events` table + retry support + dead-letter timestamp + retry worker with exponential backoff.
   - Contract-signed flow now has dedupe key unique guard.

6. **Plan configuration consistency improved.**
   - Plan aliases normalized (`pro` -> `professional`, etc.).
   - `plan_label` support added and used in UI + invoice descriptions.
   - Setup/payment links are loaded from `plan_config` source-of-truth paths.

---

## 3) Remaining critical blockers (prioritized)

## P0 (must fix before broader paid launch)

1. **Cross-entity billing truth can drift (entitlement vs subscription vs invoice).**
   - Entitlement uses **customer-level** `customers.payment_status`.
   - Recurring billing operations update **subscription-level** fields and invoices, but not always customer-level truth in lockstep.
   - Example: `mark_subscription_paid` updates subscription + creates paid invoice, but does not clearly synchronize `customers.payment_status` to a recurring-billing-specific truth model.

2. **Non-transactional multi-write billing flows (partial state risk).**
   - Several operations perform multi-step writes across `customers`, `subscriptions`, `invoices`, `invoice_items` without DB transaction boundaries.
   - If step N succeeds and step N+1 fails, persistent partial state is possible (audit and entitlement impact).

3. **Replay/ops confidence is incomplete for launch scale.**
   - Outbox retry worker exists, but operator-friendly replay tooling and documented runbooks are not verifiable in repo.
   - Monitoring/alerts for failed/dead events are not verifiable.

4. **Security/RLS coverage for billing tables not verifiable in repo.**
   - Migrations show RLS for core tables and outbox, but no explicit RLS migration for `subscriptions`, `invoices`, `invoice_items`, `plan_config` found in repo SQL.
   - Could exist outside repo, but this audit cannot assume that.

## P1 (should be done shortly after pilot start)

1. **Idempotency for invoice creation and mark-paid workflows is incomplete.**
   - Duplicate admin clicks/webhook retries can create duplicate business actions unless external references are always enforced consistently at call sites.

2. **Call intake durability still depends on upstream retries; local durable queue is absent.**
   - Intake writes directly to DB via upsert and returns errors for malformed/unmapped payloads; no internal buffering/dead-letter at intake layer.

3. **Admin finance workflows are powerful but need stronger audit framing.**
   - Manual override actions exist, but explicit immutable audit trail table(s) for operator actions is not verifiable.

## P2 (later hardening)

1. **Consolidate status model duplication across frontend + function code paths.**
2. **Unify billing period/usage computation logic across UI and backend to avoid interpretation drift.**
3. **Expand deterministic reconciliation jobs (customer/subscription/invoice consistency checker).**

---

## 4) Risk area assessment

## A) Core product flows — **Medium risk**

### Implemented in repo (verified)
- Customer creation flow exists with auth user creation, customer row, subscription row, onboarding row, users mapping, and rollback attempt logic.
- Onboarding update flow exists with status transition checks.
- Customer dashboard access guard checks user mapping + payment/status gate.
- Call intake webhook implemented with number normalization and customer mapping by Voxera number.
- Call update/follow-up and customer settings APIs are present.

### Risk drivers
- Intake security secret is optional (`CALL_INTAKE_WEBHOOK_SECRET` only enforced if set).
- Intake/customer mapping can fail hard when number mismatches (422) and has no internal queue for delayed reconciliation.
- Some lifecycle transitions are spread across multiple handlers/triggers (possible orchestration drift under failures).

## B) Billing/subscription operations — **High risk**

### Implemented in repo (verified)
- Setup fee operations: send payment link, mark paid, manual setup invoice creation.
- Subscription operations: send monthly/yearly link, mark subscription paid, manual subscription invoice.
- Daily billing runner sends due payment links and computes overage from `calls.duration_seconds`.

### Risk drivers
- State updates are distributed and not atomically committed.
- Recurring payment confirmation paths can diverge from entitlement/customer payment truth.
- Manual and Stripe/invoice paths coexist but reconciliation logic is not centralized into one authoritative state machine.

## C) Payment gate / entitlement — **Medium risk**

### Implemented in repo (verified)
- Stronger than before: DB policies + function-level checks require `payment_status='paid'` and allowed customer statuses.

### Risk drivers
- Entitlement is anchored on `customers.payment_status`; recurring billing logic heavily uses `subscriptions` and invoices.
- Without strict reconciliation, subscription paid events could drift from customer entitlement flags.

## D) Data model integrity — **High risk**

### Implemented in repo (verified)
- Core checks/constraints for many status fields.
- New invoice tables + numbering + item checks.
- Plan normalization and metadata additions.

### Risk drivers
- Duplicated truth across customer/subscription/invoice layers.
- No repo-verified reconciliation migration/job that continuously enforces consistency.
- Legacy-schema fallbacks in runtime code imply mixed-schema tolerance (good for migration safety, but increases long-term drift risk if left permanent).

## E) Reliability / operations — **Medium-High risk**

### Implemented in repo (verified)
- Outbox pattern for webhook-dependent events.
- Retry worker with backoff and terminal dead state.

### Risk drivers
- No repo-verified alerting/monitoring pipeline for outbox dead/failure anomalies.
- Replay operations are possible programmatically but dedicated operator tooling/runbook is not verifiable.
- Billing runner scheduling/orchestration (cron ownership, SLA) is not verifiable in repo.

## F) Admin operability — **Medium risk**

### Implemented in repo (verified)
- Admin panel has billing/invoice actions and views.
- Backend validates admin caller role and exposes operational actions for support/finance.

### Risk drivers
- Invoice/invoice_items loading in admin UI is explicitly treated as non-critical and may fail quietly.
- Manual operations are available, but audit trail completeness for who-did-what/why is not clearly verifiable from persisted dedicated audit entities.

---

## 5) Safe now vs not safe yet

## Safe now (for controlled pilot)
- Create customer + onboarding scaffolding + customer dashboard entitlement checks.
- Phone normalization path for intake and persisted values.
- Basic call intake, call logging updates, and customer settings updates.
- Setup fee gating and manual billing operations by admin.
- Outbox-based webhook durability with retries/dead-letter state.

## Not safe yet (for broader paid rollout)
- Fully trusted autonomous recurring billing at scale without daily manual reconciliation.
- Assuming invoice/subscription/customer payment states never diverge.
- Assuming complete operational observability/alerting/replay readiness from repo evidence alone.
- Treating admin finance UI as fully reliable source without backend reconciliation checks.

---

## 6) Deliverables

## Primary files / areas reviewed

### SQL / schema / policy
- `supabase/sql/2026-04-08_core_tables_schema_sot.sql`
- `supabase/sql/2026-04-03_add_subscriptions_and_contracts.sql`
- `supabase/sql/2026-04-10_customer_billing_gate_v1.sql`
- `supabase/sql/2026-04-10_customer_dashboard_entitlement_gate.sql`
- `supabase/sql/2026-04-10_subscriptions_v1_admin_fields.sql`
- `supabase/sql/2026-04-10_subscription_billing_runner_state.sql`
- `supabase/sql/2026-04-10_plan_label_and_subscription_ops_metadata.sql`
- `supabase/sql/2026-04-10_plan_config_source_of_truth_unify_professional.sql`
- `supabase/sql/2026-04-10_phone_e164_normalization_cleanup.sql`
- `supabase/sql/2026-04-11_invoice_system_v1.sql`
- `supabase/sql/2026-04-07_webhook_outbox_events.sql`
- `supabase/sql/2026-04-07_outbox_retry_worker_support.sql`
- `supabase/sql/2026-04-07_outbox_events_access_hardening.sql`
- `supabase/sql/2026-04-07_contract_signed_idempotency.sql`
- `supabase/sql/2026-04-06_rls_access_hardening.sql`
- `supabase/sql/2026-04-07_admin_role_matrix_harmonization.sql`
- `supabase/sql/2026-04-10_auto_live_on_test_call_completed.sql`

### Backend functions (admin/customer)
- `admin-panel/netlify/functions/create-customer.js`
- `admin-panel/netlify/functions/activate-subscription.js`
- `admin-panel/netlify/functions/customer-billing-update.js`
- `admin-panel/netlify/functions/daily-billing-runner.js`
- `admin-panel/netlify/functions/call-intake-webhook.js`
- `admin-panel/netlify/functions/send-customer-access.js`
- `admin-panel/netlify/functions/onboarding-update.js`
- `admin-panel/netlify/functions/outbox-retry-worker.js`
- `admin-panel/netlify/functions/contract-signed.js`
- `admin-panel/netlify/functions/_lib/invoice-service.js`
- `admin-panel/netlify/functions/_lib/webhook-outbox.js`
- `admin-panel/netlify/functions/_lib/plan-config.js`
- `admin-panel/netlify/functions/_lib/phone-normalize.js`
- `admin-panel/netlify/functions/_lib/customer-entitlement.js`
- `customer-dashboard/netlify/functions/_lib/require-customer.js`
- `customer-dashboard/netlify/functions/_lib/customer-entitlement.js`
- `customer-dashboard/netlify/functions/customer-update-settings.js`
- `customer-dashboard/netlify/functions/call-update-status.js`
- `customer-dashboard/netlify/functions/call-save-followup.js`

### Frontend admin/customer surfaces
- `admin-panel/index.html`
- `customer-dashboard/index.html`

## Where uncertainty remains (explicit)

1. **Deployment/runtime configs not in repo**
   - Whether webhook secrets are set in all environments.
   - Whether scheduled jobs (billing runner/retry worker) are reliably configured.

2. **External integrations**
   - Make.com scenario reliability, retries, and idempotency outside this repo.
   - Stripe webhook/event ingestion paths beyond explicit repo code.

3. **Database state in production**
   - Existing historical data quality/drift.
   - Whether additional out-of-repo SQL migrations (e.g., extra RLS policies) are already applied.

4. **Monitoring/alerting stack**
   - No in-repo proof of alert thresholds, paging, dashboards, or incident runbooks.

## Assumptions explicitly NOT made

- **Not assumed** that old readiness reports are accurate.
- **Not assumed** that Stripe webhooks are functioning unless code path is in repo.
- **Not assumed** that infrastructure cron/scheduler exists unless defined in repo.
- **Not assumed** that missing SQL policies are applied elsewhere.
- **Not assumed** that UI-only derived indicators equal source-of-truth billing state.

---

## Launch recommendation matrix

| Stage | Decision | Conditions |
|---|---|---|
| Controlled pilot (1–5) | **GO (conditional)** | Daily manual finance reconciliation; monitor outbox failed/dead events; manual runbook for billing exceptions. |
| Pilot (5–10) | **GO with caution** | Close P0 drift + atomicity gaps first; prove one full renewal cycle with invoices + entitlement alignment. |
| Broader paid rollout | **NO-GO (yet)** | Resolve P0 items and validate stable recurring billing/entitlement consistency + ops observability. |

