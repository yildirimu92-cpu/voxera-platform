# Voxera Product Readiness RE-AUDIT / DELTA-AUDIT
Date: 2026-04-11
Scope reviewed: Supabase SQL migrations, Netlify functions (admin + customer), customer dashboard, admin panel, billing/subscription/usage/call-intake/access flows.
Baseline for delta comparison: `PRODUCT_READINESS_REPORT_V1_2026-04-10.md`.

## 1) Executive Summary
Voxera has closed multiple previously critical gaps since the prior report (hard entitlement gate, E.164 normalization in core paths, subscription/billing operations baseline, outbox retry/dead-letter for webhook deliveries). The platform is now materially safer for a controlled paid pilot.

**Go / No-Go**
- **Safe for controlled pilot?** **Yes (with constraints).**
- **Safe for broader paid launch?** **Not yet.**
- **Hard blockers still present?** **Yes, mainly in call-intake durability + billing entitlement consistency at renewal scale.**

Operationally, the system is now usable for low customer counts with disciplined admin ops. It is not yet robust enough for larger paid rollout where webhook/intake loss and renewal-state drift can become revenue or service incidents.

## 2) What was previously flagged and is now resolved

### A) Missing hard payment gate — **resolved (core gap closed)**
- Customer entitlement is now centralized (`evaluateCustomerEntitlement`) and requires `payment_status='paid'` + allowed lifecycle states.
- Customer dashboard function auth (`require-customer`) enforces entitlement before data mutations.
- DB-level/RLS gate was added via `public.is_customer_entitled(...)` and applied to `customers`, `calls`, `onboarding`, `cases` self-access policies.

**Delta verdict:** previously major blocker is now closed at both function layer and data-access policy layer.

### B) Missing phone-number normalization — **mostly resolved**
- Shared E.164-like normalizer exists (`normalizePhoneE164`) and is used in call intake.
- `call-intake-webhook` normalizes incoming number, called number, and voxera number before matching/persisting.
- Create-customer flow validates/normalizes numbers and stores normalized `voxera_number`.
- One-time SQL cleanup migration normalized existing phone values.

**Delta verdict:** routing mismatch risk is strongly reduced and no longer a hard blocker for pilot.

### C) Missing recurring billing/subscription automation — **partially resolved**
- Subscriptions now carry lifecycle and runner state fields (`subscription_status`, `renews_at`, `payment_status`, `billing_state`, etc.).
- Daily billing runner exists and is scheduled in Netlify; it selects due subscriptions, computes usage from `calls.duration_seconds`, sends billing webhooks via outbox, and updates renewal/payment state.
- Admin billing operations now include monthly/yearly payment-link send and subscription payment mark actions.

**Delta verdict:** major progress; still partial because charge settlement/reconciliation remains semi-manual.

### D) Outbox/retry reliability concerns — **resolved for webhook-delivery paths, not for intake ingestion**
- Outbox table + retry worker + backoff + terminal `dead` state is implemented and scheduled.
- Contract/welcome/billing webhooks run through outbox utilities.

**Delta verdict:** webhook delivery durability improved significantly. However this does not cover primary intake ingestion failures (see blockers).

### E) Lifecycle/status drift risk — **partially resolved**
- Shared status model with normalized statuses and legal transition assertions was introduced.
- Several writers now enforce transition constraints.
- Auto-live trigger is constrained to a narrow guarded condition (`activated` + onboarding `ready`).

**Delta verdict:** drift risk reduced, but not eliminated due to multiple state writers and parallel status systems (customer + subscription + payment).

## 3) Remaining critical blockers (prioritized)

### 1. No durable intake DLQ/replay for failed call ingestion (**P0 blocker for broader paid launch**)
`call-intake-webhook` writes synchronously and returns 4xx/5xx on lookup/insert failures; there is no intake-failure persistence table or replay worker.

**Business impact:** missed calls can become unrecoverable revenue events when upstream retries are absent/insufficient.

### 2. Entitlement at renewal can drift vs subscription reality (**P0 for scale, partial blocker for pilot >5 customers**)
Dashboard entitlement is tied to `customers.payment_status`. Daily billing runner sets it to `pending` when a renewal link is sent, and subscription payment lifecycle is tracked separately in `subscriptions`.

**Business impact:** access can be blocked/unblocked based on coarse customer flag rather than explicit active-subscription validity, creating avoidable churn/support load during renewals.

### 3. No automated payment reconciliation/webhook settlement loop (**P0 for broader paid launch**)
Billing sends links and marks pending, but paid-state closure is still admin/manual (`mark_subscription_paid`), with no provider callback reconciliation in repo.

**Business impact:** revenue leakage + manual ops bottlenecks increase quickly with customer volume.

## 4) Risk areas assessment

### Core product flows: **Medium risk (pilot-usable)**
- Strength: guarded customer access checks, transition enforcement, idempotent call upsert by `call_id`.
- Risk: intake still single-path synchronous (no durable fallback).

### Billing / subscription operations: **Medium-High risk**
- Strength: daily runner, usage computation from `duration_seconds`, monthly/yearly links, subscription metadata (`renews_at`, `last_paid_at`, etc.).
- Risk: paid confirmation remains manual; no automatic reconciliation.

### Payment gate / entitlement: **Medium risk**
- Strength: centralized entitlement + RLS + function-level checks.
- Risk: customer-level payment flag as primary gate can diverge from subscription-level truth over time.

### Data model integrity: **Medium risk**
- Strength: constrained payment/subscription domains, plan config normalization, plan label support.
- Risk: parallel state fields across `customers` and `subscriptions` require strict consistency controls.

### Call intake reliability: **High risk (remaining hard gap)**
- Strength: number normalization + customer mapping fallback + upsert idempotency.
- Risk: no intake dead-letter / replay path.

### Lifecycle consistency: **Medium risk**
- Strength: transition assertions + guarded auto-live trigger.
- Risk: multiple writers still mutate lifecycle states.

### Admin operability: **Medium-Low risk for pilot**
- Strength: admin billing actions, billing-finance UI, plan label editing, outbox retry automation.
- Risk: operational correctness depends on SOP discipline for payment settlement.

## 5) Recommended fixes (prioritized)

### P0 (before broader paid launch)
1. **Implement intake durability**: persist failed intake payloads (`intake_dead_letters`) + replay endpoint/worker with idempotent re-insert by `call_id`.
2. **Introduce subscription-aware entitlement**: gate productive access on explicit subscription validity (active + paid or grace window), not only coarse `customers.payment_status`.
3. **Automate payment reconciliation**: provider webhook -> verify payment -> atomically update `subscriptions` + `customers` + audit trail.

### P1 (shortly after pilot start)
1. Add anomaly monitors: “live but unpaid”, “renewal due but still paid flag”, intake error-rate alarms.
2. Add immutable billing audit fields/events for manual overrides (`who`, `when`, `source`, `reference`).
3. Add operator replay UI for failed intake/outbox items.

### P2 (next expansion)
1. Separate setup-fee lifecycle from recurring subscription state in a clearer entitlement model.
2. Add dunning/reminder cadence with escalation rules.
3. Add finance dashboards for aging unpaid renewals and cohort-level revenue-risk indicators.

## 6) SAFE vs NOT SAFE

### Safe now
- **Controlled pilot (1–5 pilot customers):** yes, with explicit manual billing SOP and daily ops checks.
- **Pilot (5–10 customers):** possible but only with strict monitoring + on-call ownership for intake/billing incidents.

### Not safe yet
- **Broad paid rollout:** not safe yet due to missing intake durability and incomplete renewal settlement automation/entitlement coupling.

## 7) Deliverables

### Primarily reviewed files/areas
- SQL migrations around entitlement, phone normalization, billing/subscriptions, plan config, outbox.
- Admin functions: call intake, billing update, daily billing runner, outbox retry worker, send-customer-access, activate-subscription.
- Customer functions: require-customer gate + call mutation/settings endpoints.
- Admin/customer frontend surfaces for billing/usage/plan label operations.

### Where uncertainty remains
- No external payment provider webhook implementation found in this repo scope; if implemented elsewhere (outside repo), this audit cannot validate it.
- Runtime infra observability/alerts (outside code) cannot be validated from repository-only evidence.

### Assumptions explicitly NOT made
- No assumption that upstream webhook sender always retries failed intake deliveries.
- No assumption that manual admin actions are always executed on time.
- No assumption that external automation (Make/Zapier/etc.) guarantees reconciliation without explicit in-repo proof.
