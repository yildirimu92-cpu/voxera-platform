'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { buildInvoiceMailCopy, formatDateCh, formatMoneyCh } = require('./_lib/invoice-mail-copy');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const respond = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const trim = value => String(value == null ? '' : value).trim();

function requestedType(body) {
  const raw = trim(body.mail_type || body.event_type || body.original_mail_type).toLowerCase();
  if (raw === 'reminder_final_email') return 'reminder_final_email';
  if (raw === 'reminder_email') return 'reminder_email';
  return 'invoice_email';
}

function invoiceState(invoice) {
  if (invoice?.paid_at) return 'paid';
  const status = trim(invoice?.status).toLowerCase();
  if (['paid','bezahlt'].includes(status)) return 'paid';
  if (['cancelled','canceled','void','voided','storniert'].includes(status)) return 'cancelled';
  return status || 'open';
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return respond(405, { error:'Method not allowed' });
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) return respond(500, { error:'Supabase-Konfiguration fehlt.' });
  const sbAdmin = createClient(url, serviceKey, { auth:{ autoRefreshToken:false, persistSession:false } });
  const caller = await requireAdminCaller({ event, supabaseUrl:url, supabaseAnonKey:anonKey, sbAdmin });
  if (!caller.ok) return respond(caller.statusCode, caller.body);
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return respond(400, { error:'Ungültiger Request Body.' }); }
  const invoiceId = trim(body.invoice_id || body.invoice?.id);
  if (!invoiceId) return respond(400, { error:'invoice_id fehlt.' });
  const invoiceResult = await sbAdmin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (invoiceResult.error) return respond(500, { error:invoiceResult.error.message });
  const invoice = invoiceResult.data;
  if (!invoice) return respond(404, { error:'Rechnung nicht gefunden.' });
  const state = invoiceState(invoice);
  if (state === 'paid') return respond(409, { error:'Eine bezahlte Rechnung kann nicht gemahnt oder erneut versendet werden.' });
  if (state === 'cancelled') return respond(409, { error:'Eine stornierte Rechnung darf nicht versendet werden.' });
  if (!trim(invoice.pdf_url) || !trim(invoice.qr_payload) || Number(invoice.pdf_version || 0) < 1) {
    return respond(409, { error:'Die Rechnung wurde noch nicht als PDF erstellt.', step_failed:'invoice_pdf_missing' });
  }
  const customerResult = await sbAdmin.from('customers').select('*').eq('id', invoice.customer_id).maybeSingle();
  if (customerResult.error) return respond(500, { error:customerResult.error.message });
  const customer = customerResult.data;
  if (!customer) return respond(404, { error:'Kunde zur Rechnung nicht gefunden.' });
  const type = requestedType(body);
  const copy = buildInvoiceMailCopy(type, invoice, customer);
  const recipientEmail = trim(body?.overrides?.to_email || customer.email);
  const filename = `Voxera-Rechnung-${invoice.invoice_number || invoice.id}.pdf`;
  const preview = {
    mail_type:type,
    event_type:type,
    recipient:{ email:recipientEmail, name:trim(customer.contact_name || customer.customer_name || customer.company_name) || null },
    subject:copy.subject,
    body_text:copy.body_text,
    attachment:{ filename, url:invoice.pdf_url, content_type:'application/pdf' },
    invoice:{ id:invoice.id, invoice_number:invoice.invoice_number, invoice_type:invoice.invoice_type || null, amount:Number(invoice.total_amount || 0), amount_formatted:formatMoneyCh(invoice.total_amount, invoice.currency || 'CHF'), currency:invoice.currency || 'CHF', due_at:invoice.due_at, due_on:formatDateCh(invoice.due_at), pdf_url:invoice.pdf_url }
  };
  return respond(200, {
    success:true,
    dry_run:true,
    valid:true,
    eligible:true,
    can_send:true,
    preview,
    email:{ subject:copy.subject, body_text:copy.body_text },
    recipient:preview.recipient,
    invoice:preview.invoice,
    attachments:[preview.attachment],
    data:preview
  });
};
