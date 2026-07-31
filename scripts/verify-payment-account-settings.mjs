import fs from 'node:fs';

const runtime = fs.readFileSync('admin-panel/shared/admin-runtime-payment-account.js', 'utf8');
const endpoint = fs.readFileSync('admin-panel/netlify/functions/admin-payment-account.js', 'utf8');
const migration = fs.readFileSync('supabase/sql/2026-08-01_payment_accounts_qr_billing.sql', 'utf8');
const loader = fs.readFileSync('admin-panel/shared/offer-brand.js', 'utf8');

const checks = [
  ['payment account table', migration.includes('CREATE TABLE IF NOT EXISTS public.payment_accounts')],
  ['invoice snapshot', migration.includes('payment_account_snapshot jsonb')],
  ['RLS enabled', migration.includes('ENABLE ROW LEVEL SECURITY')],
  ['IBAN validation', endpoint.includes('function validIban') && endpoint.includes('mod97')],
  ['QR IBAN validation', endpoint.includes('function isQrIban') && endpoint.includes('30000')],
  ['QRR pairing enforced', endpoint.includes("reference_type === 'QRR'")],
  ['secured admin caller', endpoint.includes('requireAdminCaller')],
  ['audit entry', endpoint.includes("payment_account.update")],
  ['settings UI', runtime.includes('Zahlungskonto & QR-Rechnung')],
  ['masked IBAN', runtime.includes('maskIban')],
  ['Stripe disabled default', runtime.includes('stripe_link_enabled:false')],
  ['runtime loaded', loader.includes('admin-runtime-payment-account.js')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Payment account verification failed:', failed.map(([name]) => name).join(', '));
  process.exit(1);
}
console.log(`Payment account verification passed (${checks.length} checks).`);
