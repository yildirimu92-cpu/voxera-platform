'use strict';

const QRCode = require('qrcode');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const A4 = { width: 595.28, height: 841.89 };
const MM = 72 / 25.4;

function clean(value, max = 70) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
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

function numberCh(value, options = {}) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('de-CH', {
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2
  }).format(Number.isFinite(amount) ? amount : 0);
}

function money(value, currency = 'CHF') {
  const amount = Number(value || 0);
  const sign = amount < 0 ? '-' : '';
  return `${sign}${String(currency || 'CHF').toUpperCase()} ${numberCh(Math.abs(amount))}`;
}

function quantity(value) {
  const amount = Number(value || 0);
  const decimals = Number.isInteger(amount) ? 0 : 2;
  return numberCh(amount, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function displayDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return clean(String(value), 20);
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Zurich'
  }).format(parsed);
}

function drawText(page, font, text, x, y, size = 9, boldFont = null, bold = false, color = rgb(0, 0, 0)) {
  page.drawText(clean(text, 220), { x, y, size, font: bold && boldFont ? boldFont : font, color });
}

function drawRightText(page, font, text, rightX, y, size = 9, boldFont = null, bold = false, color = rgb(0, 0, 0)) {
  const activeFont = bold && boldFont ? boldFont : font;
  const value = clean(text, 220);
  const width = activeFont.widthOfTextAtSize(value, size);
  page.drawText(value, { x: Math.max(0, rightX - width), y, size, font: activeFont, color });
}

function wrapText(font, text, size, maxWidth, maxLines = 3) {
  const words = clean(text, 600).split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let finalLine = lines[maxLines - 1];
    while (finalLine.length > 3 && font.widthOfTextAtSize(`${finalLine}...`, size) > maxWidth) finalLine = finalLine.slice(0, -1);
    lines[maxLines - 1] = `${finalLine}...`;
  }
  return lines;
}

function drawWrappedText(page, font, text, x, y, size, maxWidth, options = {}) {
  const lines = wrapText(font, text, size, maxWidth, options.maxLines || 3);
  const lineHeight = options.lineHeight || (size + 2);
  lines.forEach((line, index) => drawText(page, font, line, x, y - index * lineHeight, size, options.boldFont, options.bold, options.color));
  return y - Math.max(0, lines.length - 1) * lineHeight;
}

function normalizeItem(item, index) {
  const itemQuantity = Number(item?.quantity || 1) || 1;
  const unitPrice = Number(item?.unit_price ?? item?.unitPrice ?? 0);
  const lineTotal = Number(item?.line_total ?? item?.lineTotal ?? (itemQuantity * unitPrice));
  return {
    title: clean(item?.title || 'Voxera Dienstleistung', 160),
    description: clean(item?.description || '', 500),
    quantity: itemQuantity,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    lineTotal: Number.isFinite(lineTotal) ? lineTotal : 0,
    sortOrder: Number(item?.sort_order ?? item?.sortOrder ?? index + 1)
  };
}

function compactItems(items) {
  const normalized = (Array.isArray(items) ? items : []).map(normalizeItem).sort((a, b) => a.sortOrder - b.sortOrder);
  if (normalized.length <= 7) return normalized;
  const visible = normalized.slice(0, 6);
  const remaining = normalized.slice(6);
  visible.push({
    title: `Weitere Leistungen (${remaining.length})`,
    description: remaining.map((item) => item.title).join(', '),
    quantity: 1,
    unitPrice: remaining.reduce((sum, item) => sum + item.lineTotal, 0),
    lineTotal: remaining.reduce((sum, item) => sum + item.lineTotal, 0),
    sortOrder: 999
  });
  return visible;
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
  const grey = rgb(0.38, 0.43, 0.52);
  const light = rgb(0.93, 0.95, 0.97);
  const line = rgb(0.78, 0.81, 0.85);

  const left = 42;
  const right = A4.width - 42;
  let y = A4.height - 52;

  drawText(page, font, 'VOXERA', left, y, 18, bold, true);
  drawRightText(page, font, 'RECHNUNG', right, y, 15, bold, true);
  y -= 18;
  const creditorLine = [account.creditor_name, `${account.creditor_street || ''} ${account.creditor_house_number || ''}`.trim(), `${account.creditor_postal_code || ''} ${account.creditor_city || ''}`.trim()].filter(Boolean).join(' · ');
  drawText(page, font, creditorLine, left, y, 7.5, null, false, grey);

  y -= 27;
  drawText(page, font, `Rechnungsnummer: ${invoice.invoice_number || invoice.id}`, left, y, 9, bold, true);
  drawRightText(page, font, `Datum: ${displayDate(invoice.issued_at)}`, right, y, 9);
  y -= 18;
  drawRightText(page, font, `Fällig: ${displayDate(invoice.due_at)}`, right, y, 9);

  y -= 28;
  drawText(page, font, 'Rechnung an', left, y, 10, bold, true);
  y -= 15;
  [customer.name || customer.customer_name || customer.company_name, `${customer.street || ''} ${customer.house_number || ''}`.trim(), `${customer.postal_code || customer.zip || ''} ${customer.city || ''}`.trim(), customer.country || 'CH']
    .filter(Boolean).forEach((addressLine) => { drawText(page, font, addressLine, left, y, 9); y -= 13; });

  y -= 14;
  page.drawRectangle({ x: left, y: y - 23, width: right - left, height: 28, color: light });
  drawText(page, font, 'Leistung / Beschreibung', left + 8, y - 13, 8, bold, true, grey);
  drawRightText(page, font, 'Menge', 405, y - 13, 8, bold, true, grey);
  drawRightText(page, font, 'Einzelpreis', 485, y - 13, 8, bold, true, grey);
  drawRightText(page, font, 'Betrag', right - 8, y - 13, 8, bold, true, grey);
  y -= 36;

  const renderedItems = compactItems(items);
  if (!renderedItems.length) {
    drawText(page, font, 'Voxera Dienstleistung', left + 8, y, 9, bold, true);
    drawRightText(page, font, '1', 405, y, 9);
    drawRightText(page, font, money(invoice.total_amount, currency), 485, y, 9);
    drawRightText(page, font, money(invoice.total_amount, currency), right - 8, y, 9, bold, true);
    y -= 28;
  } else {
    for (const item of renderedItems) {
      const rowTop = y;
      drawWrappedText(page, bold, item.title, left + 8, y, 9, 260, { maxLines: 2, lineHeight: 11 });
      const titleLines = wrapText(bold, item.title, 9, 260, 2).length || 1;
      const descriptionY = y - titleLines * 11;
      const descriptionLines = item.description ? wrapText(font, item.description, 7.5, 275, 2) : [];
      descriptionLines.forEach((descriptionLine, index) => drawText(page, font, descriptionLine, left + 8, descriptionY - index * 9, 7.5, null, false, grey));

      drawRightText(page, font, quantity(item.quantity), 405, rowTop, 9);
      drawRightText(page, font, money(item.unitPrice, currency), 485, rowTop, 9);
      drawRightText(page, font, money(item.lineTotal, currency), right - 8, rowTop, 9, bold, item.lineTotal < 0);

      const rowHeight = Math.max(27, 13 + titleLines * 11 + descriptionLines.length * 9);
      y -= rowHeight;
      page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.4, color: line });
      y -= 10;
    }
  }

  const subtotal = Number(invoice.subtotal_amount || 0);
  const tax = Number(invoice.tax_amount || 0);
  const total = Number(invoice.total_amount || 0);
  const summaryX = right - 215;
  if (tax !== 0 || (subtotal !== 0 && Math.abs(subtotal - total) > 0.005)) {
    drawText(page, font, 'Zwischentotal', summaryX, y, 9);
    drawRightText(page, font, money(subtotal, currency), right - 8, y, 9);
    y -= 16;
  }
  if (tax !== 0) {
    drawText(page, font, 'MWST', summaryX, y, 9);
    drawRightText(page, font, money(tax, currency), right - 8, y, 9);
    y -= 16;
  }
  page.drawLine({ start: { x: summaryX, y: y + 5 }, end: { x: right, y: y + 5 }, thickness: 0.7, color: line });
  drawText(page, font, 'Total', summaryX, y - 10, 11, bold, true);
  drawRightText(page, font, money(total, currency), right - 8, y - 10, 11, bold, true);

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
  drawText(page, font, money(invoice.total_amount, currency), 5 * MM, 12 * MM, 9, bold, true);

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
    .filter(Boolean).forEach((addressLine) => { drawText(page, font, addressLine, infoX, infoY, 8); infoY -= 4.5 * MM; });
  infoY -= 2 * MM;
  drawText(page, font, 'Zusätzliche Informationen', infoX, infoY, 7, bold, true); infoY -= 5 * MM;
  drawWrappedText(page, font, invoice.payment_reference || `Rechnung ${invoice.invoice_number || ''}`, infoX, infoY, 8, 43 * MM, { maxLines: 2, lineHeight: 9 });
  infoY -= 10 * MM;
  drawText(page, font, 'Betrag', infoX, infoY, 7, bold, true); infoY -= 5 * MM;
  drawText(page, font, money(invoice.total_amount, currency), infoX, infoY, 10, bold, true);

  const bytes = await pdf.save();
  return { buffer: Buffer.from(bytes), payload };
}

module.exports = { buildSwissQrPayload, generateSwissQrInvoicePdf };
