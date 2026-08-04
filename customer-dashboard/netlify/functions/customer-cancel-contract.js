'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMonths(date, months) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function resolveTermMonths(contract) {
  const candidates = [
    contract.duration_months,
    contract.contract_duration_months,
    contract.initial_term_months,
    contract.term_months,
    contract.duration
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0 && numeric <= 120) return Math.round(numeric);
    const match = String(candidate || '').match(/(\d+)/);
    if (match) {
      const parsed = Number(match[1]);
      if (parsed > 0 && parsed <= 120) return parsed;
    }
  }
  return 12;
}

function resolveNoticeDays(contract) {
  const raw = String(contract.cancellation_notice || contract.notice_period || '').toLowerCase();
  const match = raw.match(/(\d+)/);
  const value = match ? Number(match[1]) : 30;
  if (/monat/.test(raw)) return Math.max(0, value * 30);
  return Math.max(0, value);
}

function resolveCancellationDate(contract, now = new Date()) {
  const termMonths = resolveTermMonths(contract);
  const noticeDays = resolveNoticeDays(contract);
  const noticeDeadline = new Date(now.getTime() + noticeDays * 24 * 60 * 60 * 1000);
  const startDate = validDate(contract.start_date || contract.contract_start_date || contract.accepted_at || contract.created_at);
  let termEnd = validDate(contract.end_date || contract.contract_end_date || contract.next_renewal_date || contract.renewal_date);

  if (!termEnd && startDate) termEnd = addMonths(startDate, termMonths);
  if (!termEnd) throw new Error('contract_end_date_missing');

  while (termEnd.getTime() < noticeDeadline.getTime()) {
    termEnd = addMonths(termEnd, termMonths);
  }
  return termEnd;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    requireActiveContract: true,
    functionName: 'customer-cancel-contract'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return response(400, { error: 'Ungueltiger Request Body' });
  }

  const action = String((body && body.action) || '').trim().toLowerCase();
  if (!['cancel', 'reactivate'].includes(action)) {
    return response(400, { error: 'action muss cancel oder reactivate sein' });
  }

  const activeContract = (caller.contractState && caller.contractState.activeContract)
    || (caller.contractState && caller.contractState.effectiveContract)
    || null;
  if (!activeContract || !activeContract.id || !['active', 'signed'].includes(String(activeContract.status || '').toLowerCase())) {
    return response(409, { error: 'Kein aktiver Vertrag gefunden.', code: 'active_contract_missing' });
  }

  const hasCancellation = !!(activeContract.cancellation_date || activeContract.termination_type || activeContract.termination_reason);
  if (action === 'reactivate' && !hasCancellation) {
    return response(409, {
      error: 'Für diesen Vertrag ist keine offene Kündigung vorhanden.',
      code: 'cancellation_not_pending'
    });
  }

  const updatePayload = { updated_at: new Date().toISOString() };
  if (action === 'cancel') {
    const reason = String((body && body.termination_reason) || '').trim();
    if (!reason) return response(400, { error: 'termination_reason ist erforderlich.' });
    if (hasCancellation) {
      return response(409, { error: 'Für diesen Vertrag wurde bereits eine Kündigung eingereicht.', code: 'cancellation_already_pending' });
    }

    let cancellationDate;
    try {
      cancellationDate = resolveCancellationDate(activeContract);
    } catch (error) {
      console.error('[customer-cancel-contract] cancellation date unresolved', {
        contractId: activeContract.id,
        startDate: activeContract.start_date || null,
        endDate: activeContract.end_date || null,
        duration: activeContract.duration_months || activeContract.contract_duration || null
      });
      return response(409, {
        error: 'Der nächstmögliche Kündigungstermin konnte nicht sicher bestimmt werden. Bitte kontaktieren Sie Voxera.',
        code: 'cancellation_date_unresolved'
      });
    }

    updatePayload.cancellation_date = cancellationDate.toISOString();
    updatePayload.termination_reason = reason;
    updatePayload.termination_type = 'customer_request';
  } else {
    updatePayload.cancellation_date = null;
    updatePayload.termination_reason = null;
    updatePayload.termination_type = null;
  }

  const { data: updatedContract, error: updateError } = await sbAdmin
    .from('contracts')
    .update(updatePayload)
    .eq('id', activeContract.id)
    .eq('customer_id', caller.customerId)
    .in('status', ['active', 'signed'])
    .select('*')
    .maybeSingle();

  if (updateError) {
    console.error('[customer-cancel-contract] update failed', {
      customerId: caller.customerId,
      contractId: activeContract.id,
      action,
      code: updateError.code,
      message: updateError.message
    });
    return response(500, { error: 'Vertrag konnte nicht aktualisiert werden.', code: 'contract_update_failed' });
  }
  if (!updatedContract) {
    return response(409, {
      error: 'Der Vertragsstatus hat sich zwischenzeitlich geändert. Bitte laden Sie die Seite neu.',
      code: 'contract_update_conflict'
    });
  }

  return response(200, {
    success: true,
    action,
    contract: updatedContract,
    cancellation_date: updatedContract.cancellation_date || null,
    message: action === 'reactivate'
      ? 'Die Kündigung wurde zurückgezogen. Ihr Vertrag läuft weiter.'
      : 'Die Kündigung wurde zum nächstmöglichen vertraglichen Termin eingereicht.'
  });
};
