'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const text = value => String(value == null ? '' : value).trim();
const money = value => {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
};
const invoiceTotal = invoice => money(invoice?.total_amount ?? invoice?.total ?? invoice?.amount ?? 0);
const lower = value => text(value).toLowerCase();

async function loadSnapshot(sb, invoiceId) {
  const { data: invoice, error: invoiceError } = await sb
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();
  if (invoiceError) throw new Error(`Invoice lookup failed: ${invoiceError.message}`);
  if (!invoice) return null;

  const [{ data: creditNotes, error: creditError }, { data: refunds, error: refundError }] = await Promise.all([
    sb.from('invoices')
      .select('*')
      .eq('source_invoice_id', invoiceId)
      .eq('invoice_type', 'credit_note')
      .order('created_at', { ascending:false }),
    sb.from('invoice_refunds')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('refunded_at', { ascending:false })
  ]);
  if (creditError) throw new Error(`Credit-note lookup failed: ${creditError.message}`);
  if (refundError) throw new Error(`Refund lookup failed: ${refundError.message}`);

  const activeCredits = (creditNotes || []).filter(row => !['cancelled','void'].includes(lower(row.status)));
  const credited = money(activeCredits.reduce((sum,row) => sum + Math.abs(invoiceTotal(row)), 0));
  const refunded = money((refunds || []).filter(row => !['failed','cancelled'].includes(lower(row.status)))
    .reduce((sum,row) => sum + money(row.amount), 0));
  const total = invoiceTotal(invoice);
  const remainingCreditable = money(Math.max(total - credited, 0));
  const paid = lower(invoice.status) === 'paid' || Boolean(invoice.paid_at);
  const outstanding = paid ? 0 : money(Math.max(total - credited, 0));
  const refundDue = paid ? money(Math.max(credited - refunded, 0)) : 0;
  const status = lower(invoice.status);

  return {
    invoice,
    credit_notes: creditNotes || [],
    refunds: refunds || [],
    summary: {
      total_amount: total,
      credited_amount: credited,
      outstanding_amount: outstanding,
      refunded_amount: refunded,
      remaining_creditable_amount: remainingCreditable,
      refund_due_amount: refundDue,
      paid
    },
    actions: {
      can_void_draft: status === 'draft' && !invoice.sent_at && credited === 0,
      can_create_credit: !['draft','cancelled','void','credited'].includes(status) && remainingCreditable > 0,
      can_record_refund: paid && refundDue > 0
    }
  };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return response(405, { error:'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error:'Supabase-Konfiguration fehlt.' });

  const sb = createClient(sbUrl, sbServiceKey, { auth:{ autoRefreshToken:false, persistSession:false } });
  const caller = await requireAdminCaller({
    event,
    supabaseUrl:sbUrl,
    supabaseAnonKey:sbAnonKey,
    sbAdmin:sb,
    requiredCapability:'billing:write'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return response(400, { error:'Ungültiger Request Body.' }); }

  const action = lower(body.action || 'inspect');
  const invoiceId = text(body.invoice_id);
  if (!invoiceId) return response(400, { error:'invoice_id ist erforderlich.' });
  if (!['inspect','void_draft','create_credit','record_refund'].includes(action)) {
    return response(400, { error:'Unbekannte Finanzaktion.' });
  }

  try {
    if (action === 'inspect') {
      const snapshot = await loadSnapshot(sb, invoiceId);
      if (!snapshot) return response(404, { error:'Rechnung nicht gefunden.' });
      return response(200, { success:true, action, ...snapshot });
    }

    const requestId = text(body.request_id);
    if (!requestId) return response(400, { error:'request_id ist erforderlich.' });
    const amount = body.amount == null || body.amount === '' ? null : money(body.amount);
    const reason = text(body.reason) || null;

    const { data, error } = await sb.rpc('admin_apply_invoice_financial_action_v1', {
      p_action:action,
      p_invoice_id:invoiceId,
      p_amount:amount,
      p_reason:reason,
      p_actor_user_id:caller.userId,
      p_actor_role:caller.role,
      p_request_id:requestId,
      p_refund_method:text(body.refund_method) || null,
      p_refund_reference:text(body.refund_reference) || null
    });

    if (error) {
      const conflictCodes = new Set(['22023','23514','P0002']);
      return response(conflictCodes.has(String(error.code || '')) ? 409 : 500, {
        error:error.message || 'Finanzaktion fehlgeschlagen.',
        error_code:error.code || null,
        details:error.details || null,
        hint:error.hint || null
      });
    }

    const snapshot = await loadSnapshot(sb, invoiceId);
    return response(200, {
      success:true,
      action,
      result:data || null,
      ...(snapshot || {})
    });
  } catch (error) {
    return response(500, { error:'Rechnungsdaten konnten nicht verarbeitet werden.', details:error.message || String(error) });
  }
};
