# Admin + Customer Operational Data: Supabase SSOT

## Canonical source of truth

For operational domains shared between **Admin Portal** and **Customer Dashboard**, Supabase is the authoritative source:

- `customers`
- `calls`
- `cases`
- `users`
- `admins`

Additional lifecycle/commercial tables (for derived views) are also read from Supabase (`onboarding`, `subscriptions`, `offers`, `contracts`, `invoices`, `invoice_items`).

## Admin Portal operational policy

- Admin operational reads are loaded from Supabase only in `loadDataFromSupabase()`.
- Admin operational writes use Netlify functions backed by `@supabase/supabase-js` (e.g. `admin-mutate`, `cases-create`, `cases-update`, `create-customer`).
- If canonical operational reads fail (`customers`, `calls`, `cases`) Admin boot fails instead of silently continuing with partial/alternative data.
- Offline/demo fallback is **not** allowed for operational data.

## Airtable policy

- Airtable is not allowed as an authoritative operational source for Admin customer/call/case paths.
- Any future Airtable usage must be downstream-only, explicitly documented, and non-authoritative.

## Cross-surface regression check

Run the static consistency scan:

```bash
node scripts/verify-supabase-ssot.mjs
```

This verifies:

1. Admin frontend has no Airtable references.
2. Admin and Customer frontends both read `customers`, `calls`, and `cases` via Supabase table queries.
3. Core Admin write functions are Supabase-backed and contain no Airtable references.
