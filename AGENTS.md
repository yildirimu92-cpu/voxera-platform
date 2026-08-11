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
   - **A duplicate source can also be a fallback path.** Before removing one,
     check whether it is the only remaining source in some failure case. See
     the rule below.
9. Do not add new end-of-file hotfix blocks.
10. Keep the diff minimal.
11. Provide acceptance tests.
12. State remaining risks and anything that could not be tested.

---

## Removing a Duplicate Source

A value stored in two places is a defect: the two drift apart, and the surface
that displays the losing one lies to whoever reads it. Removing the losing
source is usually right.

**But a duplicate source can also be a fallback path.** Before removing one,
establish whether it is the only remaining source in some failure case — not
in the normal case, where by definition the winning source works.

Ask:

1. Which code path reads the source that stays?
2. What happens if *that* path fails, is misconfigured, or returns nothing?
3. Does the source being removed cover exactly that case today?

If the answer to 3 is yes, the removal needs a replacement for the failure
case before it lands — not after.

### Where this came from

2026-08-10, #930. The appointment mode was stored twice: as the typed column
`customers.ai_appointment_mode` and inside the `[PROMPT_V2]` note in
`ai_internal_notes`. The column had been the leading source since J4, the note
was ignored — and for one customer they disagreed, so the admin UI showed
"Terminanfrage" while the agent was booking directly. Removing the note was
clearly correct.

It was also nearly a regression. The column is not read directly: the schema
in `system_config.core_field_steps` maps field keys to column names, so a
broken schema means the column cannot be reached at all. Until that day the
note was what kept the appointment mode alive in exactly that case. Removing
it would have made a broken schema silently drop the booking authority —
without an error, and without any output that looks wrong.

An existing test caught it, which is luck, not method. The fix was to read the
column directly when the schema does not map it. Same single source, one less
dependency.

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

### STOP before `supabase link` / `supabase db push`

80 of the 105 files in `supabase/migrations/` have no version prefix
(`2026-04-02_name.sql` instead of `20260402090000_name.sql`). The Supabase
CLI reads the filename up to the first `_` as the version and matches it
against `supabase_migrations.schema_migrations`. A name without a 14-digit
timestamp matches nothing, so the CLI considers those 80 files **not
applied** — even though their DDL has been in production for months.

Nothing applies them automatically today: no workflow calls `db push`,
there is no `supabase/config.toml`, and the Netlify build only runs
`build-runtime-config.mjs`. The trap springs the first time somebody links
this repo to the production database and pushes.

Before you link or push: read `supabase/migrations/README.md` and issue
#924. Run `--dry-run` first and actually read the list it offers. If it
offers ~80 migrations, stop.

New migrations must always be created with `supabase migration new <name>`
so they get a proper timestamp prefix.

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

## Merge Rules

### Code and migration must not be merged apart

When a change consists of code **and** a migration, one of these must hold
before the merge:

1. the migration is already applied to the target database, **or**
2. the code works without it.

Anything else creates a third state that is neither the old one nor the new
one — and no rule, test, or check describes that state. The old code is gone,
the new code is live, and the schema it was written for does not exist yet.

Note that (2) is a real option and often the cheaper one: a reader that
tolerates both shapes, a feature flag, a guard that treats a missing column as
"not configured". Choose it deliberately rather than by accident.

State in the pull request which of the two applies. "The migration is included"
does not answer the question — it says where the file is, not whether the
database has it.

### Where this came from

2026-08-11, #940. The pull request enforced booking hours from
`calendar_settings.business_hours` and shipped the migration that makes the
column nullable, so that an unconfirmed value stops restricting anything. Both
were reviewed, CI was green, and the merge was approved on that basis.

The migration was not applied. Between the merge and the manual apply, the new
code read a `not null` column carrying a default of Mon–Fri 08:00–17:00 that no
customer had chosen and no customer could change — exactly the failure the
migration existed to prevent, and exactly the one the review had flagged as a
blocker. The pull request text itself described why that state is unacceptable.

**It was caught by looking, not by a guard.** Nothing reports "code on main,
migration not applied". The window was short and one customer wide, which is
luck, not design.

Until such a check exists, this rule is the only thing standing in that gap —
so state the answer in the pull request, every time.

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

### A verify script without a workflow is a script that never runs

**Whoever adds a `scripts/verify-*.mjs` wires it into CI in the same commit.**
A script nobody runs cannot go red — it is simply not executed, and its silence
is indistinguishable from a pass.

This is not a hypothetical. On 2026-08-11 a full local run found **twelve**
verify scripts that no workflow references. Two of them were broken:
`verify-qr-invoice-controls` had been crashing since 2026-08-10 because a
routine cache-bust changed a version string it asserts literally, and
`verify-invoice-only-swiss-billing` was failing 2 of 17 checks. Neither had
shown up anywhere, because neither runs anywhere. See issue #941.

Two consequences worth stating separately:

1. **Adding the script is half the work.** Either add a workflow for it, or —
   preferably — make sure it is covered by a collective workflow that runs every
   `scripts/verify-*.mjs` needing no credentials, so a new script is covered by
   default instead of waiting on a second, easily forgotten step.

2. **"CI green" on a pull request never means "the repository is green."** Most
   verify workflows are path-filtered, which is correct for run time but means a
   red script whose paths a PR does not touch will not appear in that PR's
   checks. When reporting CI status, say which of the two you mean.

A script that needs credentials (for example `verify-db-security-invariants`,
which runs against the real database) must **fail** when they are absent, never
report success. Being unable to check is not the same as having checked.

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
