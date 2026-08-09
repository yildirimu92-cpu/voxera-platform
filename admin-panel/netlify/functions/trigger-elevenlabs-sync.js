'use strict';

// Der Sync-Kern liegt seit S4 / Stufe 2 in _lib/elevenlabs-sync.js. Diese Datei
// behaelt genau das, was ein HTTP-Endpunkt braucht: Methode, Body, Env-Check,
// Guard und die Antwortform. Verhalten und Antwortfelder sind unveraendert --
// die acht bestehenden Ausloeser merken davon nichts.
//
// Der Grund fuer die Trennung: der Fan-out-Worker laeuft geplant und hat kein
// Nutzer-JWT, das requirePromptSyncCaller pruefen koennte. Er ruft deshalb
// dieselbe Funktion in-process mit Service-Role auf, statt sich an diesem
// Endpunkt vorbei zu authentifizieren.

const { createClient } = require('@supabase/supabase-js');
const { requirePromptSyncCaller } = require('./_lib/require-prompt-sync-caller');
const { syncCustomerToElevenLabs } = require('./_lib/elevenlabs-sync');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return response(400, { error: 'invalid_json' }); }

  const {
    customer_id,
    agent_id,
    triggered_by = 'admin_save',
    prev_values = {}
  } = body;

  if (!customer_id || !agent_id) {
    return response(400, { error: 'customer_id_and_agent_id_required' });
  }
  if (!ELEVENLABS_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    return response(500, { error: 'missing_environment_configuration' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const guard = await requirePromptSyncCaller({
    event,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    sbAdmin: sb,
    requestedCustomerId: customer_id
  });
  if (!guard.ok) return response(guard.statusCode, guard.body);

  const result = await syncCustomerToElevenLabs({
    sb,
    apiKey: ELEVENLABS_API_KEY,
    customerId: customer_id,
    agentId: agent_id,
    triggeredBy: triggered_by,
    prevValues: prev_values
  });

  if (result.code === 'customer_not_found') return response(404, { error: 'customer_not_found' });
  if (result.code === 'agent_customer_mapping_mismatch') {
    return response(409, { error: 'agent_customer_mapping_mismatch' });
  }

  if (!result.ok) {
    return response(500, {
      success: false,
      error: result.error,
      calendar_tool_status: result.calendarToolStatus,
      phone_number_status: result.phoneNumberStatus,
      phone_number_id: result.phoneNumberId,
      phone_number: result.phoneNumber
    });
  }

  return response(200, {
    success: true,
    agent_id,
    promptLength: result.promptLength,
    promptVersion: result.promptVersion,
    promptFingerprint: result.promptFingerprint,
    quality: result.quality,
    calendar_tool_status: result.calendarToolStatus,
    calendar_tool_id: result.calendarToolId,
    phone_number_status: result.phoneNumberStatus,
    phone_number_id: result.phoneNumberId,
    phone_number: result.phoneNumber
  });
};
