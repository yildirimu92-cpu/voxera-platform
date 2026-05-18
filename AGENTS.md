# Voxera AI Development Rules

## Core Principle

Work root-cause-first. Do not patch symptoms.

No assumption may be presented as fact. If something is not proven by code, logs, schema, runtime behavior, or tests, mark it as unverified.

These rules apply to all Voxera software engineering work, including frontend, backend, database, Supabase/RLS, Netlify Functions, Make/Twilio/ElevenLabs integrations, dashboards, process flows, onboarding flows, and operational logic.

---

## Required Workflow

For bugs, unstable behavior, process flaws, and unclear product logic:

1. Audit first.
2. No code change during audit unless explicitly requested.
3. Identify the exact root cause before proposing a fix.
4. Name the affected functions, handlers, files, database fields, and source-of-truth logic.
5. Check whether old logic, wrappers, duplicate handlers, or hotfix blocks conflict with the desired behavior.
6. Propose the minimal fix.
7. Only after approval, implement the fix.
8. Remove or neutralize old competing logic.
9. Do not add new end-of-file hotfix blocks.
10. Keep the diff minimal.
11. Provide acceptance tests.
12. State remaining risks and anything that could not be tested.

---

## No-Assumption Rule

Always separate:

- **Fact:** directly proven by code, schema, logs, runtime behavior, or tests.
- **Likely:** supported by evidence but not fully proven.
- **Unverified:** not yet proven and requiring inspection or live testing.

Do not write that something is fixed, safe, correct, or guaranteed unless it is verified.

Use precise language such as:

- “The code shows…”
- “The audit indicates…”
- “This is plausible but not yet live-tested…”
- “This remains unverified…”

Avoid vague claims such as:

- “This should be fine.”
- “This definitely fixes it.”
- “No problem.”

---

## Prohibited Patterns

Avoid:

- new generic hotfix script blocks at the end of large HTML files
- global `pointer-events` hacks
- global capture `stopPropagation` rules
- broad `z-index` fixes without root cause
- add-only patches that do not remove or neutralize old logic
- multiple handlers for the same action
- `setTimeout` chains as a substitute for correct state handling
- broad `localStorage.clear()` or `sessionStorage.clear()` operations
- deleting storage keys without explicit scope and justification
- async/fetch/database calls before visible UI feedback when opening modals
- changing Desktop behavior to fix a Mobile-only bug
- changing Mobile behavior to fix a Desktop-only bug
- mixing unrelated fixes in one commit
- silently swallowing Supabase, fetch, or integration errors

---

## Required Reporting After Every Audit

Every audit must report:

1. Exact observed problem.
2. Reproduction path.
3. Relevant functions and files.
4. Event path or process path.
5. State source or database source of truth.
6. Competing handlers, wrappers, triggers, jobs, or automations.
7. Root cause if proven.
8. What remains unverified.
9. Minimal fix recommendation.
10. Risks.

No commit should be made during audit unless explicitly requested.

---

## Required Reporting After Every Fix

Every implementation must report:

1. Root cause addressed.
2. Changed files.
3. Changed functions.
4. Removed or neutralized old logic.
5. Source of truth used.
6. Why the fix is minimal.
7. Net diff.
8. Tests performed.
9. Tests not possible in the current environment.
10. Remaining risks.
11. Whether new hotfix blocks were added: yes/no.

---

## Voxera Frontend Sources of Truth

Respect central responsibility boundaries.

Suggested frontend sources of truth:

- Row opening: `vxRouteRowOpen(...)`
- Call action dispatch: `vxRunCallAction(...)`
- Workflow state: `vxGetWorkflowState(...)`
- Allowed actions: `vxCanPerformAction(...)`
- Onboarding auto-open: `vxOnboardingShouldAutoOpen(...)`
- Mobile UI state: `syncMobileState(...)`
- Modal open/close: central modal functions, not scattered inline handlers

Do not duplicate these decisions in unrelated handlers.

If a different function is the actual source of truth in the current code, identify it before changing anything.

---

## Mobile vs Desktop Rule

If a problem is Mobile-only:

- Do not modify Desktop behavior.
- Do not introduce global event blockers.
- Inspect touch/click dedupe.
- Verify that only one effective action path exists.
- Test modal open, modal close, ghost-tap, back navigation, bottom navigation, and row opening separately.

If a problem is Desktop-only:

- Do not modify Mobile behavior.
- Inspect split view, pointer ownership, detail pane, overlays, and keyboard/mouse-specific handlers separately.

Always report whether Desktop and Mobile were both affected or only one platform.

---

## Interaction and Event Handling Rules

For click/tap/action bugs:

1. Identify the first handler that receives the event.
2. Identify all delegated handlers that may also receive it.
3. Check for duplicate paths: inline handler, document capture handler, bubbling handler, wrapper, legacy block.
4. Check whether `preventDefault`, `stopPropagation`, or custom flags like `event.__vxHandled` are used consistently.
5. Ensure business actions are not executed twice by touchend and click.
6. Touch handlers may dedupe or prepare state, but should not run business actions unless explicitly justified.
7. Modal close actions must prevent click-through/ghost-tap to underlying buttons.

Do not fix event problems by adding another global handler unless old competing handlers are removed or neutralized.

---

## State / Wizard / Onboarding Rules

For any recurring overlay, wizard, tour, setup flow, onboarding flow, or first-run problem, check:

1. Which function opens the overlay.
2. Exact open condition.
3. Source of truth: database, `customerMeta`, `onboarding`, `localStorage`, `sessionStorage`, URL param, or fallback.
4. Where completion is saved.
5. Whether the write result is verified.
6. Whether Supabase RLS or SELECT/UPDATE permissions can affect the result.
7. Whether polling, realtime, retries, pending reruns, or init loops reopen it.
8. Whether multiple overlays exist, for example onboarding overlay vs product tour overlay.
9. Whether storage cleanup can remove required flags.
10. Whether auto-open guards are set only after known/valid state, not during loading/unknown state.

Database state should remain the source of truth when available. Session flags may be used only as race-condition protection, not as a replacement for persistent state.

---

## Database / Supabase / RLS Rules

For database-related fixes:

1. Identify the table, field, policy, and query path.
2. Verify whether the query uses authenticated client or service role.
3. Verify SELECT, INSERT, UPDATE, DELETE permissions separately.
4. Check whether `.select().single()` can fail because of RLS even if UPDATE succeeds.
5. Never assume a DB write succeeded without checking `error`.
6. Never update state locally as successful before the write result is confirmed.
7. Preserve existing schema if suitable fields already exist.
8. Avoid schema changes unless the current schema cannot support the required behavior.
9. Report required migrations separately from frontend changes.

---

## Performance / Slow Action Rules

For slow buttons, delayed modals, slow dashboards, or delayed saves:

Do not guess.

Measure:

1. tap/click start
2. router start
3. action function start
4. modal open start
5. modal visible
6. render start/end
7. fetch/Supabase start/end
8. save start/end

Use debug logs only behind an explicit flag, for example:

```js
window.VX_DEBUG === true
```

No visible debug panels in production.

Do not leave high-frequency logging, DOM debug panels, or persistent performance logs enabled by default.

---

## UI Feedback Rule

For actions that open modals, sheets, confirmation dialogs, or visible feedback:

- Show the UI synchronously whenever possible.
- Do not wait for fetch, Supabase, render refresh, or storage operations before showing the modal.
- Do validation before opening only if it is cheap and synchronous.
- Expensive validation should happen inside the modal or after visible feedback.
- If a save fails, keep the user informed with clear feedback.

---

## Process and Product Logic Rules

For workflow/process changes:

1. Define the business state model first.
2. Identify the source of truth for each state.
3. Separate lifecycle, onboarding, invite/access, contract, payment, activation, and notification states.
4. Do not mix display labels with canonical state values.
5. Do not create duplicate status systems unless explicitly needed.
6. If legacy statuses exist, define normalization in one place.
7. Every process step needs a clear trigger, owner, state transition, and failure behavior.

---

## Commit Rules

Use small commits.

Do not combine unrelated areas in one commit.

Good examples:

- `Fix onboarding auto-open guard`
- `Consolidate detail action routing`
- `Remove duplicate mobile touch handler`
- `Handle Supabase update error for onboarding completion`

Bad examples:

- `Fix dashboard issues`
- `Mobile and onboarding and styles`
- `Various improvements`

Every commit summary must mention whether it was audit-only or implementation.

---

## Acceptance Test Rules

Each fix needs a specific acceptance checklist.

Example for modal action bugs:

1. Open detail.
2. Tap action button.
3. Modal appears immediately.
4. Close with X.
5. Underlying button is not triggered.
6. Reopen modal.
7. Cancel works.
8. Confirm/save works.
9. Back navigation still works.
10. Console has no new errors.
11. Desktop remains unchanged if bug was Mobile-only.

If a test cannot be executed in the current environment, report that explicitly.

---

## Codex / AI Assistant Instruction

Before making changes, read this file.

If a requested task conflicts with these rules, report the conflict before changing code.

If a fix requires breaking one of these rules, explain why and get explicit approval.

Default mode for bugs:

1. Audit only.
2. Wait for approval.
3. Implement minimal fix.
4. Report diff, tests, and risks.
