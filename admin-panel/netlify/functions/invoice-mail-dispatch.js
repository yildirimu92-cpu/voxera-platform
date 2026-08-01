'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { createOutboxEvent, markOutboxSent, markOutboxFailed } = require('./_lib/webhook-outbox');
const { buildInvoiceMailCopy, formatDateCh, formatMoneyCh } = require('./_lib/invoice-mail-copy');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const respond = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const trim = value => String(value == null ? '' : value).trim();

function invoiceState(invoice) {
  if (invoice?.paid_at) return 'paid';
  const status = trim(invoice?.status).toLowerCase();
  if (['paid','bezahlt'].includes(status)) return 'paid';
  if (['cancelled','canceled','void','voided','storniert'].includes(status)) return 'cancelled';
  return status || 'open';
}
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trim(value)); }
function requestedType(body) {
  const raw = trim(body.mail_type || body.event_type || body.original_mail_type).toLowerCase();
  if (raw === 'reminder_final_email') return 'reminder_final_email';
  if (raw === 'reminder_email') return 'reminder_email';
  return 'invoice_email';
}
async function resolveInvoice(sbAdmin, body) {
  const invoiceId = trim(body.invoice_id);
  if (invoiceId) {
    const { data, error } = await sbAdmin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
    if (error) throw new Error(`Rechnung konnte nicht geladen werden: ${error.message}`);
    return data || null;
  }
  let query = sbAdmin.from('invoices').select('*').not('status','in','(cancelled,canceled,void,voided)').order('created_at',{ascending:false}).limit(20);
  const subscriptionId = trim(body.subscription_id);
  const customerId = trim(body.customer_id);
  if (subscriptionId) query = query.eq('subscription_id', subscriptionId);
  else if (customerId) query = query.eq('customer_id', customerId);
  else return null;
  const originalType = trim(body.original_mail_type || body.mail_type).toLowerCase();
  if (originalType === 'setup_fee_email') query = query.eq('invoice_type','setup_fee');
  const { data, error } = await query;
  if (error) throw new Error(`Rechnung konnte nicht aufgelöst werden: ${error.message}`);
  const rows = Array.isArray(data) ? data : [];
  return rows.find(row => !['paid','cancelled','canceled','void','voided'].includes(invoiceState(row))) || rows[0] || null;
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return respond(405,{error:'Method not allowed'});
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) return respond(500,{error:'Supabase-Konfiguration fehlt.'});
  const sbAdmin = createClient(supabaseUrl, serviceKey, { auth:{autoRefreshToken:false,persistSession:false} });
  const caller = await requireAdminCaller({ event, supabaseUrl, supabaseAnonKey:anonKey, sbAdmin });
  if (!caller.ok) return respond(caller.statusCode, caller.body);
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return respond(400,{error:'Ungültiger Request Body.'}); }
  try {
    const invoice = await resolveInvoice(sbAdmin, body);
    if (!invoice) return respond(404,{error:'Keine passende Rechnung gefunden.'});
    const state = invoiceState(invoice);
    if (state === 'paid') return respond(409,{error:'Eine bezahlte Rechnung wird nicht erneut versendet.'});
    if (state === 'cancelled') return respond(409,{error:'Eine stornierte Rechnung darf nicht versendet werden.'});
    if (!trim(invoice.pdf_url) || !trim(invoice.qr_payload) || Number(invoice.pdf_version || 0) < 1) {
      return respond(409,{error:'Die Rechnung wurde noch nicht als PDF erstellt.',invoice_id:invoice.id,step_failed:'invoice_pdf_missing'});
    }
    const { data:customer, error:customerError } = await sbAdmin.from('customers').select('*').eq('id',invoice.customer_id).maybeSingle();
    if (customerError) return respond(500,{error:'Kunde konnte nicht geladen werden.',details:customerError.message});
    if (!customer) return respond(404,{error:'Kunde zur Rechnung nicht gefunden.'});
    const recipientEmail = trim(body?.overrides?.to_email || customer.email);
    if (!isValidEmail(recipientEmail)) return respond(400,{error:'Die Empfänger-E-Mail ist ungültig.'});
    const type = requestedType(body);
    const copy = buildInvoiceMailCopy(type, invoice, customer);
    const filename = `Voxera-Rechnung-${invoice.invoice_number || invoice.id}.pdf`;
    const now = new Date().toISOString();
    const payload = {
      event_type:type, mail_type:type,
      recipient:{ email:recipientEmail, name:trim(customer.contact_name || customer.customer_name || customer.company_name) || null },
      customer:{ id:customer.id, customer_name:customer.customer_name || customer.company_name || null, contact_name:customer.contact_name || null, email:customer.email || null },
      invoice:{
        id:invoice.id, invoice_number:invoice.invoice_number || null, invoice_type:invoice.invoice_type || null,
        status:invoice.status || null, amount:Number(invoice.total_amount || 0), amount_formatted:formatMoneyCh(invoice.total_amount,invoice.currency || 'CHF'),
        currency:invoice.currency || 'CHF', issued_at:invoice.issued_at || null, issued_on:formatDateCh(invoice.issued_at),
        due_at:invoice.due_at || null, due_on:formatDateCh(invoice.due_at), pdf_url:invoice.pdf_url,
        attachment_url:invoice.pdf_url, attachment_filename:filename, pdf_version:Number(invoice.pdf_version || 0),
        payment_method:'invoice', payment_reference:invoice.payment_reference || null, billing_provider:'invoice', has_payment_link:false
      },
      attachments:[{ filename, url:invoice.pdf_url, content_type:'application/pdf' }],
      email:{ subject:copy.subject, intro:copy.intro, payment_instruction:copy.payment_instruction, body_text:copy.body_text, locale:'de-CH', timezone:'Europe/Zurich' },
      meta:{ source:'admin_panel', requested_at:now, requested_by:caller.userId || null, locale:'de-CH', timezone:'Europe/Zurich', invoice_only:true, stripe_disabled:true }
    };
    const requestId = trim(body.request_id);
    const dedupeKey = requestId ? `${type}:${invoice.id}:request:${requestId}` : `${type}:${invoice.id}:pdf:${invoice.pdf_version || 1}:${Date.now()}`;
    const outbox = await createOutboxEvent(sbAdmin,{eventType:type,payload,payloadSummary:`${type} -> ${recipientEmail}`,dedupeKey});
    const webhookUrl = process.env.MAKE_MAIL_WEBHOOK;
    if (!webhookUrl) {
      await markOutboxFailed(sbAdmin,outbox.id,'MAKE_MAIL_WEBHOOK not configured');
      return respond(500,{error:'MAKE_MAIL_WEBHOOK ist nicht konfiguriert.',outbox_id:outbox.id});
    }
    const webhookResponse = await fetch(webhookUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if (!webhookResponse.ok) {
      const message = `Make webhook failed: ${webhookResponse.status}`;
      await markOutboxFailed(sbAdmin,outbox.id,message);
      return respond(502,{error:'Rechnungs-E-Mail konnte nicht übergeben werden.',details:message,outbox_id:outbox.id});
    }
    await markOutboxSent(sbAdmin,outbox.id);
    if (type === 'invoice_email') await sbAdmin.from('invoices').update({status:'sent',sent_at:now,updated_at:now}).eq('id',invoice.id);
    return respond(200,{success:true,accepted:true,delivery_confirmed:false,event_type:type,outbox_id:outbox.id,data:{invoice_id:invoice.id,invoice_number:invoice.invoice_number || null,sent_to_email:recipientEmail,pdf_url:invoice.pdf_url,payment_method:'invoice'}});
  } catch (error) {
    return respond(500,{error:error?.message || 'Rechnungs-E-Mail konnte nicht vorbereitet werden.'});
  }
};
