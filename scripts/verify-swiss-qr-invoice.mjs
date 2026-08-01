import fs from 'node:fs';

const qr = fs.readFileSync('admin-panel/netlify/functions/_lib/swiss-qr-bill.js', 'utf8');
const endpoint = fs.readFileSync('admin-panel/netlify/functions/admin-invoice-qr-pdf.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('admin-panel/package.json', 'utf8'));

const checks = [
  ['SPC header', qr.includes("'SPC'")],
  ['QR version 0200', qr.includes("'0200'")],
  ['structured address', qr.includes("'S'")],
  ['payment reference types', qr.includes('referenceType')],
  ['EPD trailer', qr.includes("'EPD'")],
  ['46mm QR size', qr.includes('46 * MM')],
  ['Swiss cross overlay', qr.includes('drawSwissCross')],
  ['service detail columns', qr.includes('Leistung / Beschreibung') && qr.includes('Einzelpreis')],
  ['wrapped service descriptions', qr.includes('drawWrappedText') && qr.includes('compactItems')],
  ['subtotal and tax summary', qr.includes('Zwischentotal') && qr.includes('MWST')],
  ['protected admin endpoint', endpoint.includes('requireAdminCaller')],
  ['immutable snapshots required', endpoint.includes('payment_account_snapshot') && endpoint.includes('customer_snapshot')],
  ['missing line items backfilled', endpoint.includes('buildDerivedInvoiceItem') && endpoint.includes('line_items_snapshot')],
  ['commercial context used', endpoint.includes("from('contracts')") && endpoint.includes("from('offers')")],
  ['QR payload persisted', endpoint.includes('qr_payload')],
  ['PDF versioning', endpoint.includes('pdf_version')],
  ['pdf-lib dependency', Boolean(pkg.dependencies?.['pdf-lib'])],
  ['qrcode dependency', Boolean(pkg.dependencies?.qrcode)]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL: ${name}`);
  process.exit(1);
}
console.log(`Swiss QR invoice checks passed (${checks.length}).`);
