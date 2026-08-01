import fs from 'node:fs';
import vm from 'node:vm';

const adminIndex=fs.readFileSync('admin-panel/index.html','utf8');
const runtime=fs.readFileSync('admin-panel/shared/admin-runtime-billing-inline-qr.js','utf8');
const loader=fs.readFileSync('admin-panel/shared/offer-brand.js','utf8');

new vm.Script(runtime,{filename:'admin-runtime-billing-inline-qr.js'});

const required=[
  'id="invoice-detail-pdf"',
  'id="invoice-detail-pdf-generate"',
  'QR-Rechnung erstellen',
  "callAdminFunction('admin-invoice-qr-pdf'",
  "document.querySelectorAll('.vx-inline-qr-actions').forEach(node => node.remove())",
  '/shared/admin-runtime-billing-inline-qr.js?v=20260801-3'
];
for(const token of required){
  if(!adminIndex.includes(token)&&!runtime.includes(token)&&!loader.includes(token)){
    throw new Error(`Missing QR invoice control invariant: ${token}`);
  }
}
if(runtime.includes('cell.appendChild(controls)')){
  throw new Error('Inline QR actions must not be mounted in the invoice table.');
}
console.log('QR controls are limited to invoice detail and draft recovery.');
