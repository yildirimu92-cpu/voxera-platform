'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { generateSwissQrInvoicePdf } = require('./_lib/swiss-qr-bill-complete');
const { applyInvoicePaymentContext } = require('./_lib/invoice-payment-context');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const respond = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function compactText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function dateOnly(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
function normalizePlanLabel(value) {
  const raw = compactText(value);
  if (!raw) return '';
  return raw.replace(/[_-]+/g, ' ').split(' ').filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
}
function normalizeInvoiceItem(item, index = 0) {
  const quantity = numberOr(item?.quantity, 1) || 1;
  const unitPrice = numberOr(item?.unit_price ?? item?.unitPrice, 0);
  const lineTotal = numberOr(item?.line_total ?? item?.lineTotal, quantity * unitPrice);
  return {
    item_type: item?.item_type || item?.itemType || 'manual',
    title: compactText(item?.title) || 'Voxera Dienstleistung',
    description: compactText(item?.description) || null,
    quantity,
    unit_price: unitPrice,
    line_total: lineTotal,
    sort_order: numberOr(item?.sort_order ?? item?.sortOrder, index + 1),
    metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
  };
}
function invoiceSnapshotItems(invoice) {
  const snapshot = Array.isArray(invoice?.line_items_snapshot) ? invoice.line_items_snapshot : [];
  return snapshot.map(normalizeInvoiceItem).filter(item => item.title || item.line_total !== 0);
}
async function loadCommercialContext(sbAdmin, invoice) {
  let contract = null;
  let offer = null;
  let plan = null;
  if (invoice.contract_id) {
    const result = await sbAdmin.from('contracts').select('*').eq('id', invoice.contract_id).maybeSingle();
    if (!result.error) contract = result.data || null;
  }
  const offerId = invoice.offer_id || contract?.offer_id || null;
  if (offerId) {
    const result = await sbAdmin.from('offers').select('*').eq('id', offerId).maybeSingle();
    if (!result.error) offer = result.data || null;
  }
  const planCode = compactText(contract?.plan || contract?.plan_code || offer?.plan || offer?.plan_code);
  if (planCode) {
    const result = await sbAdmin.from('plan_config').select('*').eq('id', planCode.toLowerCase()).maybeSingle();
    if (!result.error) plan = result.data || null;
  }
  return { contract, offer, plan };
}
function inferBillingCycle(invoice, contract, offer) {
  const configured = compactText(contract?.billing_cycle || offer?.billing_cycle).toLowerCase();
  if (configured === 'yearly' || configured === 'annual') return 'yearly';
  if (configured === 'monthly') return 'monthly';
  const start = invoice.period_start ? new Date(invoice.period_start) : null;
  const end = invoice.period_end ? new Date(invoice.period_end) : null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const days = Math.round((end.getTime() - start.getTime()) / 86400000);
    if (days >= 330) return 'yearly';
  }
  return 'monthly';
}
function buildDerivedInvoiceItem(invoice, context) {
  const contract = context.contract || {};
  const offer = context.offer || {};
  const plan = context.plan || {};
  const type = compactText(invoice.invoice_type).toLowerCase();
  const cycle = inferBillingCycle(invoice, contract, offer);
  const planLabel = normalizePlanLabel(contract.plan || contract.plan_code || offer.plan || offer.plan_code || plan.name || plan.id);
  const subtotal = numberOr(invoice.subtotal_amount, 0);
  const total = numberOr(invoice.total_amount, 0);
  const amount = subtotal !== 0 ? subtotal : total;
  let title = 'Voxera Dienstleistung';
  if (type === 'setup_fee') title = 'Einrichtung und Inbetriebnahme Voxera';
  else if (type === 'recurring' || type === 'subscription') title = `${planLabel ? `Voxera ${planLabel}` : 'Voxera'} – ${cycle === 'yearly' ? 'Jahresabonnement' : 'Monatsabonnement'}`;
  else if (compactText(invoice.notes)) title = compactText(invoice.notes).slice(0, 90);
  const details = [];
  const periodStart = dateOnly(invoice.period_start);
  const periodEnd = dateOnly(invoice.period_end);
  if (periodStart && periodEnd) details.push(`Leistungsperiode ${periodStart} bis ${periodEnd}`);
  const includedMinutes = numberOr(contract.included_minutes ?? contract.plan_minutes_included ?? offer.included_minutes ?? plan.included_minutes ?? plan.minutes, 0);
  if (includedMinutes > 0) details.push(`${includedMinutes} Gesprächsminuten inklusive`);
  const extraRate = numberOr(contract.extra_per_minute ?? contract.extra_rate ?? offer.extra_per_minute ?? plan.extra_per_minute ?? plan.extra_rate, 0);
  if (extraRate > 0) details.push(`Zusatzminuten CHF ${extraRate.toFixed(2)} pro Minute`);
  if (type === 'setup_fee') details.push('Einmalige technische Einrichtung, Konfiguration und Bereitstellung');
  if (!details.length && planLabel) details.push(`Voxera Plan ${planLabel}`);
  return normalizeInvoiceItem({
    item_type: type || 'manual', title, description: details.join(' · ') || null,
    quantity: 1, unit_price: amount, line_total: amount, sort_order: 1,
    metadata: { derived_for_pdf: true, plan: planLabel || null, billing_cycle: cycle, period_start: periodStart, period_end: periodEnd }
  });
}
async function resolveInvoiceItems(sbAdmin, invoice, databaseItems) {
  const storedItems = (Array.isArray(databaseItems) ? databaseItems : []).map(normalizeInvoiceItem).filter(item => item.title || item.line_total !== 0);
  if (storedItems.length) return { invoice, items: storedItems, backfilled: false };
  const snapshotItems = invoiceSnapshotItems(invoice);
  if (snapshotItems.length) return { invoice, items: snapshotItems, backfilled: false };
  const context = await loadCommercialContext(sbAdmin, invoice);
  const derivedItems = [buildDerivedInvoiceItem(invoice, context)];
  const now = new Date().toISOString();
  const update = await sbAdmin.from('invoices').update({ line_items_snapshot: derivedItems, updated_at: now }).eq('id', invoice.id).select('*').single();
  if (update.error) throw new Error(`Leistungsdetails konnten nicht gespeichert werden: ${update.error.message}`);
  return { invoice: update.data, items: derivedItems, backfilled: true };
}
async function ensurePaymentContext(sbAdmin, invoice) {
  if (invoice.payment_account_snapshot && invoice.customer_snapshot) return invoice;
  if (!invoice.customer_id) throw new Error('Die Rechnung ist keinem Kunden zugeordnet und kann deshalb nicht ergänzt werden.');
  const { data: customer, error: customerError } = await sbAdmin.from('customers').select('*').eq('id', invoice.customer_id).maybeSingle();
  if (customerError) throw new Error(`Kundendaten konnten nicht geladen werden: ${customerError.message}`);
  if (!customer) throw new Error('Der zur Rechnung gehörende Kunde wurde nicht gefunden.');
  return applyInvoicePaymentContext({ sbAdmin, invoice, customer });
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
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return respond(400, { error: 'Ungültiger Request Body.' }); }
  const invoiceId = String(body.invoice_id || '').trim();
  if (!invoiceId) return respond(400, { error: 'invoice_id fehlt.' });
  const { data: originalInvoice, error: invoiceError } = await sbAdmin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (invoiceError) return respond(500, { error: invoiceError.message });
  if (!originalInvoice) return respond(404, { error: 'Rechnung nicht gefunden.' });
  try {
    let invoice = await ensurePaymentContext(sbAdmin, originalInvoice);
    if (!invoice.payment_account_snapshot) throw new Error('Zahlungskonto-Snapshot konnte nicht erstellt werden.');
    if (!invoice.customer_snapshot) throw new Error('Kundensnapshot konnte nicht erstellt werden.');
    const itemResult = await sbAdmin.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order', { ascending: true });
    if (itemResult.error) throw new Error(itemResult.error.message);
    const resolved = await resolveInvoiceItems(sbAdmin, invoice, itemResult.data || []);
    invoice = resolved.invoice;
    const generated = await generateSwissQrInvoicePdf({ invoice, items: resolved.items });
    const bucket = 'invoice-pdfs';
    const buckets = await sbAdmin.storage.listBuckets();
    if (buckets.error) throw new Error(buckets.error.message);
    if (!(buckets.data || []).some(entry => entry.id === bucket || entry.name === bucket)) {
      const created = await sbAdmin.storage.createBucket(bucket, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
      if (created.error && !String(created.error.message || '').toLowerCase().includes('already exists')) throw new Error(created.error.message);
    }
    const version = Number(invoice.pdf_version || 0) + 1;
    const path = `invoices/${invoice.id}/qr-v${version}-${Date.now()}.pdf`;
    const upload = await sbAdmin.storage.from(bucket).upload(path, generated.buffer, { contentType: 'application/pdf', upsert: false });
    if (upload.error) throw new Error(upload.error.message);
    const publicUrl = sbAdmin.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || null;
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await sbAdmin.from('invoices').update({
      qr_payload: generated.payload, pdf_url: publicUrl, pdf_path: path,
      pdf_generated_at: now, pdf_version: version, updated_at: now
    }).eq('id', invoice.id).select('*').single();
    if (updateError) throw new Error(updateError.message);
    await sbAdmin.from('commercial_lifecycle_audit').insert({
      actor_admin_id: caller.userId, actor_role: caller.role, action: 'invoice.qr_pdf.generate',
      customer_id: invoice.customer_id || null, contract_id: invoice.contract_id || null, invoice_id: invoice.id,
      metadata: {
        pdf_path: path, pdf_version: version, reference_type: invoice.payment_reference_type || 'NON',
        payment_context_backfilled: !originalInvoice.payment_account_snapshot || !originalInvoice.customer_snapshot,
        line_items_backfilled: resolved.backfilled, rendered_item_count: resolved.items.length,
        voxera_logo_applied: true, complete_descriptions_applied: true
      }, happened_at: now
    });
    return respond(200, {
      success: true, invoice: updated, pdf_url: publicUrl, pdf_path: path, pdf_version: version,
      payment_context_backfilled: !originalInvoice.payment_account_snapshot || !originalInvoice.customer_snapshot,
      line_items_backfilled: resolved.backfilled, rendered_item_count: resolved.items.length,
      voxera_logo_applied: true, complete_descriptions_applied: true
    });
  } catch (error) {
    return respond(409, { error: error?.message || 'QR-Rechnung konnte nicht erstellt werden.' });
  }
};
