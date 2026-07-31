'use strict';

const QRCode = require('qrcode');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const A4 = { width: 595.28, height: 841.89 };
const MM = 72 / 25.4;

function clean(value, max = 70) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function compactIban(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function amountString(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toFixed(2);
}

function structuredAddress(snapshot = {}) {
  return [
    'S',
    clean(snapshot.creditor_name || snapshot.name),
    clean(snapshot.creditor_street || snapshot.street),
    clean(snapshot.creditor_house_number || snapshot.house_number, 16),
    clean(snapshot.creditor_postal_code || snapshot.postal_code, 16),
    clean(snapshot.creditor_city || snapshot.city),
    clean(snapshot.creditor_country || snapshot.country || 'CH', 2).toUpperCase()
  ];
}

function debtorAddress(snapshot = {}) {
  return [
    'S',
    clean(snapshot.name || snapshot.customer_name || snapshot.company_name),
    clean(snapshot.street),
    clean(snapshot.house_number, 16),
    clean(snapshot.postal_code || snapshot.zip, 16),
    clean(snapshot.city),
    clean(snapshot.country || 'CH', 2).toUpperCase()
  ];
}

function buildSwissQrPayload(invoice) {
  const account = invoice.payment_account_snapshot || {};
  const customer = invoice.customer_snapshot || {};
  const referenceType = String(invoice.payment_reference_type || account.reference_type || 'NON').toUpperCase();
  const iban = compactIban(referenceType === 'QRR' ? (account.qr_iban || account.iban) : account.iban);
  if (!iban) throw new Error('QR-Rechnung kann nicht erstellt werden: IBAN fehlt im Rechnungssnapshot.');

  const reference = referenceType === 'NON' ? '' : clean(invoice.payment_reference, 27);
  const additional = clean(
    referenceType === 'NON'
      ? (invoice.payment_reference || `Rechnung ${invoice.invoice_number || ''}`)
      : (account.default_message || `Rechnung ${invoice.invoice_number || ''}`),
    140
  );

  const lines = [
    'SPC',
    '0200',
    '1',
    iban,
    ...structuredAddress(account),
    '', '', '', '', '', '', '',
    amountString(invoice.total_amount),
    clean(invoice.currency || account.currency || 'CHF', 3).toUpperCase(),
    ...debtorAddress(customer),
    referenceType,
    reference,
    additional,
    'EPD',
    '',
    '',
    ''
  ];

  return lines.join('\r\n');
}

function money(value, currency = 'CHF') {
  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function drawText(page, font, text, x, y, size = 9, boldFont = null, bold = false) {
  page.drawText(clean(text, 200), { x, y, size, font: bold && boldFont ? boldFont : font, color: rgb(0, 0, 0) });
}

function drawSwissCross(page, x, y, size) {
  const white = rgb(1, 1, 1);
  const black = rgb(0, 0, 0);
  page.drawRectangle({ x, y, width: size, height: size, color: white, borderColor: black, borderWidth: 0.8 });
  const bar = size * 0.18;
  const arm = size * 0.58;
  page.drawRectangle({ x: x + (size - bar) / 2, y: y + (size - arm) / 2, width: bar, height: arm, color: black });
  page.drawRectangle({ x: x + (size - arm) / 2, y: y + (size - bar) / 2, width: arm, height: bar, color: black });
}

async function generateSwissQrInvoicePdf({ invoice, items = [] }) {
  const account = invoice.payment_account_snapshot || {};
  const customer = invoice.customer_snapshot || {};
  const currency = invoice.currency || account.currency || 'CHF';
  const payload = buildSwissQrPayload(invoice);
  const qrDataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 0, width: 700 });
  const qrBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.width, A4.height]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const qr = await pdf.embedPng(qrBytes);

  const left = 42;
  let y = A4.height - 52;
  drawText(page, font, 'VOXERA', left, y, 18, bold, true);
  drawText(page, font, 'RECHNUNG', A4.width - 150, y, 15, bold, true);
  y -= 28;
  drawText(page, font, `Rechnungsnummer: ${invoice.invoice_number || invoice.id}`, left, y, 9, bold, true);
  drawText(page, font, `Datum: ${String(invoice.issued_at || '').slice(0, 10)}`, A4.width - 210, y, 9);
  y -= 20;
  drawText(page, font, `Fällig: ${String(invoice.due_at || '').slice(0, 10)}`, A4.width - 210, y, 9);

  y -= 34;
  drawText(page, font, 'Rechnung an', left, y, 10, bold, true);
  y -= 15;
  [customer.name || customer.customer_name || customer.company_name, `${customer.street || ''} ${customer.house_number || ''}`.trim(), `${customer.postal_code || customer.zip || ''} ${customer.city || ''}`.trim(), customer.country || 'CH']
    .filter(Boolean).forEach((line) => { drawText(page, font, line, left, y, 9); y -= 13; });

  y -= 18;
  page.drawLine({ start: { x: left, y }, end: { x: A4.width - left, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) });
  y -= 20;
  drawText(page, font, 'Position', left, y, 9, bold, true);
  drawText(page, font, 'Betrag', A4.width - 115, y, 9, bold, true);
  y -= 15;
  for (const item of items) {
    drawText(page, font, item.title || 'Position', left, y, 9);
    drawText(page, font, money(item.line_total, currency), A4.width - 115, y, 9);
    y -= 15;
  }
  y -= 5;
  page.drawLine({ start: { x: A4.width - 240, y }, end: { x: A4.width - left, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) });
  y -= 18;
  drawText(page, font, 'Total', A4.width - 240, y, 11, bold, true);
  drawText(page, font, money(invoice.total_amount, currency), A4.width - 115, y, 11, bold, true);

  const paymentTop = 105 * MM;
  page.drawLine({ start: { x: 0, y: paymentTop }, end: { x: A4.width, y: paymentTop }, thickness: 0.8, dashArray: [3, 3], color: rgb(0.25, 0.25, 0.25) });
  const receiptWidth = 62 * MM;
  page.drawLine({ start: { x: receiptWidth, y: 0 }, end: { x: receiptWidth, y: paymentTop }, thickness: 0.6, dashArray: [3, 3], color: rgb(0.25, 0.25, 0.25) });

  drawText(page, font, 'Empfangsschein', 5 * MM, paymentTop - 10 * MM, 10, bold, true);
  drawText(page, font, 'Konto / Zahlbar an', 5 * MM, paymentTop - 20 * MM, 7, bold, true);
  drawText(page, font, compactIban(account.iban), 5 * MM, paymentTop - 25 * MM, 8);
  drawText(page, font, account.creditor_name || '', 5 * MM, paymentTop - 30 * MM, 8);
  drawText(page, font, `${account.creditor_postal_code || ''} ${account.creditor_city || ''}`, 5 * MM, paymentTop - 35 * MM, 8);
  drawText(page, font, 'Betrag', 5 * MM, 18 * MM, 7, bold, true);
  drawText(page, font, `${currency} ${Number(invoice.total_amount || 0).toFixed(2)}`, 5 * MM, 12 * MM, 9, bold, true);

  const mainX = receiptWidth + 6 * MM;
  drawText(page, font, 'Zahlteil', mainX, paymentTop - 10 * MM, 10, bold, true);
  const qrSize = 46 * MM;
  const qrX = mainX;
  const qrY = paymentTop - 69 * MM;
  page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });
  drawSwissCross(page, qrX + qrSize / 2 - 3.5 * MM, qrY + qrSize / 2 - 3.5 * MM, 7 * MM);

  const infoX = mainX + 53 * MM;
  let infoY = paymentTop - 20 * MM;
  drawText(page, font, 'Konto / Zahlbar an', infoX, infoY, 7, bold, true); infoY -= 5 * MM;
  [compactIban(account.iban), account.creditor_name, `${account.creditor_street || ''} ${account.creditor_house_number || ''}`.trim(), `${account.creditor_postal_code || ''} ${account.creditor_city || ''}`.trim(), account.creditor_country || 'CH']
    .filter(Boolean).forEach((line) => { drawText(page, font, line, infoX, infoY, 8); infoY -= 4.5 * MM; });
  infoY -= 2 * MM;
  drawText(page, font, 'Zusätzliche Informationen', infoX, infoY, 7, bold, true); infoY -= 5 * MM;
  drawText(page, font, invoice.payment_reference || `Rechnung ${invoice.invoice_number || ''}`, infoX, infoY, 8);
  infoY -= 10 * MM;
  drawText(page, font, 'Betrag', infoX, infoY, 7, bold, true); infoY -= 5 * MM;
  drawText(page, font, `${currency} ${Number(invoice.total_amount || 0).toFixed(2)}`, infoX, infoY, 10, bold, true);

  const bytes = await pdf.save();
  return { buffer: Buffer.from(bytes), payload };
}

module.exports = { buildSwissQrPayload, generateSwissQrInvoicePdf };
