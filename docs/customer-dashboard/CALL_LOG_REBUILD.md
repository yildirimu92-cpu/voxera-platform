# Customer Call Log Rebuild

## Decision

The existing customer-facing call log is replaced at source level. No additional DOM observers, CSS override layers, duplicate renderers or polling patches may be added.

Call data, recordings, Supabase rows, notifications and backend intake remain intact. Only the customer-facing presentation and its rendering ownership are rebuilt.

## Single owner

The new owner must exclusively render these three sections on **Heute**:

1. **Aktiver Anruf** — only while a call is ringing or active.
2. **Offene Aufgaben** — only calls or manual tasks with a real next action.
3. **Letzte Anrufe** — compact chronological history, one row per canonical call.

The previous sections and renderers for `Aufmerksamkeit`, `Heute passiert`, `Anrufe heute`, the live-call row and the duplicate live toast must be removed when the new owner is connected.

## Lifecycle

The primary lifecycle comes from `customer-dashboard/shared/customer-call-view-model.js`:

- `live` → Anruf läuft
- `analysing` → Wird ausgewertet
- `new` → Neu
- `working` → In Bearbeitung
- `planned` → Rückruf geplant
- `done` → Erledigt
- `archived` → Archiviert

Category, outcome and lead quality are secondary metadata and may not compete visually with the lifecycle.

## Rendering rules

- one canonical call ID produces one visible call
- an active call never appears simultaneously in history or open tasks
- short empty/stale polls do not clear an active call
- unchanged state must not replace the DOM
- no `innerHTML` replacement on every polling tick
- no red alarm styling for a normal live call
- no live toast when the live card is visible
- all timestamps use `Europe/Zurich`

## Desktop structure

```text
Aktiver Anruf (conditional)
Offene Aufgaben (conditional)
Letzte Anrufe
```

## Mobile structure

The same information order is retained. Rows are compact, fully clickable and must not be covered by the fixed navigation.

## Removal checklist

The implementation PR must identify and remove the replaced source owners in `customer-dashboard/index.html` in the same change. The rebuild is incomplete while any old owner can still write into the new containers.
