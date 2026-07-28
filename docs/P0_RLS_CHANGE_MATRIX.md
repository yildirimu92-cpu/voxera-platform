# P0 RLS and Table Privilege Change Matrix

**Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

RLS policies and table GRANTs are treated as independent requirements. Service-role server calls do not require anonymous or generally authenticated permissive policies.

## RLS changes

| Table | Verified risk / repository finding | P0 policy change | Preserved access | Live verification |
|---|---|---|---|---|
| `calls` | Live policy reportedly permits system/admin insert with a broad check. Repository INSERT/upsert paths found only in server-side Functions; no browser INSERT path was found. | Drop all INSERT/ALL policies assigned to PUBLIC, anon or authenticated. Create no browser INSERT policy. | Existing SELECT/UPDATE policies are left untouched. Service-role INSERT grant retained. | Confirm no external browser/mobile client inserts directly. Test Twilio and ElevenLabs ingestion after migration. |
| `notifications` | Live PUBLIC/anon insert exposure reported. Repository INSERT found in server-side `elevenlabs-post-call.js`. | Drop INSERT/ALL policies assigned to PUBLIC, anon or authenticated. Create no browser INSERT policy. | Existing read/update policies are left untouched. Service-role INSERT grant retained. | Confirm no external direct client notification creation. Test post-call notification creation. |
| `ai_change_requests` | Live `authenticated_read_all` permits cross-tenant access. | Replace all existing policies with admin ALL plus customer own SELECT/INSERT/UPDATE/DELETE policies using `customer_id = current_customer_id()`. | Real admins retain full access through `is_admin(auth.uid())`; customers retain own-tenant CRUD. | Confirm table has `customer_id`; test two customer accounts and one admin. |
| `system_config` | General authenticated SELECT exposes sensitive configuration including `prompt_master_l1`. Repository usage found only in a service-role Netlify Function. | Remove every SELECT/ALL policy and create `system_config_admin_select`. No customer allowlist is introduced because no product dependency was proven. | Authenticated admins can read; service role can read; normal customers receive no rows. | Test admin direct read, customer direct read and ElevenLabs sync. |

## Table privilege matrix after P0

`—` means no privilege is required by this package. Existing non-P0 privileges are not deliberately changed unless the migration explicitly revokes and re-grants the table.

| Table | Role | SELECT | INSERT | UPDATE | DELETE | Required policy / bypass | Repository-verified need |
|---|---|---:|---:|---:|---:|---|---|
| `calls` | anon | — | No | — | — | none | none found |
| `calls` | authenticated | existing grant unchanged | No | existing grant unchanged | existing grant unchanged | tenant RLS for existing operations | dashboard reads/updates own calls |
| `calls` | service_role | existing | Yes | existing | existing | service-role bypass | webhook and server ingestion |
| `notifications` | anon | — | No | — | — | none | none found |
| `notifications` | authenticated | existing grant unchanged | No | existing grant unchanged | existing grant unchanged | existing tenant policies, live-dependent | dashboard notification consumption is live-dependent |
| `notifications` | service_role | existing | Yes | existing | existing | service-role bypass | post-call backend insert |
| `ai_change_requests` | anon | No | No | No | No | none | none |
| `ai_change_requests` | authenticated | Yes | Yes | Yes | Yes | own-tenant policies or admin policy | customer request workflow plus admin processing |
| `ai_change_requests` | service_role | Yes | Yes | Yes | Yes | service-role bypass | backend compatibility |
| `system_config` | anon | No | — | — | — | none | none |
| `system_config` | authenticated | Yes | — | — | — | `system_config_admin_select` | admin-only direct read |
| `system_config` | service_role | Yes | existing unchanged | existing unchanged | existing unchanged | service-role bypass | ElevenLabs prompt assembly |

## Policy replacement details

### `ai_change_requests`

Created policies:

- `ai_change_requests_admin_all`
- `ai_change_requests_customer_select_own`
- `ai_change_requests_customer_insert_own`
- `ai_change_requests_customer_update_own`
- `ai_change_requests_customer_delete_own`

All pre-existing policies on this table are removed before the canonical set is recreated. This is required because PostgreSQL permissive policies are OR-combined; leaving `authenticated_read_all` would defeat tenant isolation.

### `system_config`

All SELECT and ALL policies are removed before `system_config_admin_select` is created. Retaining an unknown permissive SELECT policy would continue exposing `prompt_master_l1`.

## Data impact

The migration does not change customer, call, notification, AI request, contract, invoice or configuration rows. It changes only RLS enablement, policy definitions, function definitions/ACLs and table privileges.
