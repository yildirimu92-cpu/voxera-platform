import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const mail = read('admin-panel/netlify/functions/invoice-mail-dispatch.js');
const runtime = read('admin-panel/shared/admin-runtime-invoice-only-ch.js');
const paymentSettings = read('admin-panel/shared/admin-runtime-payment-account.js');
const qrPdf = read('admin-panel/netlify/functions/_lib/swiss-qr-bill.js');
const bootstrap = read('admin-panel/shared/offer-brand.js');
const migration = read('supabase/sql/2026-08-01_invoice_only_billing_disable_payment_links.sql');

// Die Payload-Pruefungen liefen ueber exakte Zeichenketten mit Leerzeichen nach
// dem Doppelpunkt ("locale: 'de-CH'"). Am 2026-08-01 hat ea88fd47 die Datei
// umgeschrieben (-207/+48 Zeilen) und den Payload kompakt formatiert; vier
// Checks waren seither rot, ohne dass sich an der Sache etwas geaendert hatte.
// Die Schreibweise ist keine Zusage -- geprueft wird sie deshalb ohne
// Abhaengigkeit von Leerzeichen.
const key = (name, value) => new RegExp(`\\b${name}\\s*:\\s*${value}`);

const checks = [
  ['invoice mail endpoint is admin protected', mail.includes('requireAdminCaller')],
  // Der Fehlercode hiess frueher qr_invoice_missing und heisst seit ea88fd47
  // invoice_pdf_missing -- konsistent auch in invoice-mail-preview.js, und kein
  // Konsument wertet ihn aus. Die Zusage ist nicht der Name, sondern dass der
  // Versand ohne fertige QR-Rechnung abbricht: alle drei Bedingungen im Guard
  // und eine 409-Antwort.
  ['invoice mail requires a generated QR PDF',
    /invoice\.pdf_url/.test(mail) && /invoice\.qr_payload/.test(mail) && /invoice\.pdf_version/.test(mail)
    && /respond\(409[^)]*step_failed\s*:\s*'invoice_pdf_missing'/.test(mail)],
  ['invoice PDF is exposed as an attachment',
    /attachments\s*:\s*\[\s*\{/.test(mail) && key('content_type', "'application/pdf'").test(mail)],
  ['invoice mail has no payment-link payload', !/\bpayment_link\s*:/.test(mail)],
  // payment_method traegt seit ea88fd47 'invoice' statt 'swiss_qr_invoice'.
  // Nachgeprueft im Blueprint der aktiven Make-Szenario "Central Mail Engine
  // v5": der Router verzweigt auf mail_type, nicht auf payment_method, und kein
  // Template rendert das Feld -- die Umbenennung ist ohne Wirkung. Geprueft wird
  // deshalb die Zusage selbst: Rechnung statt Zahlungsanbieter, kein
  // Zahlungslink, Stripe aus.
  ['invoice mail is explicitly invoice-only',
    key('billing_provider', "'invoice'").test(mail)
    && key('payment_method', "'invoice'").test(mail)
    && key('has_payment_link', 'false').test(mail)
    && key('invoice_only', 'true').test(mail)
    && key('stripe_disabled', 'true').test(mail)],
  ['invoice mail uses Swiss locale and timezone',
    key('locale', "'de-CH'").test(mail) && key('timezone', "'Europe/Zurich'").test(mail)],
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
