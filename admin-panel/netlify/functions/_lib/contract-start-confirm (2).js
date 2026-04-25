'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { syncPostAcceptanceLifecycle } = require('./_lib/offer-acceptance');
const { executeCommercialCommand } = require('./_lib/commercial-orchestrator');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function addMonthsDateIsoUtc(dateStr, months) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  const next = new Date(base.getTime());
  next.setUTCMonth(next.getUTCMonth() + Number(months || 0));
  return next.toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungültiger Request Body' }); }

  const contractId = String(body.contract_id || '').trim();
  const startDate = String(body.start_date || '').trim();
  const durationMonths = Math.max(1, Math.trunc(Number(body.term_months || body.duration_months || 0) || 0));
  const computedEndDate = addMonthsDateIsoUtc(startDate, durationMonths);
  const endDate = String(body.end_date || computedEndDate || '').trim();
  if (!contractId) return response(400, { error: 'contract_id fehlt.' });
  if (!startDate || !computedEndDate || !endDate) return response(400, { error: 'start_date oder duration_months ungültig.' });
  if (endDate !== computedEndDate) return response(409, { error: 'end_date ist inkonsistent zur Kombination aus start_date und duration_months.' });

  try {
    const result = await executeCommercialCommand({
      sbAdmin,
      actor: { userId: caller.userId, role: caller.role },
      command: 'contracts.activate',
      payload: {
        contract_id: contractId,
        customer_id: body.customer_id || null,
        start_date: startDate,
        term_months: durationMonths,
        end_date: endDate,
        notes: body.notes || null
      }
    });

    try {
      await syncPostAcceptanceLifecycle({
        sbAdmin,
        offer: { customer_id: result.contract?.customer_id || body.customer_id || null },
        nowIso: new Date().toISOString()
      });
    } catch (lifecycleErr) {
      console.warn('[contract-start-confirm] syncPostAcceptanceLifecycle failed (non-fatal):', lifecycleErr?.message || lifecycleErr);
    }

    return response(200, {
      success: true,
      contract_updated: true,
      subscription_ready: Boolean(result.subscription?.id),
      follow_up_required: false,
      follow_up_issues: [],
      diagnostics: null,
      setup_fee_invoice_created: Boolean(result.setup_fee_invoice_created),
      recurring_invoice_created: Boolean(result.recurring_invoice_created),
      pdfs_generated: Boolean(result.pdfs_generated),
      pdf_generation_errors: result.pdf_generation_errors || [],
      contract: result.contract,
      subscription: result.subscription || null,
      setup_fee_invoice: result.setup_fee_invoice || null,
      recurring_invoice: result.recurring_invoice || null,
      read_model: result.read_model || null
    });
  } catch (err) {
    const status = /not found|nicht gefunden/i.test(String(err?.message || '')) ? 404 : 409;
    return response(status, {
      error: err?.message || 'Contract activation failed',
      step_failed: 'contracts.activate'
    });
  }
};
