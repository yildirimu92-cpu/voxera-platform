# Admin lifecycle + RBAC (server-side)

This note documents the hardened admin lifecycle path used by `admin-mutate` and the shared auth helper.

## Canonical roles

The backend canonical role set is:

- `owner`
- `admin`
- `support`

Legacy values are normalized server-side:

- `super-admin` / `superadmin` -> `owner`
- `ops` -> `admin`

Capabilities are enforced on the server boundary (`require-admin.js` + `admin-mutate.js`):

- `owner`: full capabilities, including `admin:manage`
- `admin`: operational write capabilities (no `admin:manage`)
- `support`: customer-only capability

## Admin lifecycle states

Canonical states:

- `active` (can execute privileged mutations)
- `disabled` (blocked from privileged mutations)

`requireAdminCaller()` now blocks non-active admins before action handling.

## Provisioning and lifecycle mutations

All admin lifecycle mutations are server-side in `admin-mutate`:

- `admins.create`
  - Validates caller capability (`admin:manage`)
  - Creates or finds auth user server-side
  - Upserts `admins` row with canonical role + `active` status
  - Writes `admin_lifecycle_audit`
- `admins.updateRole`
  - Validates caller capability (`admin:manage`)
  - Updates role server-side
  - Writes `admin_lifecycle_audit`
- `admins.setStatus`
  - Validates caller capability (`admin:manage`)
  - Handles disable / re-enable server-side
  - Prevents self-disable
  - Writes `admin_lifecycle_audit`

## Auditability

Lifecycle mutations are attributed in `admin_lifecycle_audit` with:

- actor (`actor_admin_id`, `actor_role`)
- target (`target_admin_id`)
- previous/new role and status
- mutation timestamp (`happened_at`)
- optional metadata payload (`meta`)
