import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const mail = read('admin-panel/netlify/functions/invoice-mail-dispatch.js');
const runtime = read('admin-panel/shared/admin-runtime-invoice-only-ch.js');
const paymentSettings = read('admin-panel/shared/admin-runtime-payment-account.js');
const qrPdf = read('admin-panel/netlify/functions/_lib/swiss-qr-bill.js');
const bootstrap = read('admin-panel/shared/offer-brand.js');
const migration = read('supabase/sql/2026-08-01_invoice_only_billing_disable_payment_links.sql');

const checks = [
  ['invoice mail endpoint is admin protected', mail.includes('requireAdminCaller')],
  ['invoice mail requires a generated QR PDF', mail.includes('qr_invoice_missing') && mail.includes('invoice.pdf_url') && mail.includes('invoice.qr_payload')],
  ['invoice PDF is exposed as an attachment', mail.includes('attachments: [{') && mail.includes("content_type: 'application/pdf'")],
  ['invoice mail has no payment-link payload', !/\bpayment_link\s*:/.test(mail)],
  ['invoice mail is explicitly invoice-only', mail.includes("billing_provider: 'invoice'") && mail.includes("payment_method: 'swiss_qr_invoice'")],
  ['invoice mail uses Swiss locale and timezone', mail.includes("locale: 'de-CH'") && mail.includes("timezone: 'Europe/Zurich'")],
  ['legacy invoice mail calls are redirected', runtime.includes("original('invoice-mail-dispatch'")],
  ['legacy payment-link actions are blocked', runtime.includes('legacy_payment_link_disabled')],
  ['runtime does not use a MutationObserver', !runtime.includes('MutationObserver')],
  ['payment account UI contains no visible Stripe control', !paymentSettings.includes('Stripe-Link') && !paymentSettings.includes('Stripe bleibt')],
  ['payment account always disables old Stripe flag', paymentSettings.includes('payload.stripe_link_enabled = false')],
  ['QR PDF uses Swiss number formatting', qrPdf.includes("Intl.NumberFormat('de-CH'")],
  ['QR PDF uses Swiss date formatting', qrPdf.includes("Intl.DateTimeFormat('de-CH'") && qrPdf.includes("timeZone: 'Europe/Zurich'")],
  ['Swiss runtime is loaded by the admin bootstrap', bootstrap.includes('admin-runtime-invoice-only-ch.js')],
  ['migration clears plan payment links', migration.includes('monthly_payment_link') && migration.includes('yearly_payment_link') && migration.includes('setup_fee_payment_link')],
  ['migration clears customer payment links', migration.includes("table_name = 'customers'") && migration.includes('payment_link = NULL')],
  ['migration disables Stripe on payment accounts', migration.includes('stripe_link_enabled = FALSE')]
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
}

if (failed.length) {
  console.error(`\nSwiss invoice-only billing verification failed (${failed.length}/${checks.length}).`);
  process.exit(1);
}

console.log(`\nSwiss invoice-only billing verification passed (${checks.length}/${checks.length}).`);
