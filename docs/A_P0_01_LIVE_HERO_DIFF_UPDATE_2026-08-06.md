# A-P0-01: Live-Call Hero Diff-Based Update — 2026-08-06

**Baseline:** `origin/codex/restore-customer-launch-checks` (includes merged PR #805, #806)
**Source finding:** Design-Audit PR #804, A-P0-01
**File changed:** `customer-dashboard/index.html` (`updateLiveHero()`)

No deploy has been performed. Verification described below ran entirely in this
sandbox against a real Chromium browser (Playwright), not against the deployed site.

## Root cause (as given)

`updateLiveHero()` is invoked both by the ~9s poll (`TEMP_CALL_POLL_INTERVAL_MS`) and
by the Supabase realtime channel (`setupDashboardRealtime()`), so it can fire several
times a minute even when nothing about the live call has changed. Every invocation
unconditionally did:

```js
var existing = document.getElementById('live-call-row');
if (existing) existing.remove();
// ...then always built a brand new <div id="live-call-row"> from scratch.
```

`#live-call-row` and its children carry four CSS animations, all of which restart
whenever the element they're attached to is newly created:

- `#live-call-row` itself: `animation: liveRowEnter .3s cubic-bezier(.16,1,.3,1) both;`
  — a one-shot fade/slide-in entrance transition. This is very likely the dominant
  visible symptom: a 0.3s "pop in" replaying every single poll/realtime tick reads as
  a constant flicker/jump, not just a subtle glow reset.
- `#live-call-row::after`: `animation: vxLiveBar 1.4s ease-in-out infinite;` (the red
  left-edge bar's opacity pulse)
- `.vx-live-pulse`: `animation: vxLiveRing 1.5s ease-in-out infinite;` (the expanding
  ring around the avatar)
- `.vx-live-sub-dot`: `animation: liveDotPulse 1.2s ease-in-out infinite;` (the small
  status dot)

## Fix

`updateLiveHero()` now branches on whether the live call and its rendered content
actually changed since the last render, instead of always tearing down and rebuilding:

1. **No live call** → remove the row if present (unchanged from before).
2. **Same call (`rec.id === _liveHeroCurrentId`), same rendered content** (a new
   `fingerprint = rec.id + '|' + caller + '|' + company` string equals the one stored
   from the last render) → **do nothing**. This is the fix: the DOM node, and every
   animation running on it, is left completely untouched.
3. **Same call, but `caller`/`company` changed** (e.g. the caller's name resolves
   mid-call) → patch `.vx-live-name` and `.vx-live-avatar`'s `textContent` in place on
   the *existing* node. The node itself, and therefore its running animations, is
   never removed.
4. **A different call became live** (or the row was lost some other way — see "Known
   adjacent issue" below) → full rebuild, exactly as before. This case is supposed to
   grab attention with the entrance animation, so replaying it here is correct
   behavior, not the bug.

New module-level state `_liveHeroLastFingerprint` (alongside the existing
`_liveHeroCurrentId`) tracks what's currently rendered so case 2 can be detected.

Two module-level variables already existed and are unchanged in behavior:
`_liveHeroTimer` (declared and `clearInterval`'d in this function, but never actually
started anywhere in the file — appears to be dead code from an earlier iteration; left
untouched, out of scope for this fix) and `_liveHeroNotified` (the "toast/sound once
per call" guard, already idempotent, unaffected by this change since the
notify-once block only runs in the case-4 rebuild branch, matching its original
placement and intent).

## Known adjacent issue (not fixed here, out of scope)

`renderDashPriorityList()` (`index.html:9947`) rebuilds `#dash-priority-list`'s
`innerHTML` via `vxSetHtmlIfChanged()` whenever the *task/call list* content changes,
and that `innerHTML` write does not include `#live-call-row` (it's inserted
separately by `updateLiveHero`). If a list-content change coincides with an active
live call, that `innerHTML` write destroys `#live-call-row` outright, and the
function's own recovery step (`el.insertBefore(existingLive, ...)` at line 10072)
can't find it anymore because `document.getElementById('live-call-row')` runs *after*
the destructive write. In today's code this self-heals within one polling/realtime
cycle because `updateLiveHero()` always rebuilds anyway; with this fix, case 4 above
(`existing` is `null` but `_liveHeroCurrentId` still matches) still triggers a full
rebuild, so the self-healing behavior is preserved — but the row would still blink out
for one cycle in that specific interleaving. This is a different bug in a different
function and wasn't part of the given root cause; flagging it here rather than folding
an unrequested fix into this PR.

## Verification performed

No Netlify/browser access to the live site in this session. Verified instead with a
real headless Chromium instance (Playwright, pre-installed in this environment)
against the **actual, unmodified** `updateLiveHero()` source — extracted directly out
of the edited `index.html` by brace-matching (not retyped/reimplemented) — running
against the **actual CSS rules** for `#live-call-row` and its animations, also
extracted directly out of `index.html`. Dependencies of the function
(`isActivationCallCategory`, `parseCallTimestamp`, `_esc`, `vxGetCallStableId`,
notification helpers, etc.) were stubbed with minimal no-ops since they're unrelated
to the change under test.

Nine checks, all passing against the fixed code:

1. Two calls to `updateLiveHero()` with the identical record → the DOM node is
   provably the same element (a custom marker property set after the first render is
   still present after the second call).
2. Real `Element.getAnimations()` `currentTime` readings on that node's entrance and
   infinite animations, taken before and after the second (unchanged) call, show the
   animations kept advancing monotonically — they were **not** reset to near-zero.
3. A call with the same `rec.id` but a changed `company_name` patches
   `.vx-live-name`'s text in place, on the same DOM node, without resetting the
   running animations.
4. A call for a genuinely different `rec.id` **does** produce a new DOM node (the
   marker is gone) with the new call's content correctly rendered — proving case 4
   (new live call) still gets its attention-grabbing rebuild.
5. Calling with no live-eligible records removes `#live-call-row`.

**Negative control, to confirm the test suite actually detects the bug:** the same
nine checks were run against the original, unpatched `updateLiveHero()` (extracted the
same way from the pre-fix commit). Five checks failed exactly where expected:

```
FAIL — scenario1: same DOM node preserved (custom marker survived)
FAIL — scenario1: animations kept running, did not reset to ~0 (the actual flicker bug)
       before=[300, 699.95, 699.95, 699.95]  after=[33.35, 33.35, 33.35, 33.35]
FAIL — scenario2: content-changed update patches same node in place (marker survived)
FAIL — scenario2: animations still not restarted by a content patch
       [0, 0, 0, 0]
```

That `currentTime` drop from ~700ms to ~33ms (and to exactly `0` after the
content-changed case) on an *identical, unchanged* re-render is the flicker,
reproduced and measured directly rather than inferred from reading the code. Both the
"identical repeat" and "content changed" cases fail on the original and pass on the
fix; the "different call" and "call ended" cases pass on both, confirming the test
isolates the actual bug rather than just disagreeing with the old code everywhere.

All test files, the harness page, and the extracted CSS/JS ran from and were removed
from the sandbox's scratch directory; nothing was committed.

## Deploy-preview checklist (for whoever applies this)

- [ ] Open the customer dashboard while a real (or test) call is live; confirm the
      live-call row appears once and its pulse/ring/dot/bar animations run smoothly
      without visibly restarting every ~9s.
- [ ] Confirm the row *does* re-animate in (the `liveRowEnter` pop-in) when a new call
      becomes live while a different one was already showing.
- [ ] Confirm the row disappears promptly when the call ends.
- [ ] Confirm clicking the row still shows the "Live-Anruf läuft" toast (unchanged
      `onclick` behavior, only reachable via the full-rebuild path today, so this also
      confirms case 4 still wires up correctly).

## Rollback

Pure code change, no migration, no schema. Reverting the commit and redeploying the
previous build is a complete rollback.
