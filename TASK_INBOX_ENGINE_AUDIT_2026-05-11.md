# Customer Dashboard Task/Inbox Engine Audit (2026-05-11)

## Scope
Audited the current bucket/render logic in `customer-dashboard/index.html` for:
- Heute / Dashboard overview
- Jetzt wichtig
- Anrufe
- Rückrufe
- Aufgaben / Nachfassen
- Archiv
- KPI counts
- bottom-nav badges

## 1) Current bucket map

### Heute / Dashboard overview
- Entry point: `renderDashboard(records, manualTasks)`. Uses `deriveDashboardCallBuckets` + `getUnifiedOpenTasks` and updates dashboard KPI strip + now-important list. 
- `deriveDashboardCallBuckets` maps open calls into **multi-membership** buckets: `recent`, `callback`, `followup`, `open` via `getDashboardBucketForCall`.
- `getDashboardBucketForCall` rules:
  - closed => no buckets
  - `recent` only if `dashboard_status === new`
  - `followup` if `resolveFollowUpAt` exists
  - `callback` if `callback_requested` true.

### Jetzt wichtig
- In `renderDashboard`, “priorisierte Einheitsliste” is built from open records and flags:
  - callback (`callback_requested`)
  - urgency (`priority === high` or `lead_quality === hot` via helper usage)
  - due/overdue follow-ups via `isDueOrOverdueFollowUp`.
- No strict exclusion for `live_status` (live/processing can still appear, depending on other flags).

### Anrufe
- `renderAnrufe(records)` filters only by workflow openness: `!isClosedStatus(dashboard_status)`.
- Then `renderAnrufeInbox` renders cards; rows can carry badges for LIVE / Wird verarbeitet / Kurzer Anruf based on `getCallDisplayState` + `live_status`-derived heuristics.
- Result: live and processing calls are rendered in regular call list, not isolated.

### Rückrufe / Aufgaben / Nachfassen
- `renderRueckrufe(records, manualTasks)` (task tab) uses `getUnifiedOpenTasks`.
- `getUnifiedOpenTasks` includes any open record with at least one of:
  - `follow_up_at`
  - `callback_requested`
  - non-empty `next_action`
- Sorting combines due-bucket (`getTaskPriorityBucket`), urgency, callback flag, recency.
- `follow_up_scheduled` is **not required** to enter this bucket.

### Archiv
- `renderArchiv(records)` and `filterArchiv` include only `isClosedStatus(dashboard_status)`.
- `live_status` terminal/non-terminal is not checked.

### KPI counts
- In `renderDashboard`:
  - `kpi-callbacks-new`: open callback count (`callback_requested && !closed`)
  - `kpi-today-new`: open count (`allOpen.length`)
  - `kpi-done-new`: done count (`closed`)
- Legacy/top KPIs also use mixes of `allOpen`, callback-open, done-today.

### Bottom nav badges
- In `renderDashboard`:
  - `badge-anrufe` + `mnav-badge-anrufe` set from `newCount` (new workflow calls)
  - `badge-rueckrufe` explicitly hidden.

## 2) Field usage by section

| Section | live_status | dashboard_status | callback_requested | follow_up_at | priority/urgency | created_at/updated_at |
|---|---|---|---|---|---|---|
| Heute overview buckets | Indirect/minimal | Primary (`new`, `closed`) | Yes | Yes | Yes | Yes (recency sorting) |
| Jetzt wichtig | Not hard-gated | Excludes closed | Yes | Due/overdue logic | Yes | Yes |
| Anrufe | Used for badges/display state | Open/closed gate | Yes (badge) | Yes (badge) | Yes | Yes |
| Rückrufe/Aufgaben | Not primary gate | Excludes closed | Yes | Yes | Yes | Yes |
| Archiv | Not used | Primary gate (`closed`) | Display-only | Display/export | Not bucket gate | Yes |
| KPI | Not used for gating | Open/closed + new | Yes | Indirect | Indirect | Yes |
| Bottom badges | Not used | `new` count | No | No | No | Indirect |

## 3) Duplicate/conflicting rules found

1. **Dual lifecycle conflict**: most buckets are gated by `dashboard_status`, while telephony state (`live_status`) is mostly visual; live/processing can bleed into normal lists.
2. **Bucket duplication by design**: `getDashboardBucketForCall` intentionally returns multiple buckets, so one record appears in multiple dashboard sections.
3. **Task membership drift**: `getUnifiedOpenTasks` admits records via `next_action` or callback without requiring `follow_up_scheduled` + `follow_up_at`.
4. **Archiv semantics mismatch**: archive = workflow-closed only; does not enforce terminal telephony states (`completed/failed/abandoned`).
5. **Badge/KPI mismatch**: nav badge for Rückrufe is hidden while callbacks are counted in KPI.
6. **Urgency heuristics spread**: urgency is derived in multiple places from `priority`, `lead_quality`, follow-up due state; no single canonical evaluator.
7. **Due logic split**: due/overdue checks exist in `isDueOrOverdueFollowUp`, `getTaskPriorityBucket`, and ad-hoc checks in focus/task rendering.

## 4) Proposed canonical bucket map

### A. Live bucket (exclusive)
- Rule: `live_status IN ('incoming','active')`
- Visibility: Live row only.
- Exclude from: Jetzt wichtig, Anrufe normal rows, Aufgaben, Archiv.

### B. Processing bucket (exclusive)
- Rule: `live_status = 'processing'`
- Visibility: “Wird verarbeitet” row/group.
- Actionability: non-actionable by default; allow only explicit callback/follow-up actions if fields already set.

### C. Jetzt wichtig
- Include if all true:
  - `dashboard_status != 'closed'`
  - not in Live/Processing exclusive buckets
  - one of:
    - `dashboard_status = 'follow_up_scheduled'` and `follow_up_at` is due/overdue
    - `callback_requested = true`
    - urgent/high-priority new call
- Exclude:
  - future follow-ups
  - abandoned short calls unless `callback_requested = true`

### D. Aufgaben / Nachfassen
- Rule: `dashboard_status = 'follow_up_scheduled'` and `follow_up_at` exists.
- Sort: `follow_up_at ASC`.
- Future follow-ups stay visible here.
- Due follow-ups can also appear in Jetzt wichtig **only if duplication is explicitly intentional**.

### E. Call history
- Rule: `live_status IN ('completed','failed','abandoned') OR dashboard_status='closed'`
- Exclude live/processing unless explicitly designed.

### F. Archive
- Rule: `dashboard_status='closed'` AND terminal telephony status (`completed|failed|abandoned`).
- Sort: `updated_at DESC` (fallback `created_at DESC`).

## 5) Files/functions needing change

Single file currently centralizing logic:
- `customer-dashboard/index.html`

High-impact functions to refactor toward a central helper:
- Status/bucket core:
  - `getDashboardBucketForCall`
  - `deriveDashboardCallBuckets`
  - `getUnifiedOpenTasks`
  - `isDueOrOverdueFollowUp`
  - `getTaskPriorityBucket`
- Dashboard + now important + KPI + badges:
  - `renderDashboard`
- List renderers:
  - `renderAnrufe`, `renderAnrufeInbox`
  - `renderRueckrufe`
  - `renderArchiv`, `filterArchiv`
- Live-state presentation helpers:
  - `getCallDisplayState` (and short-abandoned helpers where defined)

## 6) Recommended implementation sequence

### PR1 (central helper only)
- Add pure helper module/section (no UI redesign):
  - `classifyRecordBuckets(record, now)` returning booleans/labels for: `isLive`, `isProcessing`, `isNowImportant`, `isTask`, `isHistory`, `isArchiveEligible`.
  - Normalize all urgency/due/callback logic in this helper.
- Keep old renderers intact but add shadow logging/asserts to compare old vs new classification (optional debug flag).

### PR2 (dashboard + jetzt wichtig)
- Wire `renderDashboard` + now-important list to helper.
- Ensure live/processing rows are exclusive and removed from normal now-important rows.
- Document intentional duplication (e.g., due tasks also in now-important) in code comments.

### PR3 (KPI + badges)
- Move KPI and bottom-nav badge counts to helper outputs.
- Align callback badge behavior (currently hidden) with agreed product rule.
- Add a small regression test harness (if feasible) for sample records covering all lifecycle combinations.

## Notes
- No large UI redesign required for this plan.
- This audit intentionally avoids broad structural changes and focuses on deterministic bucket rules.
