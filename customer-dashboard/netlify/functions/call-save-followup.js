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

// ─── Call Status Model (inline, kein Import nötig) ────────────────────────────
const CALL_STATUS = {
  NEW:                  'new',
  IN_PROGRESS:          'in_progress',
  FOLLOW_UP_SCHEDULED:  'follow_up_scheduled',
  CLOSED:               'closed',
  ARCHIVED:             'archived'
};

function normalizeCallStatus(raw) {
  const s = String(raw || '').toLowerCase().trim();
  const map = {
    'new': CALL_STATUS.NEW,
    'in_progress': CALL_STATUS.IN_PROGRESS,
    'in progress': CALL_STATUS.IN_PROGRESS,
    'follow_up_scheduled': CALL_STATUS.FOLLOW_UP_SCHEDULED,
    'follow up scheduled': CALL_STATUS.FOLLOW_UP_SCHEDULED,
    'closed': CALL_STATUS.CLOSED,
    'done': CALL_STATUS.CLOSED,
    'complete': CALL_STATUS.CLOSED,
    'completed': CALL_STATUS.CLOSED,
    'archived': CALL_STATUS.ARCHIVED
  };
  return map[s] || CALL_STATUS.NEW;
}

// Erlaubte Übergänge
const CALL_TRANSITIONS = {
  [CALL_STATUS.NEW]:                 [CALL_STATUS.IN_PROGRESS, CALL_STATUS.CLOSED, CALL_STATUS.FOLLOW_UP_SCHEDULED],
  [CALL_STATUS.IN_PROGRESS]:         [CALL_STATUS.FOLLOW_UP_SCHEDULED, CALL_STATUS.CLOSED],
  [CALL_STATUS.FOLLOW_UP_SCHEDULED]: [CALL_STATUS.IN_PROGRESS, CALL_STATUS.CLOSED],
  [CALL_STATUS.CLOSED]:              [CALL_STATUS.ARCHIVED],
  [CALL_STATUS.ARCHIVED]:            []
};

function assertCallTransition(from, to) {
  const allowed = CALL_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Ungültiger Status-Übergang: ${from} → ${to}`);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    requireActiveContract: false,
    functionName: 'call-save-followup'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) {
    return response(400, { error: 'Ungültiger Request Body' });
  }

  const callId = String(body.call_id || '').trim();
  if (!callId) return response(400, { error: 'call_id fehlt' });

  // Call laden und Ownership prüfen
  const { data: callRow, error: callError } = await sbAdmin
    .from('calls')
    .select('id, customer_id, dashboard_status')
    .eq('id', callId)
    .maybeSingle();

  if (callError) return response(500, { error: 'Call lookup fehlgeschlagen', details: callError.message });
  if (!callRow) return response(404, { error: 'Call nicht gefunden' });
  if (String(callRow.customer_id) !== caller.customerId) {
    return response(403, { error: 'Call gehört nicht zu diesem Kunden' });
  }

  // Patch zusammenstellen
  const patch = { updated_at: new Date().toISOString() };
  if (body.notes_customer_voxera != null) patch.notes_customer_voxera = String(body.notes_customer_voxera).trim() || null;
  if (body.next_action != null) patch.next_action = String(body.next_action).trim() || null;
  if (body.follow_up_at != null) patch.follow_up_at = String(body.follow_up_at).trim() || null;

  // Status-Übergang berechnen
  const currentStatus = normalizeCallStatus(callRow.dashboard_status);
  const markComplete = body.mark_complete === true;
  const followUpSet = !!patch.follow_up_at;

  let targetStatus = null;
  if (markComplete) {
    targetStatus = CALL_STATUS.CLOSED;
  } else if (followUpSet && currentStatus === CALL_STATUS.NEW) {
    targetStatus = CALL_STATUS.FOLLOW_UP_SCHEDULED;
  } else if (followUpSet && currentStatus === CALL_STATUS.IN_PROGRESS) {
    targetStatus = CALL_STATUS.FOLLOW_UP_SCHEDULED;
  }

  if (targetStatus) {
    try {
      // NEW → FOLLOW_UP_SCHEDULED via IN_PROGRESS (erlaubt)
      if (currentStatus === CALL_STATUS.NEW && targetStatus === CALL_STATUS.FOLLOW_UP_SCHEDULED) {
        // Direktübergang erlauben ohne Zwischenschritt
      } else {
        assertCallTransition(currentStatus, targetStatus);
      }
    } catch (e) {
      return response(409, { error: e.message, from_status: currentStatus, to_status: targetStatus });
    }
    patch.dashboard_status = targetStatus;
    if (targetStatus === CALL_STATUS.CLOSED) patch.follow_up_at = null;
  }

  // Nur updated_at → nichts zu tun
  if (Object.keys(patch).length === 1) {
    return response(400, { error: 'Keine Änderungen übergeben' });
  }

  const { data, error } = await sbAdmin
    .from('calls')
    .update(patch)
    .eq('id', callId)
    .eq('customer_id', caller.customerId)
    .select('*')
    .single();

  if (error) return response(500, { error: 'Follow-up konnte nicht gespeichert werden.', details: error.message });
  return response(200, { success: true, call: data });
};
