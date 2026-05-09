const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error: 'supabase_env_missing' });
  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return response(400, { error: 'invalid_body' }); }
  const voiceId = String(body.voice_id || '').trim();
  if (!voiceId) return response(400, { error: 'voice_id_required' });

  const { error } = await sbAdmin.from('customers').update({ voice_id: voiceId, updated_at: new Date().toISOString() }).eq('id', caller.customerId);
  if (error) return response(500, { error: 'voice_update_failed' });

  try {
    const adminUrl = process.env.ADMIN_URL || 'https://admin.voxera.ch';
    const syncRes = await fetch(`${adminUrl}/.netlify/functions/trigger-elevenlabs-sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: caller.customerId, triggered_by: 'customer_voice_change' })
    });
    if (!syncRes.ok) {
      const syncErr = await syncRes.text();
      console.error('[customer-update-assistant] ElevenLabs sync fehlgeschlagen:', syncRes.status, syncErr);
    }
  } catch (_e) {
    console.error('[customer-update-assistant] Sync-Aufruf Fehler:', _e.message);
  }

  return response(200, { success: true, voice_id: voiceId });
};
