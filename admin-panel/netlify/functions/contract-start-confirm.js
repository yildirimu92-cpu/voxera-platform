'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { syncPostAcceptanceLifecycle } = require('./_lib/offer-acceptance');
const { activateContractSafely } = require('./_lib/contract-activation-service');

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

function normalizeActivationError(err) {
  const step = String(err?.step_failed || 'contracts.activate');
  const dbMessage = err?.db_message || err?.message || null;
  const orchestrationFailure = err?.error === 'Contract billing orchestration failed';
  const baseMessage = orchestrationFailure
    ? `Vertragsaktivierung im Schritt "${step}" fehlgeschlagen`
    : String(err?.message || err?.error || 'Contract activation failed');
  return {
    error: orchestrationFailure && dbMessage ? `${baseMessage}: ${dbMessage}` : baseMessage,
    step_failed: step,
    diagnostics: {
      db_message: err?.db_message || null,
      db_code: err?.db_code || null,
      db_details: err?.db_details || null,
      db_hint: err?.db_hint || null,
      contract_id: err?.contract_id || null,
      customer_id: err?.customer_id || null,
      subscription_id: err?.subscription_id || null,
      setup_fee_invoice_id: err?.setup_fee_invoice_id || null,
      month_1_invoice_id: err?.month_1_invoice_id || null
    }
  };
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
    const result = await activateContractSafely({
      sbAdmin,
      actor: { userId: caller.userId, role: caller.role },
      contractId,
      requestedCustomerId: body.customer_id || null,
      startDate,
      durationMonths,
      endDate,
      notes: body.notes || null
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
      activation_recovery: Boolean(result.activation_recovery),
      removed_schema_columns: result.removed_schema_columns || [],
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
    const normalized = normalizeActivationError(err);
    const status = /not found|nicht gefunden/i.test(normalized.error) ? 404 : 409;
    console.error('[contract-start-confirm] activation failed', JSON.stringify({ contract_id: contractId, customer_id: body.customer_id || null, step_failed: normalized.step_failed, diagnostics: normalized.diagnostics }));
    return response(status, normalized);
  }
};
