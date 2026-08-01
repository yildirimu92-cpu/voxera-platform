'use strict';

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const branded = require('./swiss-qr-bill-branded');

const A4_HEIGHT = 841.89;

function clean(value, max = 700) {
  return String(value == null ? '' : value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function wrapText(font, text, size, maxWidth, maxLines) {
  const words = clean(text).split(' ').filter(Boolean);
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
  return lines;
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      title: clean(item?.title || 'Voxera Dienstleistung', 160),
      description: clean(item?.description || '', 700),
      sortOrder: Number(item?.sort_order ?? item?.sortOrder ?? index + 1)
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 7);
}

async function expandDescriptions(buffer, args = {}) {
  const items = normalizeItems(args.items);
  if (!items.some(item => item.description)) return buffer;

  const pdf = await PDFDocument.load(buffer);
  const page = pdf.getPages()[0];
  if (!page) return buffer;

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const grey = rgb(0.38, 0.43, 0.52);
  const white = rgb(1, 1, 1);
  const customer = args.invoice?.customer_snapshot || {};
  const addressLines = [
    customer.name || customer.customer_name || customer.company_name,
    `${customer.street || ''} ${customer.house_number || ''}`.trim(),
    `${customer.postal_code || customer.zip || ''} ${customer.city || ''}`.trim(),
    customer.country || 'CH'
  ].filter(Boolean).length;

  let rowTop = A4_HEIGHT - 52 - 18 - 27 - 18 - 28 - 15 - (addressLines * 13) - 14 - 36;
  const textX = 50;
  const maxWidth = 275;

  for (const item of items) {
    const titleLines = Math.max(1, wrapText(bold, item.title, 9, 260, 2).length);
    const originalDescriptionLines = item.description ? wrapText(regular, item.description, 7.5, maxWidth, 2) : [];
    const descriptionY = rowTop - titleLines * 11;

    if (item.description) {
      const fullLines = wrapText(regular, item.description, 7.2, maxWidth, 3);
      page.drawRectangle({
        x: textX - 1,
        y: descriptionY - 22,
        width: maxWidth + 4,
        height: 32,
        color: white
      });
      fullLines.forEach((line, index) => {
        page.drawText(line, {
          x: textX,
          y: descriptionY - index * 8.5,
          size: 7.2,
          font: regular,
          color: grey
        });
      });
    }

    const rowHeight = Math.max(27, 13 + titleLines * 11 + originalDescriptionLines.length * 9);
    rowTop -= rowHeight + 10;
  }

  return Buffer.from(await pdf.save());
}

async function generateSwissQrInvoicePdf(args) {
  const generated = await branded.generateSwissQrInvoicePdf(args);
  return {
    ...generated,
    buffer: await expandDescriptions(generated.buffer, args)
  };
}

module.exports = {
  buildSwissQrPayload: branded.buildSwissQrPayload,
  generateSwissQrInvoicePdf,
  expandDescriptions
};
