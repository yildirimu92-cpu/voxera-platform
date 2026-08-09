'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { loadFingerprintContext, fingerprintFor } = require('./_lib/prompt-fingerprint');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  'Access-Control-Allow-Origin': 'https://admin.voxera.ch',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

async function recentSyncLogs(sb) {
  const { data, error } = await sb
    .from('elevenlabs_sync_log')
    .select('id, customer_id, status, triggered_by, prompt_length, created_at')
    .order('created_at', { ascending: false })
    .limit(6);
  if (error) return response(500, { error: 'Sync-Historie konnte nicht geladen werden.' });
  return response(200, { success: true, logs: data || [] });
}

async function syncLogSnapshot(sb, body) {
  const logId = String(body.log_id || '').trim();
  if (!logId) return response(400, { error: 'Log-ID fehlt.' });
  const { data, error } = await sb
    .from('elevenlabs_sync_log')
    .select('prompt_snapshot, created_at')
    .eq('id', logId)
    .maybeSingle();
  if (error) return response(500, { error: 'Snapshot konnte nicht geladen werden.' });
  if (!data) return response(404, { error: 'Eintrag nicht gefunden.' });
  return response(200, { success: true, prompt_snapshot: data.prompt_snapshot || null, created_at: data.created_at });
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    return response(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return response(400, { error: 'Ungültiger Request Body.' }); }

  const action = String(body.action || 'status').trim().toLowerCase();
  if (!['status', 'recent', 'snapshot'].includes(action)) {
    return response(400, { error: 'Unbekannte Aktion.' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const guard = await requireAdminCaller({
    event,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    sbAdmin: sb,
    requiredCapability: 'customer:write'
  });
  if (!guard.ok) return response(guard.statusCode, guard.body);

  if (action === 'recent') return recentSyncLogs(sb);
  if (action === 'snapshot') return syncLogSnapshot(sb, body);

  const customerId = String(body.customer_id || '').trim();
  if (!customerId) return response(400, { error: 'Kunde fehlt.' });

  const [{ data: customer, error: customerError }, { data: logs, error: logError }] = await Promise.all([
    sb.from('customers')
      .select('id, elevenlabs_agent_id, elevenlabs_last_sync_at, elevenlabs_sync_status, elevenlabs_sync_error, prompt_fingerprint, industry_template_id')
      .eq('id', customerId)
      .maybeSingle(),
    sb.from('elevenlabs_sync_log')
      .select('id, customer_id, agent_id, status, triggered_by, prompt_length, error_message, prompt_fingerprint, changed_fields, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(20)
  ]);

  if (customerError) return response(500, { error: 'Sync-Status konnte nicht geladen werden.' });
  if (!customer) return response(404, { error: 'Kunde nicht gefunden.' });
  if (logError) return response(500, { error: 'Sync-Historie konnte nicht geladen werden.' });

  // S4 / Stufe 1: Soll gegen Ist. Der Soll-Wert wird hier berechnet, nicht
  // gelesen -- er kann deshalb nicht seinerseits veralten. Kostet zwei
  // Datenbankabfragen und keinen einzigen ElevenLabs-Aufruf.
  //
  // Ein Fehler beim Berechnen darf den Sync-Status nicht abschiessen: die
  // Karte zeigt dann Status und Historie wie bisher, nur ohne Veraltet-Hinweis.
  // Drei Zustaende, nicht zwei. "Unbekannt" ist der wichtigste davon: direkt
  // nach der Einfuehrung hat JEDER Bestandskunde prompt_fingerprint = null,
  // weil die Spalte erst beim naechsten Sync geschrieben wird. Wuerde null als
  // "aktuell" gelten, waeren ausgerechnet die Kunden unsichtbar, fuer die S4
  // gebaut wurde -- und der Mechanismus haette am ersten Tag nichts zu tun.
  // Der Fan-out behandelt 'unknown' deshalb wie 'outdated'; nur die Anzeige
  // unterscheidet, damit niemand einen Fehler sieht, wo nur eine Messung fehlt.
  let expectedFingerprint = null;
  let promptState = null;
  try {
    const context = await loadFingerprintContext(sb);
    expectedFingerprint = fingerprintFor(context, customer);
    if (!customer.elevenlabs_agent_id) promptState = 'no_agent';
    else if (!customer.prompt_fingerprint) promptState = 'unknown';
    else if (customer.prompt_fingerprint !== expectedFingerprint) promptState = 'outdated';
    else promptState = 'current';
  } catch (error) {
    console.warn('[elevenlabs-sync-status] fingerprint_failed', error?.message || error);
  }
  const promptOutdated = promptState === null ? null : promptState === 'outdated';

  return response(200, {
    success: true,
    customer: {
      id: customer.id,
      agent_id: customer.elevenlabs_agent_id || null,
      sync_status: customer.elevenlabs_sync_status || 'never',
      last_sync_at: customer.elevenlabs_last_sync_at || null,
      sync_error: customer.elevenlabs_sync_error || null,
      prompt_fingerprint: customer.prompt_fingerprint || null,
      expected_prompt_fingerprint: expectedFingerprint,
      prompt_state: promptState,
      prompt_outdated: promptOutdated
    },
    logs: logs || []
  });
};
