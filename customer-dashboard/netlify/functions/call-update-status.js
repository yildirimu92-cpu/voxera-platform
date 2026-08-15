const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const { normalizeCallStatus, assertCallTransition, CALL_STATUS } = require('./_lib/status-model');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function logStatusUpdate(event, details) {
  try {
    console.log('[call-update-status]', event, JSON.stringify(details || {}));
  } catch (_e) {
    console.log('[call-update-status]', event);
  }
}

function buildTransitionSequence(current, target) {
  if (current === target) return [];
  if (target === CALL_STATUS.ARCHIVED) {
    if (current === CALL_STATUS.NEW) {
      return [CALL_STATUS.IN_PROGRESS, CALL_STATUS.FOLLOW_UP_SCHEDULED, CALL_STATUS.CLOSED, CALL_STATUS.ARCHIVED];
    }
    if (current === CALL_STATUS.IN_PROGRESS) {
      return [CALL_STATUS.FOLLOW_UP_SCHEDULED, CALL_STATUS.CLOSED, CALL_STATUS.ARCHIVED];
    }
    if (current === CALL_STATUS.FOLLOW_UP_SCHEDULED) {
      return [CALL_STATUS.CLOSED, CALL_STATUS.ARCHIVED];
    }
    if (current === CALL_STATUS.CLOSED) {
      return [CALL_STATUS.ARCHIVED];
    }
  }
  // Wiederherstellen: archived → closed (direkt)
  if (current === CALL_STATUS.ARCHIVED && target === CALL_STATUS.CLOSED) {
    return [CALL_STATUS.CLOSED];
  }
  if (current === CALL_STATUS.NEW && target === CALL_STATUS.FOLLOW_UP_SCHEDULED) {
    return [CALL_STATUS.IN_PROGRESS, CALL_STATUS.FOLLOW_UP_SCHEDULED];
  }
  if (current === CALL_STATUS.NEW && target === CALL_STATUS.CLOSED) {
    return [CALL_STATUS.IN_PROGRESS, CALL_STATUS.FOLLOW_UP_SCHEDULED, CALL_STATUS.CLOSED];
  }
  if (current === CALL_STATUS.IN_PROGRESS && target === CALL_STATUS.CLOSED) {
    return [CALL_STATUS.FOLLOW_UP_SCHEDULED, CALL_STATUS.CLOSED];
  }
  return [target];
}

/**
 * Lifecycle-Zeitstempel zum ZIEL-Status.
 *
 * Diese Logik stand bis 2026-08-12 im Browser (`applyStatusTransition` ->
 * `vxBestEffortPatchCallLifecycle`) und lief dort ins Leere: `authenticated`
 * hat auf `public.calls` ein SPALTENWEISES UPDATE-Recht, und weder
 * `completed_at` noch `archived_at` stehen darin. PostgREST lehnt daraufhin
 * das GANZE Update ab -- auch das `updated_at`, fuer das ein Recht besteht.
 * Seit Einfuehrung der Funktionen wurde also kein einziger Lifecycle-Zeitstempel
 * geschrieben, und der catch-Zweig setzte den Wert im Browser trotzdem lokal:
 * die Oberflaeche zeigte einen Zustand, den die Datenbank nicht hatte.
 *
 * Hier ist die richtige Stelle. Der Kommentar im Browser nannte diese Function
 * selbst "die autoritative Status-Function"; sie laeuft mit service_role, hat
 * das Recht ohnehin, und die Kundenschreibflaeche wird nicht um zwei
 * Zeitstempel erweitert.
 *
 * ZIELBEZOGEN, nicht schrittbezogen -- bewusst. Die Uebergangskette kann
 * Zwischenstufen enthalten (NEW -> ... -> CLOSED -> ARCHIVED). Wuerde jede
 * Stufe stempeln, bekaeme ein direkt archivierter Anruf ein `completed_at`,
 * obwohl ihn nie jemand abgeschlossen hat. Das waere ein erfundener Wert. Die
 * Regel bleibt deshalb exakt die, die der Browser hatte: es zaehlt, wo die
 * Kette endet.
 */
function lifecycleStempel(zielStatus, jetzt) {
  if (zielStatus === CALL_STATUS.CLOSED) return { completed_at: jetzt, archived_at: null };
  if (zielStatus === CALL_STATUS.ARCHIVED) return { archived_at: jetzt };
  // NEW ist ueber assertCallTransition kein erreichbares Ziel (keine Kante
  // fuehrt dorthin). Der Zweig stand im Browser und wird mitgenommen, damit die
  // Regel vollstaendig an einer Stelle steht, falls die Kante je entsteht.
  if (zielStatus === CALL_STATUS.NEW) return { completed_at: null, archived_at: null };
  return {};
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
    requireActiveContract: false,
    functionName: 'call-update-status'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungueltiger Request Body' }); }

  const callId = String(body.call_id || '').trim();
  const incomingStatus = body.status;
  const targetStatus = normalizeCallStatus(incomingStatus);
  if (!callId) return response(400, { error: 'call_id fehlt' });

  const { data: callRow, error: callError } = await sbAdmin
    .from('calls')
    .select('id, customer_id, dashboard_status, follow_up_at')
    .eq('id', callId)
    .maybeSingle();

  if (callError) return response(500, { error: 'Call lookup failed', details: callError.message });
  if (!callRow) return response(404, { error: 'Call nicht gefunden' });
  if (String(callRow.customer_id) !== caller.customerId) return response(403, { error: 'Call gehoert nicht zum Customer-Kontext' });

  const currentStatus = normalizeCallStatus(callRow.dashboard_status || CALL_STATUS.NEW);
  const sequence = buildTransitionSequence(currentStatus, targetStatus);
  const transitionCheck = {
    incomingStatus,
    normalizedCurrentStatus: currentStatus,
    targetStatus: incomingStatus,
    normalizedTargetStatus: targetStatus,
    transitionSequence: sequence
  };

  try {
    let cursor = currentStatus;
    for (const status of sequence) {
      assertCallTransition(cursor, status);
      cursor = status;
    }
    logStatusUpdate('transition_check', {
      ...transitionCheck,
      allowedTransition: true
    });
  } catch (e) {
    logStatusUpdate('transition_check', {
      ...transitionCheck,
      allowedTransition: false,
      error: e.message,
      responseStatus: 409
    });
    return response(409, { error: e.message, from_status: currentStatus, to_status: targetStatus, normalized_current_status: currentStatus, normalized_target_status: targetStatus, transition_allowed: false });
  }

  let result = callRow;
  for (let i = 0; i < sequence.length; i += 1) {
    const status = sequence[i];
    const letzterSchritt = i === sequence.length - 1;
    const patch = {
      dashboard_status: status,
      updated_at: new Date().toISOString()
    };
    if (status === CALL_STATUS.CLOSED) patch.follow_up_at = null;
    // Nur am Ende der Kette -- siehe lifecycleStempel().
    if (letzterSchritt) Object.assign(patch, lifecycleStempel(status, new Date().toISOString()));

    const { data, error } = await sbAdmin
      .from('calls')
      .update(patch)
      .eq('id', callId)
      .eq('customer_id', caller.customerId)
      .select('*')
      .single();

    if (error) {
      logStatusUpdate('db_update_error', {
        normalizedCurrentStatus: currentStatus,
        normalizedTargetStatus: targetStatus,
        allowedTransition: true,
        dbUpdateError: {
          code: error.code || null,
          message: error.message || 'unknown'
        },
        responseStatus: 500
      });
      return response(500, { error: 'Call-Status konnte nicht gespeichert werden.', details: error.message, target_status: status });
    }
    result = data;
  }

  return response(200, { success: true, call: result });
};

// Nur fuer Pruefzwecke exportiert. Netlify laedt ausschliesslich `handler`;
// diese beiden Zeilen aendern am Laufzeitverhalten nichts, machen die
// Uebergangskette und die Stempelregel aber ohne HTTP-Aufruf nachpruefbar.
// Eine Regel, die man nur ueber eine deployte Function testen kann, testet
// niemand.
exports.buildTransitionSequence = buildTransitionSequence;
exports.lifecycleStempel = lifecycleStempel;
