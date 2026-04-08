# Voxera Activation/Deactivation Module – Mid-Project Audit
**Date:** 2026-04-08  
**Scope:** `customer-dashboard/index.html`, `customer-dashboard/netlify/functions/customer-update-settings.js`, `_lib/require-customer.js`, `_lib/status-model.js`  
**Type:** Current-state assessment – not a redesign proposal

---

## Executive Summary

The activation/deactivation module is functionally coherent for its core flows: smartphone activation via test call, skip-test shortcut, landline activation, and deactivation with confirmation. The state machine is clean and the backend validation is solid.

However, there are several concrete issues that should be addressed before wider customer rollout:

1. **One confirmed bug**: `activation_started_at` cannot be set to `null` via the API, meaning `resetActivationTestContext()` does not fully persist its intended reset on the backend.
2. **Deactivation checkbox is reset by the 12-second auto-refresh**, making the deactivation confirmation flow unreliable.
3. **Four dead UI functions** render into hidden/non-existent elements and can be removed.
4. **Silent configuration changes while active**: device type and mode can be changed without updating forwarding status.
5. **Polling is not restarted after page reload** while in `pending_test` state.

The setup wizard (`#setup-wizard`) appears to be fully deprecated but its HTML and all supporting logic remain in the codebase.

---

## 1. Current Activation / Deactivation Flows

### 1.1 Standard Activation – Smartphone (Mobile)

**Trigger:** User selects device type `mobile`, selects a forwarding mode, and clicks "Jetzt aktivieren".

**Steps:**
1. `activationStartSmartphone(event, code)` is called.
2. Persists `forwarding_status = 'pending_test'` and `activation_started_at = <now ISO>` to the database via `patchCustomerRecord()`.
3. Updates `customerMeta.forwardingStatus` and `customerMeta.activationStartedAt` in local memory.
4. Updates `context.customerRecord` in local memory.
5. Calls `renderActivationModule()` – action card is hidden, pending-test card is shown.
6. Calls `startActivationPolling()` – starts a `setInterval` that calls `loadData()` every **5 seconds**.
7. Opens the device dialer: `window.location.href = 'tel:' + code`.

**Polling / call detection:**
- Each `loadData()` call fetches all call records, then in the post-load hook (lines 3089–3104) checks:  
  `findActivationCandidateCall(records, activationStartedAt)` – returns the earliest call record whose `created_at` is strictly after `activationStartedAt`.
- When a candidate is found: `candidateCall` (module-level variable) is set, polling is stopped, `renderActivationModule()` is called (candidate found UI shows).

**Completion condition:**
- User sees "✅ Testanruf erkannt" and clicks "Test erfolgreich – aktivieren".
- `confirmActivationTestCall()` persists: `forwarding_status = 'active'`, `forwarding_setup_completed = true`, `last_confirmed_setup_device_type`, `last_confirmed_forwarding_mode`.
- `candidateCall` is cleared, polling is stopped, UI transitions to `active` state.

**State after completion:** `forwarding_status = 'active'`, `forwarding_setup_completed = true`, `last_confirmed_*` reflect the confirmed configuration.

---

### 1.2 Skip Activation ("Ohne Test fortfahren")

**Trigger:** The "Konfiguration bereits bestätigt" block (`#act-skip-shortcut-block`) is visible – this requires `canSkipActivationTest()` to return `true`.

**`canSkipActivationTest(meta)` conditions (all must be true):**
- `meta.forwardingSetupCompleted === true`
- `meta.setupDeviceType` is set
- `meta.forwardingMode` is set
- `meta.lastConfirmedSetupDeviceType` is set and equals `meta.setupDeviceType`
- `meta.lastConfirmedForwardingMode` is set and equals `meta.forwardingMode`
- `meta.forwardingStatus !== 'active'`

**Steps:**
1. `activationSkipTest(event)` is called.
2. Persists: `forwarding_status = 'active'`, `forwarding_setup_completed = true`, `last_confirmed_setup_device_type`, `last_confirmed_forwarding_mode`.
3. Updates local memory, stops polling, shows success toast.
4. `renderActivationModule()` is called – UI transitions to `active` state.

**Completion condition:** Immediate – no test call, no polling.

---

### 1.3 Manual / Landline Activation

**Trigger:** User selects device type `landline`, selects a forwarding mode, and clicks "Testanruf starten".

**Steps:**
1. `activationStartLandlineTest(event)` is called.
2. Persists `forwarding_status = 'pending_test'` and `activation_started_at = <now ISO>`.
3. Same local memory and `customerRecord` updates as smartphone flow.
4. Renders pending-test card (with landline-specific guidance from `getDeviceModeTestGuidance('landline', mode, telNr)`).
5. Starts polling (5-second interval).
6. **No dialer is opened** – user must manually configure forwarding at provider portal.

**Completion condition:** Same as smartphone – user confirms candidate call via `confirmActivationTestCall()`.

---

### 1.4 Deactivation – Mobile

**Trigger:** `forwarding_status === 'active'` and `setupDeviceType === 'mobile'`. Deactivation section rendered by `renderDeactivationSection(meta)`.

**Steps:**
1. User clicks "Weiterleitung entfernen" (an `<a href="tel:${disableCode}">` link).
2. `activationMobileDeactivate(event)` is called:
   - Shows `#act-deact-mobile-nextstep` helper box.
   - Shows a toast: "Deaktivierung gestartet. Bitte testen Sie jetzt Ihre Nummer."
   - **Does NOT change `forwarding_status`.**
3. Dialer opens with disable code (e.g. `#61#` for `no_answer` mode).
4. User manually tests by calling their own number.
5. User checks "Ich bestätige, dass kein neuer Anruf im Dashboard erschienen ist" checkbox.
   - Checkbox change → `activationDeactivationCheckboxChanged()` → enables deactivate button.
6. User clicks "Verknüpfung deaktivieren" → `activationConfirmDeactivation(event)`.
7. `persistForwardingStatus('inactive')` → persists `forwarding_status = 'inactive'`.
8. `renderActivationModule()` → UI transitions to `inactive` state.

**Note:** `forwarding_setup_completed` is NOT reset to `false` on deactivation.

---

### 1.5 Deactivation – Landline

**Trigger:** `forwarding_status === 'active'` and `setupDeviceType === 'landline'`.

**Steps:**
1. Deactivation section renders with "Anleitung anzeigen" button (opens help tab).
2. User manually removes forwarding at provider portal.
3. User follows three-step instructions, tests manually.
4. Checkbox + confirm button → same `activationConfirmDeactivation()` flow as mobile.

---

### 1.6 Retry Flow

**Trigger:** User clicks "Erneut prüfen" in the pending-test card.

**Steps:**
1. `retryActivationCheck(event)` is called.
2. Clears `candidateCall`.
3. Stops and restarts polling (`stopActivationPolling()` + `startActivationPolling()`).
4. Calls `loadData()` immediately.
5. Shows toast: "Prüfung erneut gestartet. Wir warten auf Ihren Testanruf."
6. `renderActivationModule()` is called.

---

### 1.7 Reject Candidate Call ("Erneut testen")

**Trigger:** User sees "✅ Testanruf erkannt" and clicks "Erneut testen".

**Steps:**
1. `rejectActivationTestCall(event)` is called.
2. Clears `candidateCall`.
3. **Does NOT stop polling** – stays in `pending_test`, polling continues.
4. `renderActivationModule()` is called – reverts to "Warten auf Testanruf…" state.

---

### 1.8 Reset Flow (configuration change during `pending_test`)

**Trigger:** User clicks a different device type or forwarding mode while `forwarding_status === 'pending_test'`.

**Steps (`persistSetupDeviceType()` or `persistForwardingMode()`):**
1. Detects `customerMeta.forwardingStatus === 'pending_test'`.
2. Calls `resetActivationTestContext(recId, context)`:
   - Calls `stopActivationPolling()`, clears `candidateCall`.
   - Persists: `forwarding_status = 'not_started'`, `activation_started_at = null`.  
     ⚠️ **Bug: `activation_started_at: null` is silently ignored by the backend** (see Section 5).
   - Updates local memory and `customerRecord`.
   - Shows toast: "Aktivierung wurde zurückgesetzt. Bitte starten Sie den Test erneut."
   - Calls `renderActivationModule()`.
3. Then persists the new device type or mode.

---

## 2. State Model

### Fields and Current Usage

| Field | Type | Allowed Values | Persisted? | Used In |
|-------|------|---------------|-----------|---------|
| `setup_device_type` | string or null | `'mobile'`, `'landline'` | DB + local `customerMeta` | Device selection, forwarding code generation, deactivation section rendering |
| `forwarding_mode` | string or null | `'no_answer'`, `'unreachable'`, `'always'`, `'busy'` | DB + local `customerMeta` | Mode selection, forwarding code generation, GSM code lookup, deactivation disable-code lookup |
| `forwarding_status` | string or null | `'not_started'`, `'pending_test'`, `'active'`, `'inactive'` | DB + local `customerMeta` | Core UI state machine (`getActivationUiState()`); null is treated as 'not_started' |
| `forwarding_setup_completed` | boolean | `true`, `false` | DB + local `customerMeta` | `canSkipActivationTest()`, setup wizard s2 step, `routeDashboardFirstSessionExperience()` |
| `activation_started_at` | ISO 8601 string or null | Any valid ISO timestamp | DB + local `customerMeta` | `findActivationCandidateCall()` – defines the lower time bound for candidate calls |
| `last_confirmed_setup_device_type` | string or null | `'mobile'`, `'landline'` | DB + local `customerMeta` | `canSkipActivationTest()` – must equal `setupDeviceType` to enable skip |
| `last_confirmed_forwarding_mode` | string or null | `'no_answer'`, `'unreachable'`, `'always'`, `'busy'` | DB + local `customerMeta` | `canSkipActivationTest()` – must equal `forwardingMode` to enable skip |

### State Transitions for `forwarding_status`

```
null / not_started ──→ pending_test  (activationStartSmartphone / activationStartLandlineTest)
pending_test       ──→ active        (confirmActivationTestCall)
pending_test       ──→ not_started   (resetActivationTestContext – device/mode changed)
not_started        ──→ active        (activationSkipTest – skip shortcut)
active             ──→ inactive      (activationConfirmDeactivation)
inactive           ──→ pending_test  (activationStartSmartphone / activationStartLandlineTest – re-activate)
inactive           ──→ active        (activationSkipTest – skip shortcut, if canSkipActivationTest = true)
```

### Persisted vs. Local-Only

All seven fields listed above are **both persisted to the database and reflected in local `customerMeta`**. There are no local-only activation state fields except:
- `candidateCall` (module-level variable, lost on page reload)
- `activationPollingInterval` (setInterval handle, lost on page reload)
- `setupDone`, `setupSkipped` (localStorage-backed for the setup wizard)

### Fields Present but No Longer Meaningfully Used

- `forwarding_setup_completed` — **inferred as partially obsolete**. It is set to `true` on activation but never reset to `false` (even after deactivation or configuration changes). It conflates "activation was completed at least once" with "forwarding is currently properly configured." In practice it mainly controls the `canSkipActivationTest()` shortcut.

---

## 3. UI / UX Consistency Audit

### State: `not_started`

**What is shown:**
- Badge: "● Nicht gestartet", description: "Wählen Sie unten Ihren Gerätetyp..."
- Device selection section (always visible)
- Mode section: hidden (no device type selected)
- Action section: hidden
- Pending-test section: hidden
- Deactivation section: hidden

**Assessment:** Clear and correct. The user is guided to select a device type.

---

### State: `in_progress` (device selected, no mode / no action taken yet)

**What is shown:**
- Badge: "● In Aktivierung", description: "Einrichtung gestartet. Aktivierung erfolgt durch den ersten eingehenden Anruf."
- Device selection (with selected card highlighted)
- Mode section: visible (device type is set)
- Action section: hidden (no mode selected yet)
- Deactivation section: hidden

**⚠️ Issue:** The state description "Aktivierung erfolgt durch den ersten eingehenden Anruf" is **inaccurate**. Activation does NOT happen automatically on the first incoming call. The user must explicitly start a test call and confirm it. This text misleads users into waiting passively instead of completing the activation flow.

---

### State: `pending_test`

**What is shown:**
- Badge: "● Testanruf ausstehend"
- Device selection (still visible and clickable)
- Mode section: visible
- Action section: **hidden** (explicitly excluded when `uiState === 'pending_test'`)
- Pending-test card: visible with device+mode-specific guidance
- Deactivation section: hidden

**⚠️ Issue 1:** Device selection cards remain visible and clickable during `pending_test`. While changing device type or mode correctly triggers `resetActivationTestContext()`, the user may not understand why their test was reset.

**⚠️ Issue 2:** The action section (containing the forwarding code) is hidden during `pending_test`. A user who forgot the code or wants to re-dial cannot see the code from the pending-test card.

**Assessment:** Mostly good; the pending-test card provides rich device+mode-specific guidance. The two issues above are confusion risks.

---

### State: `active`

**What is shown:**
- Badge: "● Aktiv", description: "Voxera ist aktiv und empfängt Anrufe gemäss Ihrer Einstellung."
- Device selection: **visible and interactive** (undesirable – see issue below)
- Mode section: visible
- Action section: visible (shows "Jetzt aktivieren" again – confusing when already active)
- Skip shortcut block: shown if `canSkipActivationTest()` is true
- "Testanruf erforderlich" block: shown if `forwarding_setup_completed` is true and skip not available
- Deactivation section: visible

**⚠️ Issue 1 (Contradictory UI):** The action card renders "Smartphone aktivieren" / "Jetzt aktivieren" while the status badge says "● Aktiv". A user who is already active sees a button that appears to allow activation again. There is no visual differentiation indicating that clicking this button starts a new test cycle.

**⚠️ Issue 2 (Silent active-state mutation):** Selecting a different device type or forwarding mode while `forwarding_status === 'active'` silently updates those fields without changing the forwarding status. The phone's actual call routing is unchanged (set at the carrier level by the user's earlier USSD action), but the dashboard displays different mode/code information. This creates a disconnect between the dashboard state and the actual phone configuration.

**⚠️ Issue 3:** The "skip shortcut block" and "test required" blocks appear together with the "Jetzt aktivieren" button when status is `active`. This creates duplicate/overlapping action blocks.

---

### State: `inactive`

**What is shown:**
- Badge: "● Deaktiviert", description: "Die Rufumleitung wurde entfernt."
- Device selection: visible (if previously set)
- Mode section: visible (if previously set)
- Action section: visible if hasDeviceType && hasMode (shows "Jetzt aktivieren")
- Deactivation section: hidden

**Assessment:** The re-activation path is functional but the state description does not explicitly invite re-activation. A user might think the system is fully stopped and be unsure how to proceed.

---

### Confirmed Configuration Unchanged (canSkipActivationTest = true)

- "Konfiguration bereits bestätigt" block shows inside the action section.
- Provides "Ohne Test fortfahren" and "Testanruf durchführen" buttons.
- The "Ohne Test fortfahren" path correctly skips the test.

**⚠️ Issue:** "Testanruf durchführen" calls `activationSkipToTest(event)` which only hides the skip block and scrolls to the action section. It does **not** start a test call. The user then sees the "Jetzt aktivieren" button and must click it separately. The button label "Testanruf durchführen" suggests it performs the action immediately, which is misleading.

---

### Confirmed Configuration Changed (canSkipActivationTest = false, forwarding_setup_completed = true)

- "Testanruf erforderlich" block shown: "Sie haben den Gerätetyp oder die Weiterleitungsart geändert."
- The main activation buttons remain visible.

**Assessment:** Consistent and correct.

---

### Mobile vs. Landline

- **Mobile:** GSM code shown, "Jetzt aktivieren" opens dialer, deactivation uses disable code in dialer.
- **Landline:** No code shown (or not applicable via USSD), "Anleitung anzeigen" opens help tab, deactivation manual.

**⚠️ Issue:** For landline activation, there is no forwarding code shown in the action card (`getForwardingCode()` returns a GSM USSD code which is only applicable to mobile networks). The action card still renders the `act-action-code-box` area, but for landline it will show an empty code box since `code` will be a USSD string (e.g. `*61*+41...#`) that is not applicable for landline. Actually, looking at `renderActivationActionCard`: the code box is shown `if (code)` and landline does get a forwarding code from `getForwardingCode()`. This means landline users also see a USSD code that doesn't apply to their setup. **This is a UX bug**: a landline user sees a USSD code that won't work on their equipment.

---

## 4. Technical Cleanup Audit

### Dead Functions

| Function | Location | Issue |
|----------|----------|-------|
| `renderActivationInstructions(deviceType)` | ~line 4630 | References `#act-instructions` which does not exist in the HTML. Function is never called in the visible code paths. Completely dead. |
| `updateActivationStatusCard(records)` | ~line 3210 | Renders into `#dash-activation-card` which has `style="display:none!important"` on the element. The function executes but has no visible effect. |
| `handleDashboardActivationPrimaryCta(event)` | ~line 3244 | Handler for `#dash-activation-primary` which is inside the hidden `#dash-activation-card`. Dead. |
| `updateSetupExperienceProgress()` | ~line 4568 | Renders into `#fse-progress-forwarding`, `#fse-progress-testcall`, `#fse-progress-ready` – all have `style="display:none"` in the HTML. Dead. |
| `handleSetupExperiencePrimaryCta(event)` | ~line 4595 | References `#dashboard-fse-primary` which is hidden. |
| `handleSetupExperienceWizardCta(event)` | ~line 4606 | References `#dashboard-fse-secondary` which is hidden. |

### Dead HTML

| Element | Location | Issue |
|---------|----------|-------|
| `#dash-activation-card` (and children) | ~line 1196 | `style="display:none!important"` – explicitly killed. Contains `#dash-activation-title`, `#dash-activation-text`, `#dash-activation-primary`. |
| `#dashboard-fse-primary`, `#dashboard-fse-secondary` | ~line 1186 | `style="display:none"` |
| `#fse-progress-forwarding`, `#fse-progress-testcall`, `#fse-progress-ready` | ~lines 1188–1190 | `style="display:none"` |
| `#setup-wizard` and all children | ~line 1396 | `style="display:none"` on the container; the 5-step legacy setup wizard is no longer rendered. |

### Obsolete Comments

| Location | Comment | Issue |
|----------|---------|-------|
| ~line 1195 | `<!-- activation card removed – handled in Einrichtung tab -->` | The card HTML still exists below the comment (just forced hidden). |
| ~line 5030 | `// TODO: Backend hook needed` | Inside `persistForwardingStatus()` which already makes a backend call via `patchCustomerRecord()`. Stale/misleading. |

### Duplicated / Redundant Logic

| Issue | Location |
|-------|----------|
| `isForwardingActivated()` is an exact alias for `isForwardingSetupCompleted()` | ~line 4434 |
| `updateSetupExperienceProgress()`: both `forwardingDone` and `readyDone` use `isForwardingSetupCompleted()` | ~line 4568–4572 |
| State is mirrored in three places: `customerMeta`, `context.customerRecord`, and inline updates in each async function | Multiple locations |
| `showSetupExperience()` and `showDashboard()` are now identical | ~lines 4543–4552 |

### Legacy Setup-Wizard Remnants

The legacy setup wizard (`#setup-wizard`) is fully hidden but its entire implementation remains:
- ~500 lines of setup wizard JS (`var setupDone`, `initSetupWizard`, `completeSetupStep`, `skipSetupStep`, `resetSetupWizard`, etc.)
- localStorage keys (`voxera_setup_steps`, `voxera_setup_finished`, `voxera_setup_reminder_dismissed`)
- The `#setup-wizard` HTML block (lines ~1396–1700)
- `initSetupWizard()` is still called from `showApp()` (line ~5912) and from `resetSetupWizard()`

These are all inert but add significant maintenance weight (~30% of the JS codebase is wizard-related code that no longer affects the active UI).

---

## 5. Bug / Risk Review

### Confirmed Bugs

#### BUG-1: `activation_started_at` Cannot Be Cleared via the API

**Location:** `resetActivationTestContext()` (~line 4439), `customer-update-settings.js` line 80.

**Description:**  
`resetActivationTestContext()` calls:
```javascript
await patchCustomerRecord(recId, { forwarding_status: 'not_started', activation_started_at: null });
```

In `customer-update-settings.js`, the activation_started_at handling is:
```javascript
if (body.activation_started_at != null) {
  // ...
  allowed.activation_started_at = ts;
}
```

Since `null != null` is `false`, the `null` value is silently ignored. The field is never added to `allowed`, so the database keeps the old timestamp.

**Impact:** After a device/mode change resets the activation, the DB retains the old `activation_started_at`. On page reload, `findActivationCandidateCall()` will use this old timestamp and may incorrectly flag pre-existing calls as candidate calls from the "new" test.

**Severity:** Medium. Affects users who change configuration during an active pending_test flow and then reload the page.

**Fix:** Either (a) extend the backend to accept `null` for `activation_started_at` and nullify it explicitly, or (b) use a sentinel value like a far-future timestamp or empty string as a "no start time" marker.

---

#### BUG-2: Deactivation Checkbox Reset by Auto-Refresh

**Location:** `renderActivationModule()` lines 4733–4736, `autoRefreshTimer` at ~line 5925.

**Description:**
```javascript
var checkbox = document.getElementById('act-deact-checkbox');
var deactBtn = document.getElementById('act-deact-btn');
if (checkbox) checkbox.checked = false;
if (deactBtn) { deactBtn.disabled = true; deactBtn.textContent = 'Verknüpfung deaktivieren'; }
```

`renderActivationModule()` unconditionally resets the deactivation checkbox. It is called on every `loadData()` result, which runs every 12 seconds via `autoRefreshTimer`. A user who has checked the checkbox will have it unchecked within 12 seconds.

**Impact:** Users cannot reliably complete the deactivation confirmation flow unless they click the button quickly after checking the checkbox.

**Severity:** High. Deactivation confirmation is impossible for slow users or users on slower connections.

**Fix:** Do not reset the checkbox in `renderActivationModule()`. Instead, only set the initial state on first render (e.g., check if the element already exists before re-rendering the deactivation section, or preserve checkbox state across re-renders).

---

#### BUG-3: GSM Forwarding Code Shown to Landline Users

**Location:** `renderActivationActionCard()` (~line 4758), `getForwardingCode()` (~line 4520).

**Description:**  
`getForwardingCode(mode, voxeraNumber)` returns USSD/GSM codes (e.g. `*61*+41...#`) for all modes. For landline users, the code box is displayed with this GSM code, which is only applicable on mobile networks and cannot be used on a landline/PBX system.

**Impact:** Landline users see a code they cannot use, which may cause confusion and failed activation attempts.

**Severity:** Medium. The hint text below the code box mentions "GSM-Codes funktionieren in der Regel nur auf Smartphones", but the prominent code display contradicts this.

**Fix:** For `setupDeviceType === 'landline'`, hide `act-action-code-box` entirely (currently hidden only when `code` is falsy, but landline still gets a code).

---

### Risks

#### RISK-1: Polling Not Restarted After Page Reload in `pending_test`

**Description:**  
`startActivationPolling()` is only called from:
- `activationStartSmartphone()`
- `activationStartLandlineTest()`
- `retryActivationCheck()`

If the user is in `pending_test` and reloads the page, the 5-second polling interval is not restarted. Call detection falls back to the 12-second auto-refresh interval only.

**Impact:** After page reload, candidate call detection latency increases from ≤5s to ≤12s. This is a degraded but not broken experience.

**Fix:** In `showApp()` or `loadData()`, if `customerMeta.forwardingStatus === 'pending_test'` and `activationPollingInterval` is null, start polling.

---

#### RISK-2: Silent Configuration Mutation While `active`

**Description:**  
When `forwarding_status === 'active'`, device type and forwarding mode cards are visible and clickable. Clicking them calls `persistSetupDeviceType()` or `persistForwardingMode()`. These functions only call `resetActivationTestContext()` if the status is `pending_test`. For `active` status, they silently update the DB fields without changing `forwarding_status`.

**Impact:** The dashboard shows different mode/device configuration than the actual phone carrier configuration. A user might change the mode in the dashboard, see no apparent effect, and be confused.

**Fix:** Either disable the device/mode selection cards when `forwarding_status === 'active'`, or add a confirmation prompt explaining that changing the configuration will require re-confirmation.

---

#### RISK-3: `forwarding_setup_completed` Never Reset

**Description:**  
`forwarding_setup_completed` is set to `true` by `confirmActivationTestCall()`, `activationSkipTest()`, and `persistForwardingSetupCompleted()`. It is never set to `false` – not on deactivation, not on configuration changes.

**Impact:**  
- After deactivation and re-activation with the same config: `canSkipActivationTest()` returns `true` (skip shortcut shown). This is acceptable behavior.
- After deactivation and re-activation with a *different* config: `canSkipActivationTest()` returns `false` (skip shortcut hidden, "Testanruf erforderlich" shown). This is correct behavior.
- The setup wizard's step s2 relies on `isForwardingSetupCompleted()`: a user who deactivated and then re-opened the wizard would see step s2 as "done" even though the forwarding is currently inactive.

**Severity:** Low. The field's semantics are "setup was completed at least once" rather than "forwarding is currently active." This is arguably acceptable, but the field name is misleading.

---

#### RISK-4: `candidateCall` Lost on Page Reload

**Description:**  
`candidateCall` is a JavaScript module-level variable. If the user is in `pending_test` and a candidate call has been identified (showing "Testanruf erkannt"), then reloads the page, `candidateCall` is cleared. The next `loadData()` call will re-detect the candidate (if `activationStartedAt` is still valid, which is subject to BUG-1 for reset cases). For the normal flow (no reset occurred), this re-detection works correctly.

**Severity:** Low for normal flow. Combined with BUG-1, becomes Medium for reset scenarios.

---

#### RISK-5: `window.location.href = 'tel:...'` on Desktop

**Description:**  
`activationStartSmartphone()` (line 5114) uses `window.location.href = 'tel:' + code` to open the dialer. This will not work on desktop browsers, and on some browsers/OS configurations may navigate away from the page (cancelling the pending-test state before the DB write completes – though the DB write happens before the `href` navigation).

**Impact:** Desktop users cannot use the mobile activation path. The current UI does not differentiate between mobile and desktop environments when showing the "Jetzt aktivieren" button.

**Severity:** Low (users on desktop are unlikely to be activating via GSM USSD codes), but the button should be labeled differently or hidden on desktop.

---

#### RISK-6: Stale Error Text in `loadData()` Error Handler

**Description:**  
Lines 3116–3121 contain error text matching logic for "airtable" and "401/unauthorized" with messages referencing Netlify cache/deploy operations. These are legacy error messages that may not apply to the current Supabase-based architecture.

**Severity:** Very low. Edge case error handling only.

---

## 6. Recommended Next Priorities

### Must-Fix

1. **Fix `activation_started_at = null` not persisted (BUG-1)**  
   Add handling in `customer-update-settings.js` to accept `null` for `activation_started_at` and pass it through to the update. This is a data integrity issue that can cause incorrect call detection after configuration resets.

2. **Fix deactivation checkbox reset by auto-refresh (BUG-2)**  
   Guard the checkbox/button reset in `renderActivationModule()` so it only resets if the deactivation section is being rendered for the first time (not on re-render of existing content). The simplest fix is to check if `#act-deact-checkbox` already exists before re-rendering `#act-deactivation-section`.

3. **Hide GSM code box for landline device type (BUG-3)**  
   In `renderActivationActionCard()`, skip rendering `act-action-code-box` when `setupDeviceType === 'landline'`.

### Should-Improve

4. **Restart activation polling after page reload in `pending_test` (RISK-1)**  
   After `loadData()` completes and `forwardingStatus === 'pending_test'`, check if `activationPollingInterval` is null and call `startActivationPolling()` if so.

5. **Disable/lock device and mode selection while `active` (RISK-2)**  
   Prevent accidental silent mutation of the active forwarding configuration. Either show a visual lock on the cards when active, or show a confirmation dialog before allowing changes.

6. **Fix `in_progress` state description (UX)**  
   Change "Aktivierung erfolgt durch den ersten eingehenden Anruf" (inaccurate) to "Starten Sie jetzt den Testanruf, um die Aktivierung abzuschließen." or equivalent accurate text.

7. **Fix "Testanruf durchführen" button behavior (UX)**  
   `activationSkipToTest()` only hides the skip block and scrolls. The button label implies an action that doesn't happen. Either rename to "Manuell testen" or chain it to actually initiate a test call.

### Future Enhancements

8. **Remove dead UI code and legacy setup wizard**  
   Remove or clearly archive the following: `renderActivationInstructions()`, `updateActivationStatusCard()`, `handleDashboardActivationPrimaryCta()`, `updateSetupExperienceProgress()`, `handleSetupExperiencePrimaryCta()`, `handleSetupExperienceWizardCta()`, the `#setup-wizard` HTML block, and all localStorage-based setup wizard logic. This would reduce the JS codebase by ~25–30% and eliminate maintenance confusion.

9. **Reconcile `forwarding_setup_completed` semantics**  
   Rename to `activation_confirmed_at_least_once` or reset it to `false` on deactivation. Clarify the setup wizard step s2 syncing (currently only removes the s2 flag if `forwarding_setup_completed` is false, but never adds it if true without localStorage).

10. **Unify state triplication**  
    The three-way mirroring of state (`customerMeta`, `context.customerRecord`, inline field updates) is error-prone. Consider a single source-of-truth function (e.g., `refreshCustomerMetaFromRecord()`) that is called after every `patchCustomerRecord()` response, using the returned `customer` object to synchronize all local state.

---

## 7. Appendix: Key Function Summary

| Function | Purpose | Status |
|----------|---------|--------|
| `getActivationUiState(meta)` | Maps DB fields to UI state | Active, correct |
| `renderActivationModule()` | Main render dispatcher | Active, has checkbox-reset bug |
| `renderActivationActionCard(meta)` | Renders action card (code, buttons) | Active, shows GSM code to landline users |
| `renderPendingTestCard(meta)` | Renders pending-test card with guidance | Active, correct |
| `renderDeactivationSection(meta)` | Renders deactivation section | Active, mobile/landline split correct |
| `renderActivationInstructions(deviceType)` | Renders into `#act-instructions` | **Dead – element does not exist** |
| `canSkipActivationTest(meta)` | Skip-test eligibility check | Active, logic correct |
| `activationSkipTest(event)` | Skip test, activate directly | Active, correct |
| `activationSkipToTest(event)` | Hides skip block, scrolls | Active, misleadingly named |
| `activationStartSmartphone(event, code)` | Enters pending_test, opens dialer | Active, correct |
| `activationStartLandlineTest(event)` | Enters pending_test (no dialer) | Active, correct |
| `confirmActivationTestCall(event)` | Confirms test, activates | Active, correct |
| `rejectActivationTestCall(event)` | Rejects candidate, keeps polling | Active, correct |
| `retryActivationCheck(event)` | Restarts polling, re-checks | Active, correct |
| `activationConfirmDeactivation(event)` | Confirms deactivation | Active, has checkbox-reset risk |
| `activationMobileDeactivate(event)` | Shows next-step, opens dialer | Active, intentionally does not change status |
| `resetActivationTestContext(recId, ctx)` | Resets from pending_test | Active, BUG-1 affects persistence |
| `persistSetupDeviceType(type)` | Persists device type | Active, resets if pending_test |
| `persistForwardingMode(mode)` | Persists forwarding mode | Active, resets if pending_test |
| `persistForwardingStatus(status)` | Persists forwarding status | Active, stale TODO comment |
| `persistForwardingSetupCompleted()` | Sets forwarding_setup_completed = true | Active (setup wizard only) |
| `findActivationCandidateCall(calls, ts)` | Detects candidate call by timestamp | Active, correct |
| `startActivationPolling()` | Starts 5s polling interval | Active, not started on page reload |
| `stopActivationPolling()` | Clears polling interval | Active, correct |
| `updateActivationStatusCard(records)` | Renders into `#dash-activation-card` | **Dead – element force-hidden** |
| `handleDashboardActivationPrimaryCta()` | Handler for hidden card button | **Dead** |
| `getForwardingCode(mode, voxeraNumber)` | Generates GSM USSD activation code | Active, returns mobile-only codes for all device types |
| `getForwardingDisableCode(mode)` | Generates GSM USSD disable code | Active, same caveat |

---

*Document generated from code analysis of commit state as of 2026-04-08. All line numbers are approximate and subject to change.*
