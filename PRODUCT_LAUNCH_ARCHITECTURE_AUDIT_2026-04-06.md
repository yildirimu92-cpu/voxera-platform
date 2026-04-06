# Voxera Launch-Readiness Audit (Execution Version)

## 1. EXECUTIVE VERDICT
**Is Voxera ready for SaaS launch?** **NO**

**Top 5 launch blockers:**
1. Privileged backend operations can be called without strict server-side admin authorization gates.
2. Billing/commercial backbone is not a real system (upgrade/add-on flows still behave like requests, not transactions).
3. Contract handling is not operationally trustworthy (local/browser persistence patterns still exist in core flow assumptions).
4. Lifecycle/state model is fragmented across dashboard/admin/backend (status chaos = operational chaos).
5. Ticket/case/callback operations are not modeled as a robust SLA-driven operations system.

---

## 2. PRODUCT MATURITY SCORE (0–100)

### Product Logic — **47/100**
Core ideas are good, but too many “partially implemented” domains (cases/contracts/billing) are presented like finished product.

### UX & Clarity — **62/100**
UI quality is decent and modern, but workflows are not always action-safe, role-safe, or state-transparent.

### Technical Robustness — **43/100**
Foundational stack is fine, but control-plane reliability/security/governance is not launch-grade for paid B2B operations.

### Admin/Operational Readiness — **39/100**
Admin is not yet a true command center. It is still part operator tool, part prototype surface.

### Billing & Commercial Logic — **31/100**
Commercial lifecycle is weak: missing invoice engine discipline, weak amendment/audit logic, non-systemic upgrade paths.

### Scalability (100–200 customers) — **44/100**
Will work for a small pilot, but data/process consistency and operator throughput will degrade quickly.

### Go-To-Market Readiness — **36/100**
Premium/trustworthy positioning is not supported yet by the operational rigor customers expect.

---

## 3. CRITICAL ISSUES (20)

### 1) Privileged function security gap
- **Area:** Tech / Ops
- **Where:** Netlify functions handling customer creation, activation, deletion, welcome dispatch
- **Why it is a problem:** Privileged actions require hard server-side authorization and abuse controls; otherwise one exploit can destroy trust and data integrity.
- **Severity:** Critical
- **Launch blocker:** Yes
- **Recommended fix:** Enforce signed auth tokens + role/capability checks in every privileged endpoint; lock CORS and add request signatures/rate limits.

### 2) Admin v2 behaves like a simulation
- **Area:** Product / Ops
- **Where:** Admin v2 state-driven in-memory workflow behavior
- **Why it is a problem:** A pseudo-ops center creates false confidence and breaks team-level consistency.
- **Severity:** High
- **Launch blocker:** Yes
- **Recommended fix:** Remove from production path or fully wire every workflow to persistent backend state.

### 3) Duplicate state definitions indicate governance drift
- **Area:** Tech
- **Where:** Admin v2 state declaration blocks
- **Why it is a problem:** Duplicate keys/config blocks create nondeterministic behavior and maintenance risk.
- **Severity:** High
- **Launch blocker:** No
- **Recommended fix:** Enforce linting/static checks for duplicate keys; refactor state initialization.

### 4) Contract persistence model is not trustworthy
- **Area:** Product / Ops / Billing
- **Where:** Contract flow assumptions and browser-stored artifacts
- **Why it is a problem:** Contracts require immutable storage, versioning, and legal traceability.
- **Severity:** Critical
- **Launch blocker:** Yes
- **Recommended fix:** Move contracts to DB + storage with immutable versions, signer metadata, and audit trail.

### 5) Billing flows are request-like, not transactional
- **Area:** Billing / Strategy
- **Where:** Upgrade/add-on paths
- **Why it is a problem:** Revenue process cannot rely on ad-hoc request behavior; this causes leakage and disputes.
- **Severity:** Critical
- **Launch blocker:** Yes
- **Recommended fix:** Introduce billing domain objects (request -> approved amendment -> invoice -> payment state).

### 6) Missing invoice lifecycle engine
- **Area:** Billing
- **Where:** System-wide
- **Why it is a problem:** No formal invoice states means no predictable collections, reminders, or finance operations.
- **Severity:** Critical
- **Launch blocker:** Yes
- **Recommended fix:** Add invoice/credit note entities with lifecycle rules and accounting export.

### 7) Numbering logic is inconsistent and weak
- **Area:** Product / Ops
- **Where:** Customers/cases/contracts/invoices
- **Why it is a problem:** Non-canonical numbering creates support ambiguity and legal/accounting friction.
- **Severity:** High
- **Launch blocker:** Yes
- **Recommended fix:** Centralized sequence allocator per entity with immutable display numbers.

### 8) Status vocabulary is fragmented
- **Area:** Product / Ops / Data
- **Where:** Dashboard, admin, backend fields
- **Why it is a problem:** Teams can’t operate consistently when states overlap or conflict.
- **Severity:** High
- **Launch blocker:** Yes
- **Recommended fix:** Introduce canonical state machine per domain and enforce transitions server-side.

### 9) Case/ticket model is underpowered
- **Area:** Product / Ops
- **Where:** Cases and callback workflows
- **Why it is a problem:** No proper SLA ownership, escalation, assignment history, or resolution taxonomy.
- **Severity:** High
- **Launch blocker:** Yes
- **Recommended fix:** Build minimal but real ticketing model with queues, owners, SLA clocks, escalation reasons.

### 10) Callback lifecycle not explicit enough
- **Area:** Product / Ops
- **Where:** Call-to-callback processing
- **Why it is a problem:** “Callback requested” alone is not an operations process.
- **Severity:** High
- **Launch blocker:** Yes
- **Recommended fix:** Add callback states (new/scheduled/attempted/completed/failed/canceled) with timestamps and assignees.

### 11) Onboarding state persistence is partially local-behavior
- **Area:** UX / Ops
- **Where:** Setup/onboarding progression patterns
- **Why it is a problem:** Multi-user/multi-device consistency breaks; ops loses authoritative onboarding truth.
- **Severity:** High
- **Launch blocker:** Yes (for 100+ customers)
- **Recommended fix:** Server-side onboarding state + mandatory completion evidence + blocker reason taxonomy.

### 12) Permissions are too UI-driven
- **Area:** Tech / Security
- **Where:** Role guards and frontend behavior
- **Why it is a problem:** Hidden buttons are not security; backend must enforce capabilities.
- **Severity:** Critical
- **Launch blocker:** Yes
- **Recommended fix:** Role-capability matrix enforced in API and DB policy layer.

### 13) Auditability is not launch-grade
- **Area:** Ops / Strategy
- **Where:** Critical mutations across customer/case/contract/billing
- **Why it is a problem:** You cannot defend disputes or investigate incidents without immutable actor-level trails.
- **Severity:** High
- **Launch blocker:** Yes
- **Recommended fix:** Append-only audit events with actor, before/after, reason, correlation ID.

### 14) Admin workflow depth is shallow for real operations
- **Area:** Ops / UX
- **Where:** Admin portal
- **Why it is a problem:** Operations centers need queue triage, workload balancing, SLA alerts, and exception handling.
- **Severity:** High
- **Launch blocker:** Yes
- **Recommended fix:** Build an Ops Command Center view with priority queues and SLA breach lanes.

### 15) Plan differentiation is price-heavy, capability-light
- **Area:** Product / Strategy
- **Where:** Starter/Business/Pro behavior
- **Why it is a problem:** Weak entitlement model harms upsell logic and product clarity.
- **Severity:** High
- **Launch blocker:** Yes
- **Recommended fix:** Define capability matrix (minutes, AI config depth, SLA, support level, automations, analytics).

### 16) Notification model still has legacy ambiguity
- **Area:** Product / Data
- **Where:** Notification preferences
- **Why it is a problem:** Mixed fields/fallback logic can trigger wrong customer communication behavior.
- **Severity:** Medium
- **Launch blocker:** No
- **Recommended fix:** Migrate to one canonical notification mode field; deprecate legacy booleans.

### 17) Data model lacks explicit commercial relations
- **Area:** Billing / Data
- **Where:** Subscription-contract-invoice linkage
- **Why it is a problem:** Without explicit links, finance and support cannot explain charges cleanly.
- **Severity:** High
- **Launch blocker:** Yes
- **Recommended fix:** Enforce FK graph: customer -> subscription version -> contract version -> invoice lines.

### 18) Scalability risk from broad-list patterns
- **Area:** Tech
- **Where:** Large list rendering/filtering behavior
- **Why it is a problem:** Client-side heavy filtering won’t hold under realistic call volumes.
- **Severity:** High
- **Launch blocker:** Yes (for target scale)
- **Recommended fix:** Server-side pagination, indexed queries, cursor-based APIs.

### 19) Repository hygiene shows product governance debt
- **Area:** Ops / Tech
- **Where:** Root-level stubs/historical fragments
- **Why it is a problem:** Confusion about source-of-truth code increases release risk.
- **Severity:** Medium
- **Launch blocker:** No
- **Recommended fix:** Archive/delete dead stubs; enforce architecture ownership and release gates.

### 20) Premium-trust promise is ahead of operational reality
- **Area:** Strategy
- **Where:** Product positioning vs internal readiness
- **Why it is a problem:** Swiss SME buyers value reliability over fancy UI; trust breaks fast if ops is shaky.
- **Severity:** Critical
- **Launch blocker:** Yes
- **Recommended fix:** Prioritize reliability stack before growth features.

---

## 4. SYSTEM GAPS (WHAT IS MISSING)
A serious SaaS in this category must have, at minimum:
1. Canonical case/ticket lifecycle with SLA engine.
2. Callback lifecycle engine (with retries/escalations).
3. Contract lifecycle with immutable versioning and signing metadata.
4. Billing/invoice engine (invoice + credit note + payment + dunning).
5. Central numbering service for all commercial/support artifacts.
6. Immutable audit log for critical actions.
7. Backend-enforced role/capability system.
8. Server-side onboarding orchestration with blocker model.
9. Observability stack (ingest lag, notification failures, SLA breach alerts).
10. Idempotent event ingestion + retry/dead-letter handling.

---

## 5. TARGET V1 ARCHITECTURE
Realistic V1 launch architecture (not enterprise overkill):

1. **Core modules**
   - Accounts & Customers
   - Calls & AI outcomes
   - Callbacks & Cases
   - Onboarding
   - Contracts
   - Billing (subscriptions, invoices, credit notes)
   - Notifications
   - Admin IAM & Audit

2. **System boundaries**
   - **UI (Dashboard/Admin):** presentation only
   - **API/Functions:** all write operations, authz, validations, transitions
   - **DB:** canonical state + append-only audit events
   - **Async workers:** notifications, retries, ingestion post-processing

3. **Responsibilities**
   - UI: user intent capture
   - API: enforce business rules and role capabilities
   - DB: persistence + referential integrity
   - Workers: reliability and eventual consistency tasks

4. **Dependencies**
   - Supabase/Postgres as SSOT
   - Netlify/Supabase functions for backend logic
   - Make/automation only through controlled ingest contracts

---

## 6. STATUS MODEL (CRITICAL)
Minimal, non-overlapping, consistent states.

### Customers
`lead` -> `onboarding` -> `active` -> `suspended` -> `churned`

### Onboarding
`not_started` -> `in_progress` -> `blocked` -> `ready` -> `completed`

### Calls
`new` -> `classified` -> `action_required` / `no_action` -> `closed`

### Callbacks
`new` -> `scheduled` -> `attempted` -> `completed` / `failed` / `canceled`

### Cases
`new` -> `triaged` -> `in_progress` -> `waiting_external` -> `resolved` -> `closed`

### Contracts
`draft` -> `sent` -> `signed` -> `active` -> `amended` / `terminated` / `expired`

### Invoices
`draft` -> `issued` -> `sent` -> `paid` / `overdue` / `void`

---

## 7. NUMBERING SYSTEM
Scalable, human-readable, immutable:

- **Customers:** `CUST-000123`
- **Cases:** `CASE-2026-000045`
- **Contracts:** `CONT-2026-000012`
- **Invoices:** `INV-2026-000321`

**Why this works:**
- unique and sortable
- readable for support/finance calls
- year partition eases accounting and reconciliation
- immutable IDs reduce dispute risk

---

## 8. PRIORITIZED ROADMAP

### MUST FIX BEFORE LAUNCH
1. Lock down privileged backend operations (authz, CORS, abuse controls).
2. Replace non-systemic billing requests with real billing transaction flow.
3. Implement canonical lifecycle states across dashboard/admin/backend.
4. Implement case + callback SLA workflow.
5. Implement contract repository with immutable versions.
6. Implement invoice/credit-note engine basics.
7. Enforce backend RBAC/capabilities.
8. Add immutable audit logs for critical operations.
9. Establish numbering service.
10. Introduce server-side onboarding orchestration.

### SHOULD FIX AFTER LAUNCH
1. Real-time updates + stale-data indicators.
2. Admin workload balancing and team productivity views.
3. Advanced analytics/cohorts for retention and upsell.
4. Stronger mobile-first triage mode.
5. Automated QA regression suite for core workflows.

### NICE TO HAVE
1. AI configuration version simulation before publish.
2. Parent/child account hierarchies.
3. Self-serve contract amendment workflows.

---

## 9. IMPLEMENTATION PRIORITY PLAN

### Step 1 — Security and control plane hardening
- Lock privileged endpoints.
- Enforce backend role/capability checks.
- Add request validation/idempotency and audit write hooks.
- **Dependency:** none (do first).

### Step 2 — Canonical lifecycle + numbering foundation
- Define and implement state machines for all core domains.
- Deploy numbering service and sequence tables.
- **Dependency:** Step 1 complete.

### Step 3 — Ops core (cases, callbacks, onboarding)
- Build SLA-aware case/callback pipeline.
- Move onboarding to server-state with blockers/evidence.
- **Dependency:** Step 2 state model live.

### Step 4 — Commercial core (contracts + billing)
- Contract versioning + storage + signature metadata.
- Invoice/credit-note core and payment status transitions.
- **Dependency:** Step 2 numbering + Step 1 security.

### Step 5 — Admin as real operations center
- Priority queues, breach lanes, assignment controls, incident visibility.
- **Dependency:** Steps 3 and 4 produce reliable domain data.

### Step 6 — Scale hardening
- Pagination/indexing, observability dashboards, alerting, regression tests.
- **Dependency:** all previous steps in place.

---

## 10. FINAL CEO VERDICT

- **Would I personally launch this SaaS now?** **No.**
- **What would break first if launched today?** Operations quality and commercial trust (callback SLA misses, billing ambiguity, and support inconsistency).
- **Biggest leverage improvement:** Secure and formalize the operational/commercial backbone (authz + states + cases/callbacks + billing/contracts). That single move converts Voxera from “promising demo” into a credible Swiss SME SaaS.
