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
  const assistantName = String(body.assistant_name || '').trim();

  if (!voiceId && !assistantName) return response(400, { error: 'voice_id or assistant_name required' });

  // Plan-Check für assistant_name
  if (assistantName) {
    const { data: custPlan } = await sbAdmin
      .from('customers')
      .select('subscription_plan_code')
      .eq('id', caller.customerId)
      .maybeSingle();
    const planCode = custPlan?.subscription_plan_code || 'starter';
    const { data: planConfig } = await sbAdmin
      .from('plan_config')
      .select('allow_custom_name')
      .eq('id', planCode)
      .maybeSingle();
    if (!planConfig?.allow_custom_name) {
      return response(403, { error: 'assistant_name_not_allowed_on_plan' });
    }
  }

  const patch = { updated_at: new Date().toISOString() };
  if (voiceId) patch.voice_id = voiceId;
  if (assistantName) patch.assistant_name = assistantName;

  const { error } = await sbAdmin.from('customers').update(patch).eq('id', caller.customerId);
  if (error) return response(500, { error: 'update_failed' });

  // Agent-ID aus DB laden für ElevenLabs Sync
  try {
    const { data: customerRow } = await sbAdmin
      .from('customers')
      .select('elevenlabs_agent_id')
      .eq('id', caller.customerId)
      .maybeSingle();

    const agentId = customerRow?.elevenlabs_agent_id;
    if (!agentId) {
      console.warn('[customer-update-assistant] Kein ElevenLabs Agent für Kunde:', caller.customerId);
    } else {
      const adminUrl = process.env.ADMIN_URL || 'https://admin.voxera.ch';
      const syncRes = await fetch(`${adminUrl}/.netlify/functions/trigger-elevenlabs-sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: caller.customerId,
          agent_id: agentId,
          triggered_by: 'customer_voice_change'
        })
      });
      if (!syncRes.ok) {
        const syncErr = await syncRes.text();
        console.error('[customer-update-assistant] ElevenLabs sync fehlgeschlagen:', syncRes.status, syncErr);
      } else {
        console.log('[customer-update-assistant] ElevenLabs sync erfolgreich für Agent:', agentId);
      }
    }
  } catch (_e) {
    console.error('[customer-update-assistant] Sync-Aufruf Fehler:', _e.message);
  }

  return response(200, { success: true, voice_id: voiceId });
};
