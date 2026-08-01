# Billing UI consolidation

This refactor replaces overlapping billing action runtimes with one idempotent implementation.

Removed from runtime loading:

- `admin-runtime-billing-actions-compact.js`
- `admin-runtime-billing-actions-v2.js`

Replacement:

- `admin-runtime-billing-ui-consolidated.js`

The consolidated runtime uses one debounced `MutationObserver`, removes duplicate actions, and renders one stable action bar for invoice rows and invoice modals.
