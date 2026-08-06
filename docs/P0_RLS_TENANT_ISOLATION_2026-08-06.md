# P0 RLS Tenant Isolation Hardening — 2026-08-06

**Baseline:** `codex/restore-customer-launch-checks@a4e45bf2bcbd86d3b1a17ff43ff183a7b5f9e62b`
**Source finding:** `SECURITY_BESTANDSAUFNAHME_2026-08-06.md`, P0-1, P0-2, P0-5
**Migration:** `supabase/migrations/2026-08-06_p0_rls_tenant_isolation_hardening.sql`

No step in this document has been executed against production. This session has no
Supabase credentials and no database connection available — every query below must
be run manually by someone with production SQL Editor access.

## Scope

| Finding | Table(s) | Problem | Fix |
|---|---|---|---|
| P0-1 | `users` | `users_self_update` policy restricted rows but not columns; a customer could set their own `customer_id` to any value and read/write any other tenant | Revoke `UPDATE` on `users` from `authenticated` entirely; drop the policy |
| P0-5 | `customers`, `calls` | `..._customer_update_own` policies restrict rows but not columns; a customer could overwrite `ai_instructions`, `status`, `duration_seconds`, `transcript`, `call_summary` on their own row | Revoke table-wide `UPDATE`, re-grant `UPDATE` only on the columns the dashboard actually writes |
| P0-2 | `contracts`, `subscriptions`, `invoices`, `offers`, `customer_addons` | No RLS, no GRANT restriction anywhere in the repository; readable/writable by any anon-key holder | Enable RLS, revoke broad grants, add admin-all + customer-own-row-select policies |

## Local empirical verification performed

Before this PR, the migration was applied to a disposable local PostgreSQL 16
instance (this session's sandbox, not Supabase) against a minimal schema
reconstructed from the column/type evidence in this repository's own migrations
(`auth.users`, `public.users`, `public.customers`, `public.calls`,
`public.contracts`, `public.subscriptions`, `public.invoices`, `public.offers`,
`public.customer_addons`, `is_admin`, `current_customer_id`,
`is_customer_entitled`, and the pre-migration `users_self_update` /
`*_customer_update_own` policies as they exist today). This is **not** a
substitute for the live preflight/post-migration run — it cannot see real
production grants, triggers or data — but it does prove the migration SQL is
mechanically valid PostgreSQL and behaves as designed for the modeled case:

- migration applied cleanly inside `begin`/`commit`, no errors;
- all 28 post-migration `PASS`/`FAIL` checks returned `PASS`;
- as customer A (`SET ROLE authenticated` + a `request.jwt.uid` GUC standing in
  for the JWT claim): `UPDATE users SET customer_id = 'cust_b'` failed with
  `permission denied for table users` and `customer_id` stayed `cust_a`;
- as customer A: `UPDATE calls SET duration_seconds = 0` failed with
  `permission denied for table calls`; `UPDATE calls SET notes_customer_voxera = '...'`
  on the same row succeeded;
- as customer A: `SELECT customer_id FROM contracts` / `FROM invoices` returned
  only `cust_a`, never `cust_b`;
- as customer A: `UPDATE invoices SET status = 'paid'` affected 0 rows (no
  customer UPDATE policy exists on `invoices`, so the table-wide grant alone
  does not let them write);
- as the admin identity: `SELECT customer_id FROM contracts` returned both
  tenants, and `UPDATE invoices SET status = 'open'` succeeded — the exact
  `admin-panel/index.html:12838` dependency this migration was designed to
  preserve;
- as `anon`: `SELECT * FROM invoices` failed with `permission denied for table invoices`;
- `customer_addons` (stubbed with `customer_id uuid`, matching the repository's
  declared type, against `customers.id text`): the `::text`-cast policy
  evaluated without error and correctly returned zero visible rows for an
  unrelated UUID, confirming the cast survives the live type mismatch either way.

The disposable database, roles and local PostgreSQL service were torn down
after the test; nothing from this run persists.

## Why database access could not be verified live

Both requested verification queries (RLS-enablement state, table grants) are included
as preflight query (1) and (3) in `supabase/verification/p0_rls_tenant_isolation_preflight.sql`.
This mirrors exactly how the prior P0 round in this repository was handled — see
`docs/P0_SECURITY_IMPLEMENTATION_REPORT.md`: *"The SQL migration was not executed
against Supabase and was not parsed by a live PostgreSQL server."* Run the preflight
script first and paste the result back before applying the migration.

## P0-1 detail: `users.customer_id`

Repository-wide search (`grep -rn "from('users')" --include=*.html`) found exactly one
call site, a `SELECT` in `customer-dashboard/index.html:12613` (`resolveCustomerContext`).
No `.update()`/`.upsert()` on `public.users` exists in either dashboard's frontend.
Tenant binding is performed exclusively by
`public.ensure_user_profile(text,text,text)` (`SECURITY DEFINER`), which the July P0
migration already hardened to ignore all caller-supplied parameters and bind only via
a unique `customers.auth_user_id = auth.uid()` match. There is therefore no
identified legitimate use for a customer-writable `users.customer_id`, so the fix
revokes `UPDATE` outright rather than narrowing it to a column allowlist — the same
revoke also closes `role` and `is_admin` as self-service targets, though those two
were never load-bearing for authorization (`public.is_admin()` reads `public.admins`,
not `users.is_admin`).

**Residual risk:** if a live environment has a `users.email` self-update path or
similar that this repository checkout does not contain, `UPDATE` will start failing
for it after this migration. Preflight query (7) gives a baseline row count; if the
Advisor's environment has a known legitimate write path not found here, say so before
applying and it will be added as a column grant instead of a full revoke.

## P0-5 detail: `customers` / `calls` column scope

The column allowlists were read directly off every `.from('customers').update(...)`
and `.from('calls').update(...)` call site in `customer-dashboard/index.html` — not
inferred from what "should" be writable:

| Table | Call site | Columns written |
|---|---|---|
| `customers` | `index.html:15262` (profile name save) | `contact_first_name`, `updated_at` |
| `customers` | `index.html:15335` (in-app notification prefs) | `in_app_notification_settings` |
| `calls` | `index.html:18893`, `18912` (read/unread toggle) | `read_at`, `updated_at` |
| `calls` | `index.html:20465`, `32358` (customer notes) | `notes_customer_voxera`, `updated_at` |
| `calls` | `index.html:20779` (mark done) | `dashboard_status`, `updated_at` |

No other column is written directly by either dashboard. Row-level policies
(`customers_customer_update_own`, `calls_customer_update_own`) are unchanged — they
already correctly restrict to the caller's own, entitled tenant; this migration only
narrows which columns that row-level grant applies to.

**Explicitly blocked by this change (confirmed against the audit's P0-5 findings):**
`customers.ai_instructions`, `customers.ai_fallback_escalation`,
`customers.ai_response_constraints`, `customers.status`, `customers.plan`,
`customers.subscription_id`, `customers.payment_status`, `customers.auth_user_id`,
`calls.duration_seconds`, `calls.transcript`, `calls.transcript_json`,
`calls.call_summary`, `calls.live_status`.

## P0-2 detail: the five business tables

All five get the same shape: `ENABLE ROW LEVEL SECURITY`, revoke all existing
grants from `public`/`anon`/`authenticated`, re-grant only what's needed, then an
`is_admin(auth.uid())` ALL policy plus a customer own-row SELECT policy.

**Scope decision — no entitlement gate on the new policies.** `customers`, `calls`,
`cases` and `onboarding` gate customer SELECT through `is_customer_entitled()` in
addition to ownership. The new policies here use ownership only
(`customer_id = current_customer_id()`), without that entitlement check. Reasoning:
whether a customer whose contract has lapsed should keep read access to their
historical invoices and contracts is a product/billing decision, not a vulnerability
— folding it into a security-only migration risks tying an unrelated business call to
this PR's review. If the business wants entitlement-gating here too, it's a one-line
follow-up per policy (`and public.is_customer_entitled(customer_id)`), listed below as
optional.

**`invoices` needs table-wide `UPDATE`, not `SELECT`-only.** Unlike the other four
tables, `admin-panel/index.html:12838` writes directly to `invoices` from the admin's
own authenticated browser session (`authClient.from('invoices').update({status,
updated_at}).eq('id', invoiceId)`) after `mail-dispatch` succeeds — this is not routed
through a service-role Netlify Function. `UPDATE` is granted table-wide to
`authenticated` so this keeps working; the actual gate is the
`invoices_admin_all` policy (`using (is_admin(auth.uid()))`), since customers receive
no `UPDATE` policy on `invoices` at all — the grant alone does not let a customer
session write anything.

**`customer_addons` type note.** The repository's schema
(`2026-05-09_plan_config_addons_provisioning.sql`) declares
`customer_addons.customer_id` as `uuid`, while `customers.id` (and
`current_customer_id()`) is `text`. No later migration in the repo corrects this.
The new policy casts explicitly (`customer_id::text = current_customer_id()`) so it
is correct regardless of which type is actually live. Preflight query (6) reports the
live FK/type pairing — if it confirms the mismatch, that is a separate data-model
defect to fix in its own migration, not part of this security fix.

## Deployment sequence

1. Run `supabase/verification/p0_rls_tenant_isolation_preflight.sql` in the Supabase
   SQL Editor. Save the full output.
2. Confirm query (8) shows `is_admin`, `current_customer_id` and
   `is_customer_entitled` all present — the migration depends on the first two;
   `is_customer_entitled` is referenced only in this document's optional follow-up,
   not in the migration itself.
3. Confirm query (7)'s row counts look sane for the environment (no action required
   unless the Advisor knows of an external `users.customer_id` writer this repo
   checkout doesn't show).
4. Review query (6). If it returns a row, the `customer_addons` uuid/text mismatch is
   confirmed live; the migration's `::text` cast already accounts for this, no
   preflight blocker.
5. Apply `supabase/migrations/2026-08-06_p0_rls_tenant_isolation_hardening.sql` once,
   in a single SQL Editor run (it is wrapped in `begin`/`commit`).
6. Immediately run `supabase/verification/p0_rls_tenant_isolation_post_migration.sql`.
   Every row must read `PASS`.
7. Smoke-test in a deploy preview before production traffic:
   - Customer A cannot read customer B's `contracts`/`invoices`/`offers`/`subscriptions`/`customer_addons` rows.
   - Customer A can still read their own rows in all five tables.
   - Customer profile-name save and in-app-notification toggle still work.
   - Call read/unread toggle, customer notes save, and "mark done" still work.
   - Admin invoice send-and-mark-open (`admin-panel/index.html:12838` path) still
     updates `invoices.status` to `open`.
   - A customer attempting `sb.from('customers').update({status:'live'})` or
     `sb.from('customers').update({ai_instructions:'x'})` on their own row from the
     browser console gets rejected.
   - A customer attempting `sb.from('users').update({customer_id:'<other>'})` gets
     rejected.

## Rollback

If the migration fails before `COMMIT`, PostgreSQL rolls back the whole transaction
automatically. After a successful commit, restore the exact prior policies and grants
from the preflight snapshot (queries (2) and (3)) in one transaction. Do not restore
the removed grants merely to unblock a client error — fix the client's column list or
tenant scoping instead; the preflight snapshot exists so a live dependency this
repository checkout didn't show can be re-added narrowly, not broadly.

## Not in scope for this PR

- Entitlement-gating the five new P0-2 policies (see scope decision above) — optional
  business-policy follow-up, one line per policy.
- Correcting the `customer_addons.customer_id` uuid/text schema mismatch — separate,
  non-security migration.
- Explicit `INSERT`/`DELETE` revokes on `customers` for `authenticated` — already
  blocked today by RLS default-deny (no INSERT/DELETE policy exists), so this is
  hygiene, not a fix; not touched here to keep the diff minimal and traceable to the
  three named P0 items.
- P0-3 (`ai-daily-report.js` token check), P0-4 (`twilio-status-callback.js`
  signature) and the P1/P2 items from the audit — separate PRs.
