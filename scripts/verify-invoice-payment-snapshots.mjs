import fs from 'node:fs';

const service = fs.readFileSync('admin-panel/netlify/functions/_lib/invoice-payment-context.js', 'utf8');
const activation = fs.readFileSync('admin-panel/netlify/functions/_lib/contract-activation-service.js', 'utf8');
const migration = fs.readFileSync('supabase/sql/2026-08-01_invoice_engine_payment_snapshots.sql', 'utf8');

const checks = [
  ['loads active payment account', service.includes(".from('payment_accounts')") && service.includes(".eq('is_active', true)")],
  ['stores creditor snapshot', service.includes('payment_account_snapshot: creditorSnapshot(account)')],
  ['stores customer snapshot', service.includes('customer_snapshot: debtorSnapshot(customer)')],
  ['stores line item snapshot', service.includes('line_items_snapshot: itemsSnapshot')],
  ['forces bank transfer billing', service.includes("billing_provider: 'invoice'") && service.includes("payment_method: 'bank_transfer'")],
  ['uses account payment terms', service.includes('payment_terms_days') && service.includes('due_at: addDays')],
  ['removes stripe checkout linkage', service.includes('stripe_checkout_session_id: null')],
  ['activation applies snapshots', activation.includes('applyContractInvoicesPaymentContext')],
  ['migration adds immutable snapshots', migration.includes('customer_snapshot jsonb') && migration.includes('line_items_snapshot jsonb')],
  ['migration indexes due invoices', migration.includes('idx_invoices_due_status')]
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
if (failed.length) process.exit(1);
