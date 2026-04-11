# Stacked PR Merge Audit (2026-04-11)

## Scope
This audit uses the current repository commit graph as the source of truth.

- Current branch: `work`
- Current HEAD: `d8ed11f` (merge of PR #239)
- Candidate older PR head commit analyzed: `2f10bae` (PR #237 content commit)
- Related newer PR content commit analyzed: `12e4e2d` (PR #239 content commit)

## Evidence

### 1) Main vs older PR ancestry check
`2f10bae` is already an ancestor of `HEAD`.

```bash
git merge-base --is-ancestor 2f10bae HEAD
# exit code 0
```

### 2) Files changed by older PR commit (`2f10bae`)
- `admin-panel/index.html`
- `admin-panel/netlify/functions/send-offer.js`
- `supabase/sql/2026-04-11_offer_system_v1.sql`

### 3) Files changed by newer PR commit (`12e4e2d`)
- `admin-panel/index.html`
- `admin-panel/netlify/functions/send-offer.js`
- `supabase/sql/2026-04-11_offer_customer_snapshot_structured.sql`

### 4) Overlap profile
There is file overlap on:
- `admin-panel/index.html`
- `admin-panel/netlify/functions/send-offer.js`

This overlap explains why an out-of-date stacked branch can report merge conflicts.

### 5) Main delta since old PR commit
`git diff --stat 2f10bae..HEAD` for impacted areas reports additional evolution after old changes were merged:
- substantial updates in `admin-panel/index.html`
- additional updates in `admin-panel/netlify/functions/send-offer.js`
- new migration file `supabase/sql/2026-04-11_offer_customer_snapshot_structured.sql`

## Conclusion
- Changes from the older PR commit (`2f10bae`) are already included in main history.
- Current conflicts are overlap/rebase-noise, not missing adoption of old PR logic.
- Safest path is to close the old PR as superseded and, if needed, open a tiny follow-up PR only for any newly discovered non-overlapping fix (none detected in this audit).
