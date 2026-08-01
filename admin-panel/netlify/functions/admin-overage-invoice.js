'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { applyInvoicePaymentContext } = require('./_lib/invoice-payment-context');
const { generateSwissQrInvoicePdf } = require('./_lib/swiss-qr-bill-branded');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const trim = value => String(value == null ? '' : value).trim();
const money = value => Number(Number(value || 0).toFixed(2));

function periodBounds(value) {
  const raw = trim(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const start = new Date(`${raw}T00:00:00.000Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()));
    return { start: start.toISOString(), end: end.toISOString(), key: raw };
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split('-').map(Number);
    return {
      start: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
      end: new Date(Date.UTC(year, month, 1)).toISOString(),
      key: raw
    };
  }
  throw new Error('period_month muss YYYY-MM oder YYYY-MM-DD sein.');
}

function formatDateCh(value) {
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Zurich'
  }).format(new Date(value));
}

async function ensureBucket(sbAdmin, bucket) {
  const listed = await sbAdmin.storage.listBuckets();
  if (listed.error) throw new Error(listed.error.message);
  if ((listed.data || []).some(entry => entry.id === bucket || entry.name === bucket)) return;
  const created = await sbAdmin.storage.createBucket(bucket, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
  if (created.error && !String(created.error.message || '').toLowerCase().includes('already exists')) {
    throw new Error(created.error.message);
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) return respond(500, { error: 'Supabase-Konfiguration fehlt.' });

  const sbAdmin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: url, supabaseAnonKey: anonKey, sbAdmin });
  if (!caller.ok) return respond(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return respond(400, { error: 'Ungültiger Request Body.' }); }

  try {
    const customerId = trim(body.customer_id);
    const contractId = trim(body.contract_id) || null;
    const overageMinutes = Math.floor(Number(body.overage_minutes));
    const overageRate = Number(body.overage_rate);
    const includedMinutes = Math.max(0, Math.floor(Number(body.included_minutes || 0)));
    const usedMinutes = Math.max(overageMinutes, Math.floor(Number(body.used_minutes || 0)));
    const period = periodBounds(body.period_month);

    if (!customerId) return respond(400, { error: 'customer_id fehlt.' });
    if (!Number.isFinite(overageMinutes) || overageMinutes <= 0) return respond(400, { error: 'overage_minutes muss > 0 sein.' });
    if (!Number.isFinite(overageRate) || overageRate <= 0) return respond(400, { error: 'overage_rate muss > 0 sein.' });

    const { data: customer, error: customerError } = await sbAdmin.from('customers').select('*').eq('id', customerId).maybeSingle();
    if (customerError) throw new Error(`Kunde konnte nicht geladen werden: ${customerError.message}`);
    if (!customer) return respond(404, { error: 'Kunde nicht gefunden.' });

    let contract = null;
    if (contractId) {
      const result = await sbAdmin.from('contracts').select('*').eq('id', contractId).maybeSingle();
      if (result.error) throw new Error(`Vertrag konnte nicht geladen werden: ${result.error.message}`);
      contract = result.data || null;
      if (!contract) return respond(404, { error: 'Vertrag nicht gefunden.' });
      if (String(contract.customer_id || '') !== customerId) return respond(409, { error: 'Vertrag gehört nicht zu diesem Kunden.' });
    }

    const externalReference = contractId
      ? `overage:${contractId}:${period.key}`
      : `overage:${customerId}:${period.key.slice(0, 7)}`;

    const { data: existing, error: existingError } = await sbAdmin
      .from('invoices')
      .select('*')
      .eq('external_reference', externalReference)
      .maybeSingle();
    if (existingError) throw new Error(`Idempotenzprüfung fehlgeschlagen: ${existingError.message}`);
    if (existing) {
      return respond(200, {
        success: true,
        created: false,
        skipped: 'already_exists_for_period',
        invoice: existing,
        pdf_url: existing.pdf_url || null
      });
    }

    const totalAmount = money(overageMinutes * overageRate);
    const numberResult = await sbAdmin.rpc('next_invoice_number_v1');
    if (numberResult.error || !numberResult.data) throw new Error(numberResult.error?.message || 'Rechnungsnummer konnte nicht erzeugt werden.');

    const now = new Date().toISOString();
    const invoiceInsert = {
      invoice_number: String(numberResult.data),
      customer_id: customerId,
      contract_id: contractId,
      subscription_id: null,
      invoice_type: 'extra_minutes',
      billing_provider: 'invoice',
      payment_method: 'bank_transfer',
      status: 'draft',
      currency: 'CHF',
      subtotal_amount: totalAmount,
      tax_amount: 0,
      total_amount: totalAmount,
      issued_at: now,
      due_at: null,
      period_start: period.start,
      period_end: period.end,
      external_reference: externalReference,
      notes: trim(body.notes) || `Überzugsrechnung ${formatDateCh(period.start)} bis ${formatDateCh(period.end)}`,
      metadata: {
        source: 'overage_qr_invoice',
        included_minutes: includedMinutes,
        used_minutes: usedMinutes,
        overage_minutes: overageMinutes,
        overage_rate: money(overageRate),
        period_key: period.key,
        requires_admin_send: true
      }
    };

    const createdInvoice = await sbAdmin.from('invoices').insert(invoiceInsert).select('*').single();
    if (createdInvoice.error) throw new Error(`Überzugsrechnung konnte nicht erstellt werden: ${createdInvoice.error.message}`);
    let invoice = createdInvoice.data;

    const item = {
      invoice_id: invoice.id,
      sort_order: 1,
      item_type: 'extra_minutes',
      title: `Zusatzminuten ${formatDateCh(period.start)}–${formatDateCh(period.end)}`,
      description: [
        includedMinutes ? `${includedMinutes} Gesprächsminuten inklusive` : null,
        usedMinutes ? `${usedMinutes} Gesprächsminuten verbraucht` : null,
        `${overageMinutes} Zusatzminuten × CHF ${overageRate.toFixed(2)} pro Minute`
      ].filter(Boolean).join(' · '),
      quantity: overageMinutes,
      unit_price: money(overageRate),
      line_total: totalAmount,
      metadata: {
        source: 'overage_qr_invoice',
        included_minutes: includedMinutes,
        used_minutes: usedMinutes,
        overage_minutes: overageMinutes,
        overage_rate: money(overageRate),
        period_start: period.start,
        period_end: period.end
      }
    };
    const itemInsert = await sbAdmin.from('invoice_items').insert(item);
    if (itemInsert.error) throw new Error(`Überzugsposition konnte nicht gespeichert werden: ${itemInsert.error.message}`);

    invoice = await applyInvoicePaymentContext({ sbAdmin, invoice, customer });
    const generated = await generateSwissQrInvoicePdf({ invoice, items: [item] });

    const bucket = 'invoice-pdfs';
    await ensureBucket(sbAdmin, bucket);
    const version = Number(invoice.pdf_version || 0) + 1;
    const path = `invoices/${invoice.id}/qr-v${version}-${Date.now()}.pdf`;
    const upload = await sbAdmin.storage.from(bucket).upload(path, generated.buffer, {
      contentType: 'application/pdf', upsert: false
    });
    if (upload.error) throw new Error(`QR-PDF konnte nicht gespeichert werden: ${upload.error.message}`);
    const publicUrl = sbAdmin.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || null;

    const updatedResult = await sbAdmin.from('invoices').update({
      qr_payload: generated.payload,
      pdf_url: publicUrl,
      pdf_path: path,
      pdf_generated_at: now,
      pdf_version: version,
      updated_at: now
    }).eq('id', invoice.id).select('*').single();
    if (updatedResult.error) throw new Error(`QR-PDF konnte nicht mit der Rechnung verknüpft werden: ${updatedResult.error.message}`);

    await sbAdmin.from('commercial_lifecycle_audit').insert({
      actor_admin_id: caller.userId,
      actor_role: caller.role,
      action: 'invoice.overage_qr.create',
      customer_id: customerId,
      contract_id: contractId,
      invoice_id: invoice.id,
      metadata: {
        external_reference: externalReference,
        included_minutes: includedMinutes,
        used_minutes: usedMinutes,
        overage_minutes: overageMinutes,
        overage_rate: money(overageRate),
        total_amount: totalAmount,
        pdf_version: version,
        automatic_email_sent: false
      },
      happened_at: now
    });

    return respond(200, {
      success: true,
      created: true,
      invoice: updatedResult.data,
      pdf_url: publicUrl,
      requires_admin_send: true,
      mail_type: 'invoice_email'
    });
  } catch (error) {
    return respond(409, { error: error?.message || 'Überzugsrechnung konnte nicht erstellt werden.' });
  }
};
