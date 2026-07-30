'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const OPEN_REQUEST_STATUSES = new Set(['pending', 'processing', 'approved']);

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function parseBody(event) {
  try {
    return JSON.parse((event && event.body) || '{}');
  } catch (_error) {
    return null;
  }
}

function publicRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    customer_id: row.customer_id,
    contract_id: row.contract_id,
    status: row.status,
    reason: row.reason,
    requested_effective_at: row.requested_effective_at,
    approved_effective_at: row.approved_effective_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at || null,
    withdrawn_at: row.withdrawn_at || null
  };
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function calculateRequestedEffectiveAt(contract, now) {
  const base = new Date(now || Date.now());
  const rawNotice = String((contract && contract.cancellation_notice) || '30 Tage').trim().toLowerCase();
  const amountMatch = rawNotice.match(/(\d+)/);
  const amount = Math.max(1, Number(amountMatch && amountMatch[1]) || 1);
  let requested = new Date(base);

  if (/jahr|year/.test(rawNotice)) {
    requested.setUTCFullYear(requested.getUTCFullYear() + amount);
  } else if (/monat|month/.test(rawNotice)) {
    requested.setUTCMonth(requested.getUTCMonth() + amount);
  } else if (/woche|week/.test(rawNotice)) {
    requested = addUtcDays(requested, amount * 7);
  } else {
    requested = addUtcDays(requested, amountMatch ? amount : 30);
  }

  const contractualEnd = contract && contract.end_date ? new Date(contract.end_date) : null;
  if (contractualEnd && !Number.isNaN(contractualEnd.getTime()) && contractualEnd.getTime() > requested.getTime()) {
    requested = contractualEnd;
  }
  return requested.toISOString();
}

async function loadRequests(sbAdmin, customerId, contractId) {
  let query = sbAdmin
    .from('cancellation_requests')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(25);

  if (contractId) query = query.eq('contract_id', contractId);
  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Kündigungsanträge konnten nicht geladen werden.');
  return data || [];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const body = parseBody(event);
  if (!body) return response(400, { error: 'Ungültiger JSON-Body.' });

  const action = String(body.action || 'status').trim().toLowerCase();
  if (!['status', 'request_cancel', 'withdraw_request'].includes(action)) {
    return response(400, { error: 'Ungültige Aktion.' });
  }

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const caller = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    requireActiveContract: action !== 'status',
    functionName: 'customer-cancel-contract'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  const contract = caller.contractState.effectiveContract || caller.contractState.latestContract || null;
  const contractId = contract && contract.id ? String(contract.id) : '';

  try {
    if (action === 'status') {
      const rows = await loadRequests(sbAdmin, caller.customerId, contractId);
      const current = rows.find((row) => OPEN_REQUEST_STATUSES.has(String(row.status || '').toLowerCase())) || null;
      return response(200, {
        ok: true,
        current_request: publicRequest(current),
        latest_request: publicRequest(rows[0] || null)
      });
    }

    if (!contractId) return response(409, { error: 'Kein aktiver Vertrag gefunden.' });
    const contractStatus = String(contract.status || '').toLowerCase();
    if (!['active', 'signed'].includes(contractStatus)) {
      return response(409, { error: 'Für diesen Vertrag kann kein Kündigungsantrag erstellt werden.' });
    }

    if (action === 'request_cancel') {
      const reason = String(body.reason || body.termination_reason || '').trim();
      if (!reason) return response(400, { error: 'Ein Kündigungsgrund ist erforderlich.' });
      if (reason.length > 1000) return response(400, { error: 'Der Kündigungsgrund ist zu lang.' });

      const existingRows = await loadRequests(sbAdmin, caller.customerId, contractId);
      const existing = existingRows.find((row) => ['pending', 'processing'].includes(String(row.status || '').toLowerCase())) || null;
      if (existing) {
        return response(200, { ok: true, idempotent: true, request: publicRequest(existing) });
      }
      const approved = existingRows.find((row) => String(row.status || '').toLowerCase() === 'approved') || null;
      if (approved) {
        return response(409, { error: 'Die Kündigung wurde bereits genehmigt und kann nicht erneut beantragt werden.' });
      }

      const requestedEffectiveAt = calculateRequestedEffectiveAt(contract, new Date());
      const insertPayload = {
        customer_id: caller.customerId,
        contract_id: contractId,
        status: 'pending',
        reason,
        requested_effective_at: requestedEffectiveAt,
        requested_by: caller.userId,
        updated_at: new Date().toISOString()
      };
      const { data: created, error: createError } = await sbAdmin
        .from('cancellation_requests')
        .insert(insertPayload)
        .select('*')
        .single();

      if (createError && createError.code === '23505') {
        const concurrentRows = await loadRequests(sbAdmin, caller.customerId, contractId);
        const concurrent = concurrentRows.find((row) => ['pending', 'processing'].includes(String(row.status || '').toLowerCase())) || null;
        if (concurrent) return response(200, { ok: true, idempotent: true, request: publicRequest(concurrent) });
      }
      if (createError) throw createError;
      return response(201, { ok: true, request: publicRequest(created) });
    }

    const requestId = String(body.request_id || '').trim();
    let requestQuery = sbAdmin
      .from('cancellation_requests')
      .select('*')
      .eq('customer_id', caller.customerId)
      .eq('contract_id', contractId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);
    if (requestId) requestQuery = requestQuery.eq('id', requestId);

    const { data: pendingRows, error: pendingError } = await requestQuery;
    if (pendingError) throw pendingError;
    const pending = (pendingRows || [])[0] || null;
    if (!pending) {
      return response(409, { error: 'Nur ein noch nicht bearbeiteter Antrag kann zurückgezogen werden.' });
    }

    const nowIso = new Date().toISOString();
    const { data: withdrawn, error: withdrawError } = await sbAdmin
      .from('cancellation_requests')
      .update({
        status: 'withdrawn',
        withdrawn_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', pending.id)
      .eq('customer_id', caller.customerId)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();

    if (withdrawError) throw withdrawError;
    if (!withdrawn) return response(409, { error: 'Der Antrag wird bereits bearbeitet und kann nicht mehr zurückgezogen werden.' });
    return response(200, { ok: true, request: publicRequest(withdrawn) });
  } catch (error) {
    console.error('[customer-cancel-contract] failed', {
      action,
      customerId: caller.customerId,
      contractId: contractId || null,
      message: error && error.message ? error.message : String(error)
    });
    return response(500, { error: error && error.message ? error.message : 'Kündigungsantrag fehlgeschlagen.' });
  }
};
