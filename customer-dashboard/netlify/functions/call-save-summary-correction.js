const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

// Etappe 4 Teil B / Feature 3 — Kundenkorrektur der KI-Zusammenfassung.
//
// EIGENE FUNCTION, KEINE ERWEITERUNG VON call-save-followup.
// Jene Function faehrt einen Statusuebergang mit: sobald follow_up_at gesetzt
// ist, wechselt der Eintrag nach follow_up_scheduled (call-save-followup.js).
// Eine Textkorrektur darf den Lebenszyklus nicht anfassen — deshalb hier ein
// eigener, bewusst schmaler Schreibpfad.
//
// Diese Function schreibt ausschliesslich die drei Korrekturspalten. Sie
// fasst call_summary nicht an (die Spalte gehoert dem Post-Call-Webhook) und
// aendert dashboard_status nicht.

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Grosszuegig, aber nicht unbegrenzt: die KI-Zusammenfassungen liegen bei
// wenigen hundert Zeichen, das Transkript gehoert nicht in dieses Feld.
const MAX_LENGTH = 5000;

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

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
    functionName: 'call-save-summary-correction'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) {
    return response(400, { error: 'Ungültiger Request Body' });
  }

  const callId = String(body.call_id || '').trim();
  if (!callId) return response(400, { error: 'call_id fehlt' });

  if (!Object.prototype.hasOwnProperty.call(body, 'corrected_summary')) {
    return response(400, { error: 'corrected_summary fehlt' });
  }

  // Leerer Text bzw. null = Korrektur zuruecknehmen. Danach gilt wieder die
  // KI-Ausgabe aus call_summary; die drei Spalten werden gemeinsam geleert,
  // damit kein Zeitstempel ohne Text zurueckbleibt.
  const raw = body.corrected_summary;
  if (raw != null && typeof raw !== 'string') {
    return response(400, { error: 'corrected_summary muss Text oder null sein' });
  }
  const corrected = raw == null ? '' : raw.trim();
  if (corrected.length > MAX_LENGTH) {
    return response(400, { error: `Die Zusammenfassung ist zu lang (max. ${MAX_LENGTH} Zeichen).` });
  }
  const isReset = corrected === '';

  // Ownership pruefen, bevor mit Service-Role geschrieben wird.
  const { data: callRow, error: callError } = await sbAdmin
    .from('calls')
    .select('id, customer_id')
    .eq('id', callId)
    .maybeSingle();

  if (callError) return response(500, { error: 'Call lookup fehlgeschlagen', details: callError.message });
  if (!callRow) return response(404, { error: 'Call nicht gefunden' });
  if (String(callRow.customer_id) !== caller.customerId) {
    return response(403, { error: 'Call gehört nicht zu diesem Kunden' });
  }

  const nowIso = new Date().toISOString();
  const patch = {
    call_summary_corrected: isReset ? null : corrected,
    call_summary_corrected_at: isReset ? null : nowIso,
    call_summary_corrected_by: isReset ? null : caller.userId,
    updated_at: nowIso
  };

  const { data, error } = await sbAdmin
    .from('calls')
    .update(patch)
    .eq('id', callId)
    .eq('customer_id', caller.customerId)
    .select('id, call_summary, call_summary_corrected, call_summary_corrected_at, call_summary_corrected_by, updated_at')
    .single();

  if (error) {
    return response(500, { error: 'Korrektur konnte nicht gespeichert werden.', details: error.message });
  }
  return response(200, { success: true, call: data });
};
