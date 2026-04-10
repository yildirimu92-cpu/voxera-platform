# Voxera V1 Product Readiness Report (Launch Audit)
Date: 2026-04-10
Scope: Supabase backend, Netlify functions, Make webhooks, customer dashboard, admin panel

## Executive Summary
Voxera has a solid V1 operational foundation for SME onboarding in Switzerland: customer onboarding + auth provisioning, call intake with idempotent upsert by external `call_id`, admin-triggered setup-fee flow, and an outbox retry worker for webhook resilience are all implemented.

However, launch readiness for paying customers is currently **conditional**. The biggest launch risk is inconsistent payment gating: payment checks exist for sending access and activation actions, but dashboard access itself is still controlled by lifecycle status only, not payment status. In addition, phone-number matching in call intake relies on exact string equality without normalization, which can cause silent business-impacting call-routing mismatches. Subscription lifecycle is also still V1-manual (no recurring billing automation), so finance operations require strict SOPs and monitoring.

Recommendation: proceed to a **controlled V1 launch** only after closing the blocker list below.

## Critical Launch Blockers (Top 5)
1. **No hard payment gate at dashboard/session level**
   - Access guard allows statuses (`onboarding`, `ready`, `invited`, `activated`, `live`) without evaluating `payment_status`.
   - Consequence: status drift/mis-click in admin can still expose product before payment.

2. **Call intake customer matching depends on raw phone string equality**
   - Webhook lookup uses `.eq('voxera_number', incomingNumber)` without normalization/canonicalization.
   - Consequence: mismatched formatting (`+41...` vs `0041...` vs spaces) can reject or misroute calls.

3. **Recurring billing/subscription collection is not implemented operationally**
   - Subscription records exist, but no billing provider integration, invoice generation, dunning, renewal charging, or suspension automation.
   - Consequence: revenue leakage and manual finance load after first month.

4. **Activation flow can become operationally inconsistent across multiple state writers**
   - Customer status can be promoted by different paths (manual status updates, send-access mark_activated, activate-subscription, onboarding update, DB trigger after first call).
   - Consequence: race conditions and hard-to-debug lifecycle drift.

5. **Webhook reliability is strong for outbox-backed flows, but call intake has no queued fallback**
   - `call-intake-webhook` returns 4xx/5xx directly and writes synchronously only.
   - Consequence: transient Supabase/network failures can still drop calls if sender does not retry safely.

---

## 1) Core Product Flows

### Strengths
- Call intake validates method, auth secret, required call identifiers, and customer existence before write.
- Idempotent persistence is implemented via `upsert(... onConflict: 'call_id')`.
- Customer dashboard enforces tenant context from `users.customer_id` and function-level auth for mutations.
- Callback/follow-up status transitions are validated server-side in function logic.
- Activation UX exists end-to-end: invite send, activation password flow, status progression, and onboarding linkage.

### Critical Risks
- Customer lookup for call intake is exact-match on number string; no normalization.
- Flow has many independent status mutation points (`onboarding-update`, `customer-status-update`, `send-customer-access`, `activate-subscription`, trigger), increasing drift risk.
- `onboarding-update` may auto-promote customer to `live` on READY->COMPLETED even outside intended finance controls.

### Launch Blockers
- Phone normalization gap for webhook intake (blocker).
- Multi-writer lifecycle transitions without a single orchestrated state machine (blocker).

### Minimal V1 Improvements
- Add shared phone-normalization util and store canonical E.164 for all routing keys.
- Add a single server-side transition function (RPC or Netlify function) as source of truth for lifecycle changes.
- Add immutable audit log per status transition (`who`, `from`, `to`, `reason`, `source`).

---

## 2) Billing System (V1)

### Strengths
- `payment_status` domain constrained to `none/pending/paid`.
- Admin function supports explicit actions `send_payment_link` and `mark_paid`.
- Access/invite flow correctly blocks send_access and mark_activated when payment is not `paid`.
- Plan-config-driven setup fee link + amount supports operational control without redeploy.

### Critical Risks
- No payment-provider callback reconciliation; `mark_paid` is manual and trust-based.
- No guardrail for accidental `mark_paid` clicks (no double-confirm, no evidence attachment).
- Dashboard access gate is status-based, not payment-based.
- Monthly/yearly subscriptions are metadata-level only (no automated charge lifecycle).

### Launch Blockers
- Missing hard payment gate beyond invite operations (blocker).
- Missing recurring billing operations for subscription lifecycle (blocker for scale; acceptable only for tightly managed pilot).

### Minimal V1 Improvements
- Add DB-level invariant for access entitlement: e.g., `can_access_dashboard = payment_status='paid' AND status IN (...)` via view/RPC/policy.
- Add `paid_by`, `paid_source`, `paid_reference`, `paid_note` fields to make manual payment action auditable.
- Introduce a “manual monthly billing board” (due date, renewal date, owner, last contact) as interim control until provider integration.

---

## 3) Data Model Integrity

### Strengths
- `calls.customer_id` has FK to `customers.id` and `NOT NULL`.
- `calls.call_id` has unique index (nullable-safe) and webhook uses conflict on `call_id` for idempotency.
- Users-to-customer mapping (`users.customer_id`) is enforced in dashboard function auth.

### Critical Risks
- `calls.id` is payload-driven fallback (`payload.id/record_id/external_call_id/random`) and may vary by source; operational debugging can become inconsistent.
- Multiple nullable optional fields in `calls` increase downstream analytics ambiguity if not normalized.
- No canonical normalized columns for telephony identifiers (`voxera_number_normalized`, `caller_phone_normalized`, etc.).

### Launch Blockers
- Lack of canonical phone normalization for matching/business routing (blocker).

### Minimal V1 Improvements
- Add normalized phone columns + migration backfill + unique index on normalized Voxera number.
- Add DB check or trigger enforcing `call_id IS NOT NULL` for production intake path.
- Define a call ingestion contract document (required fields, enum domains, fallback behavior).

---

## 4) Admin Panel Capabilities

### Strengths
- Admin can create customer, manage onboarding, send/reset access links, trigger payment link, mark paid, archive/delete customer.
- Billing/finance dashboard surfaces payment state and access readiness blockers.
- Outbox-backed access email flows reduce one-off delivery loss.

### Critical Risks
- Admin still needs process discipline for recurring subscription operations (not system-enforced).
- No native action to “replay call intake payload” or repair call-customer mapping from UI.
- No explicit “payment reversal/refund” or “undo mark_paid” workflow.

### Launch Blockers
- Lack of complete billing control loop for subscription renewals (blocker for broader paid rollout).

### Minimal V1 Improvements
- Add admin actions: `mark_unpaid`, `set_pending`, `add_payment_proof_note`, `retry_webhook_outbox_event` per customer.
- Add operator dashboard card: “Customers live but unpaid” and “customers invited but unpaid” anomalies.
- Add one-click “resend failed outbox events for customer” filter.

---

## 5) System Reliability

### Strengths
- Structured error responses in functions; explicit method checks and env checks.
- Outbox pattern implemented with retry worker, exponential backoff, and dead-letter state.
- Duplicate suppression via dedupe keys for contract notifications and invite claims.
- Retry worker is scheduled every 5 minutes in Netlify.

### Critical Risks
- Call intake is synchronous-only: no outbox/queue for primary revenue event (calls).
- Some non-fatal failures are only logged (e.g., activation email from `activate-subscription`) and can hide customer-facing delivery issues unless monitored.
- Observability appears log-based; no explicit alert thresholds/SLO reporting in codebase.

### Launch Blockers
- No guaranteed-delivery fallback for call intake if upstream retries are not guaranteed (blocker).

### Minimal V1 Improvements
- Add intake dead-letter table for failed webhook payloads with replay endpoint.
- Define mandatory alert rules: failed intake rate, outbox dead count, invite_sending stale count.
- Add correlation IDs (`customer_id`, `call_id`, `outbox_id`) to every operational log path consistently.

---

## Risk Areas (Prioritized)
1. Payment entitlement consistency (status vs payment gate).
2. Telephony number normalization and deterministic routing.
3. Subscription renewals/manual finance load.
4. Multi-writer lifecycle state drift.
5. Intake durability under transient failures.

## Recommended Fixes (Prioritized, V1-focused)

### P0 (must do before broader paid launch)
- Enforce payment gating centrally (DB/view/RPC/policy) so UI/admin mistakes cannot bypass it.
- Normalize phone numbers at ingestion + customer master data; route only on canonical format.
- Implement failed call-intake persistence + replay path.

### P1 (do in first 1–2 weeks post-launch)
- Add auditable manual payment metadata and reversal workflow.
- Add lifecycle transition audit table and reduce multi-writer drift.
- Add alerting for outbox dead letters, invite sending stale states, and webhook failure ratios.

### P2 (next phase)
- Integrate subscription billing automation (provider webhooks, reconciliation, dunning, suspension).
- Add operations dashboard for finance anomalies and customer lifecycle inconsistencies.

---

## What is SAFE to launch vs NOT SAFE

### SAFE to launch (controlled V1 / pilot cohort)
- Admin-created customer onboarding.
- Setup-fee collection as manual process (small volume only).
- Dashboard call handling/status updates for onboarded paid customers.
- Outbox-backed email/webhook notifications with retry worker.

### NOT SAFE to launch broadly (without fixes)
- Large-scale paying-customer launch without recurring billing automation.
- Trusting raw phone-number matching in production telephony routing.
- Relying on lifecycle status alone for entitlement without centralized payment gate.
- Operating without intake dead-letter + replay for webhook failures.

## Final Verdict
Voxera is **close to V1 operational readiness for a controlled paid pilot**, but **not yet safe for broad commercial scale-up**. Close P0 blockers first; then launch with strict operational SOPs and monitoring.
