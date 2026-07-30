'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
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

function parseBody(event) {
  try {
    return JSON.parse((event && event.body) || '{}');
  } catch (_error) {
    return null;
  }
}

function normalizeEffectiveAt(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Wirksamkeitsdatum ist erforderlich.');
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(raw + 'T00:00:00.000Z')
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error('Wirksamkeitsdatum ist ungültig.');
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  if (parsed.getTime() < todayStart.getTime()) {
    throw new Error('Wirksamkeitsdatum darf nicht in der Vergangenheit liegen.');
  }
  return parsed.toISOString();
}

async function loadRequest(sbAdmin, requestId) {
  const { data, error } = await sbAdmin
    .from('cancellation_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadContract(sbAdmin, contractId) {
  const { data, error } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function setProcessing(sbAdmin, requestId, expectedStatus, processingAction) {
  const nowIso = new Date().toISOString();
  const { data, error } = await sbAdmin
    .from('cancellation_requests')
    .update({
      status: 'processing',
      processing_action: processingAction,
      updated_at: nowIso
    })
    .eq('id', requestId)
    .eq('status', expectedStatus)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function restoreRequestStatus(sbAdmin, requestId, status) {
  const { error } = await sbAdmin
    .from('cancellation_requests')
    .update({
      status,
      processing_action: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', requestId)
    .eq('status', 'processing');
  if (error) {
    console.error('[admin-cancellation-request] recovery failed', {
      requestId,
      targetStatus: status,
      message: error.message
    });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const body = parseBody(event);
  if (!body) return response(400, { error: 'Ungültiger JSON-Body.' });

  const action = String(body.action || '').trim().toLowerCase();
  const requestId = String(body.request_id || '').trim();
  if (!['approve', 'reject', 'finalize'].includes(action)) return response(400, { error: 'Ungültige Aktion.' });
  if (!requestId) return response(400, { error: 'request_id ist erforderlich.' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return response(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const caller = await requireAdminCaller({
    event,
    supabaseUrl,
    supabaseAnonKey,
    sbAdmin,
    requiredCapability: 'contract:write'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let requestRow;
  let contract;
  try {
    requestRow = await loadRequest(sbAdmin, requestId);
    if (!requestRow) return response(404, { error: 'Kündigungsantrag nicht gefunden.' });

    contract = await loadContract(sbAdmin, requestRow.contract_id);
    if (!contract || String(contract.customer_id) !== String(requestRow.customer_id)) {
      return response(409, { error: 'Kündigungsantrag und Vertrag sind nicht konsistent verknüpft.' });
    }

    const actor = { userId: caller.userId, role: caller.role };
    const currentStatus = String(requestRow.status || '').toLowerCase();
    const processingAction = String(requestRow.processing_action || '').toLowerCase();

    if (action === 'reject') {
      if (currentStatus !== 'pending') {
        return response(409, { error: 'Nur ein offener Antrag kann abgelehnt werden.' });
      }
      const note = String(body.admin_note || '').trim();
      if (!note) return response(400, { error: 'Für die Ablehnung ist eine interne Begründung erforderlich.' });
      const nowIso = new Date().toISOString();
      const { data: rejected, error: rejectError } = await sbAdmin
        .from('cancellation_requests')
        .update({
          status: 'rejected',
          processing_action: null,
          reviewed_at: nowIso,
          reviewed_by: caller.userId,
          admin_note: note.slice(0, 2000),
          updated_at: nowIso
        })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();
      if (rejectError) throw rejectError;
      if (!rejected) return response(409, { error: 'Der Antrag wurde zwischenzeitlich verändert.' });
      return response(200, { ok: true, request: rejected });
    }

    if (action === 'approve') {
      if (currentStatus === 'approved') return response(200, { ok: true, idempotent: true, request: requestRow });
      if (!['pending', 'processing'].includes(currentStatus) || (currentStatus === 'processing' && processingAction !== 'approve')) {
        return response(409, { error: 'Dieser Antrag kann nicht genehmigt werden.' });
      }

      const effectiveAt = normalizeEffectiveAt(body.effective_at || requestRow.approved_effective_at || requestRow.requested_effective_at);
      if (currentStatus === 'pending') {
        const locked = await setProcessing(sbAdmin, requestId, 'pending', 'approve');
        if (!locked) return response(409, { error: 'Der Antrag wird bereits bearbeitet.' });
      }

      try {
        const alreadyScheduled = (
          String(contract.termination_type || '') === 'customer_request_approved' &&
          String(contract.cancellation_date || '').slice(0, 10) === effectiveAt.slice(0, 10)
        );
        if (!alreadyScheduled) {
          await executeCommercialCommand({
            sbAdmin,
            actor,
            command: 'contracts.update',
            payload: {
              contract_id: contract.id,
              patch: {
                cancellation_date: effectiveAt,
                termination_reason: requestRow.reason,
                termination_type: 'customer_request_approved'
              }
            }
          });
        }

        const nowIso = new Date().toISOString();
        const { data: approved, error: approveError } = await sbAdmin
          .from('cancellation_requests')
          .update({
            status: 'approved',
            processing_action: null,
            approved_effective_at: effectiveAt,
            reviewed_at: nowIso,
            reviewed_by: caller.userId,
            admin_note: String(body.admin_note || requestRow.admin_note || '').trim().slice(0, 2000) || null,
            updated_at: nowIso
          })
          .eq('id', requestId)
          .eq('status', 'processing')
          .eq('processing_action', 'approve')
          .select('*')
          .maybeSingle();
        if (approveError) throw approveError;
        if (!approved) throw new Error('Vertrag wurde vorgemerkt, aber der Antragstatus konnte nicht abgeschlossen werden.');
        return response(200, { ok: true, request: approved });
      } catch (error) {
        await restoreRequestStatus(sbAdmin, requestId, 'pending');
        throw error;
      }
    }

    if (currentStatus === 'finalized') return response(200, { ok: true, idempotent: true, request: requestRow });
    if (!['approved', 'processing'].includes(currentStatus) || (currentStatus === 'processing' && processingAction !== 'finalize')) {
      return response(409, { error: 'Nur eine genehmigte Kündigung kann abgeschlossen werden.' });
    }

    const effectiveAt = new Date(requestRow.approved_effective_at || requestRow.requested_effective_at || '');
    if (Number.isNaN(effectiveAt.getTime())) return response(409, { error: 'Wirksamkeitsdatum fehlt oder ist ungültig.' });
    if (effectiveAt.getTime() > Date.now()) {
      return response(409, { error: 'Die Kündigung ist noch nicht wirksam.' });
    }
    if (currentStatus === 'approved') {
      const locked = await setProcessing(sbAdmin, requestId, 'approved', 'finalize');
      if (!locked) return response(409, { error: 'Der Antrag wird bereits bearbeitet.' });
    }

    try {
      if (String(contract.status || '').toLowerCase() !== 'cancelled') {
        await executeCommercialCommand({
          sbAdmin,
          actor,
          command: 'contracts.cancel',
          payload: {
            contract_id: contract.id,
            notes: String(contract.notes || '').trim()
          }
        });
      }

      const nowIso = new Date().toISOString();
      const { data: finalized, error: finalizeError } = await sbAdmin
        .from('cancellation_requests')
        .update({
          status: 'finalized',
          processing_action: null,
          updated_at: nowIso
        })
        .eq('id', requestId)
        .eq('status', 'processing')
        .eq('processing_action', 'finalize')
        .select('*')
        .maybeSingle();
      if (finalizeError) throw finalizeError;
      if (!finalized) throw new Error('Vertrag wurde beendet, aber der Antragstatus konnte nicht abgeschlossen werden.');
      return response(200, { ok: true, request: finalized });
    } catch (error) {
      await restoreRequestStatus(sbAdmin, requestId, 'approved');
      throw error;
    }
  } catch (error) {
    console.error('[admin-cancellation-request] failed', {
      action,
      requestId,
      customerId: requestRow && requestRow.customer_id ? requestRow.customer_id : null,
      contractId: contract && contract.id ? contract.id : null,
      message: error && error.message ? error.message : String(error)
    });
    return response(500, {
      error: error && error.message ? error.message : 'Kündigungsantrag konnte nicht bearbeitet werden.',
      code: 'cancellation_request_processing_failed'
    });
  }
};
