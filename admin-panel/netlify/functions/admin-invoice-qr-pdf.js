'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { generateSwissQrInvoicePdf } = require('./_lib/swiss-qr-bill');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

exports.handler = async (event) => {
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

  const { data: invoice, error: invoiceError } = await sbAdmin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (invoiceError) return respond(500, { error: invoiceError.message });
  if (!invoice) return respond(404, { error: 'Rechnung nicht gefunden.' });
  if (!invoice.payment_account_snapshot) return respond(409, { error: 'Die Rechnung enthält noch keinen Zahlungskonto-Snapshot.' });
  if (!invoice.customer_snapshot) return respond(409, { error: 'Die Rechnung enthält noch keinen Kundensnapshot.' });

  const { data: items, error: itemsError } = await sbAdmin.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order', { ascending: true });
  if (itemsError) return respond(500, { error: itemsError.message });

  try {
    const generated = await generateSwissQrInvoicePdf({ invoice, items: items || [] });
    const bucket = 'invoice-pdfs';
    const buckets = await sbAdmin.storage.listBuckets();
    if (buckets.error) throw new Error(buckets.error.message);
    if (!(buckets.data || []).some((entry) => entry.id === bucket || entry.name === bucket)) {
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
      qr_payload: generated.payload,
      pdf_url: publicUrl,
      pdf_path: path,
      pdf_generated_at: now,
      pdf_version: version,
      updated_at: now
    }).eq('id', invoice.id).select('*').single();
    if (updateError) throw new Error(updateError.message);

    await sbAdmin.from('commercial_lifecycle_audit').insert({
      actor_admin_id: caller.userId,
      actor_role: caller.role,
      action: 'invoice.qr_pdf.generate',
      customer_id: invoice.customer_id || null,
      contract_id: invoice.contract_id || null,
      invoice_id: invoice.id,
      metadata: { pdf_path: path, pdf_version: version, reference_type: invoice.payment_reference_type || 'NON' },
      happened_at: now
    });

    return respond(200, { success: true, invoice: updated, pdf_url: publicUrl, pdf_path: path, pdf_version: version });
  } catch (error) {
    return respond(409, { error: error?.message || 'QR-Rechnung konnte nicht erstellt werden.' });
  }
};
