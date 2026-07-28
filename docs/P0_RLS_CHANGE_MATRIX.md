# P0 RLS and Table Privilege Change Matrix

**Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

RLS policies and table GRANTs are independent controls. Service-role server operations do not justify permissive browser policies.

## RLS changes

| Table | P0 risk | Policy change | Preserved access | Live verification |
|---|---|---|---|---|
| `calls` | Broad browser/anon INSERT path | Remove INSERT/ALL policies assigned to PUBLIC, anon or authenticated; no browser INSERT policy | Existing SELECT/UPDATE policies untouched; service-role INSERT retained | Test all active ingestion paths and confirm no external browser writer |
| `notifications` | PUBLIC/anon INSERT exposure | Remove INSERT/ALL policies assigned to PUBLIC, anon or authenticated | Existing read/update policies untouched; service-role INSERT retained | Test backend post-call notification creation |
| `ai_change_requests` | `authenticated_read_all` permits cross-tenant access | Replace all policies with admin ALL and own-tenant CRUD policies | Admin access requires `is_admin(auth.uid())`; customers use `current_customer_id()` | Test customer A, customer B and an admin |
| `system_config` | Authenticated customers can read sensitive keys | Replace SELECT/ALL policies with `system_config_admin_select` | Admin and service-role reads | Confirm customer cannot read `prompt_master_l1`; server sync still works |

## Table privilege matrix after P0

| Table | Role | SELECT | INSERT | UPDATE | DELETE | Policy / bypass |
|---|---|---:|---:|---:|---:|---|
| `calls` | anon | unchanged/non-required | No | unchanged | unchanged | none for INSERT |
| `calls` | authenticated | existing | No | existing | existing | tenant RLS for permitted operations |
| `calls` | service_role | existing | Yes | existing | existing | service-role bypass |
| `notifications` | anon | unchanged/non-required | No | unchanged | unchanged | none for INSERT |
| `notifications` | authenticated | existing | No | existing | existing | live tenant read/update policies |
| `notifications` | service_role | existing | Yes | existing | existing | service-role bypass |
| `ai_change_requests` | anon | No | No | No | No | none |
| `ai_change_requests` | authenticated | Yes | Yes | Yes | Yes | own tenant or self-only admin helper |
| `ai_change_requests` | service_role | Yes | Yes | Yes | Yes | bypass |
| `system_config` | anon | No | — | — | — | none |
| `system_config` | authenticated | Yes | — | — | — | rows only through `system_config_admin_select` |
| `system_config` | service_role | Yes | unchanged | unchanged | unchanged | bypass |

## Helper effect on RLS

Policies continue to call `public.is_admin(auth.uid())`. The hardened function preserves this path while preventing authenticated callers from checking arbitrary UUIDs. Customer policies continue to use `public.current_customer_id()`.

## Data impact

The migration does not modify customer, call, notification, AI request, contract, invoice or configuration rows. The only row mutation possible is when an authenticated caller invokes `ensure_user_profile`: an unbound `public.users` profile may be bound to exactly one server-created `public.customers.auth_user_id` match. Caller-supplied tenant hints cannot cause this assignment.
