import fs from 'node:fs';

const runtime = fs.readFileSync('admin-panel/shared/admin-runtime-qr-invoice-controls.js','utf8');
const loader = fs.readFileSync('admin-panel/shared/offer-brand.js','utf8');
const required = [
  'QR-Rechnung erstellen',
  'QR-Rechnung öffnen',
  'Neu generieren',
  "callAdminFunction('admin-invoice-qr-pdf'",
  'Versandstatus ohne PDF',
  'Die Rechnung bleibt bestehen',
  'admin-runtime-qr-invoice-controls.js'
];
for (const token of required) {
  if (!runtime.includes(token) && !loader.includes(token)) throw new Error(`Missing QR invoice control invariant: ${token}`);
}
console.log('QR invoice visibility and retry controls verified.');
