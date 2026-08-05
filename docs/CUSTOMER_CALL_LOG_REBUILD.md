# Customer Call Log Rebuild

## Decision

The existing customer-facing call log is replaced by one canonical runtime owner. Call data, recordings, Supabase rows, notifications and backend intake remain intact.

## Single owner

`customer-dashboard/shared/customer-runtime-call-log-owner.js` now owns these sections on **Heute**:

1. **Anruf läuft / Wird ausgewertet** — conditional lifecycle card.
2. **Offene Aufgaben** — only calls with a real next action.
3. **Letzte Anrufe** — compact chronological history, one row per canonical call.

The owner is loaded sequentially after:

- `customer-call-view-model.js`
- `customer-call-log-model.js`

through `customer-runtime-design-foundation.js`.

## Replaced output

Once the owner connects, it removes the legacy containers for:

- `Aufmerksamkeit`
- `Heute passiert`
- `Anrufe heute`
- `Heute erledigt`

The legacy render entry points are replaced by the single owner so subsequent polling updates the canonical state instead of rebuilding four competing lists.

## Lifecycle

- `live` → Anruf läuft
- `analysing` → Wird ausgewertet
- `new` → Neu
- `working` → In Bearbeitung
- `planned` → Rückruf geplant
- `done` → Erledigt
- `archived` → Archiviert

Category, outcome and lead quality remain secondary metadata.

## Rendering rules

- one canonical call ID produces one visible call
- active call never appears simultaneously in history or tasks
- short empty/stale polls do not clear an active call
- unchanged state does not replace the DOM
- no red alarm styling for a normal live call
- timestamps use `Europe/Zurich`
- Desktop and Mobile use the same information order

## Verification

The Deploy Preview must show only the new three-part structure. The PR stays draft until Desktop and Mobile screenshots confirm that no legacy section remains and a real live call does not flicker.
