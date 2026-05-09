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

  // Lade Kunde + Plan
  const { data: customer } = await sbAdmin
    .from('customers')
    .select('plan, elevenlabs_agent_id')
    .eq('id', caller.customerId)
    .maybeSingle();

  const planCode = String(customer?.plan || 'starter').toLowerCase();

  // Lade plan_config für Berechtigungen
  const { data: planCfg } = await sbAdmin
    .from('plan_config')
    .select('allow_custom_assistant_name, voice_selection_enabled')
    .eq('id', planCode)
    .maybeSingle();

  const canEditName  = planCfg?.allow_custom_assistant_name === true;
  const canEditVoice = planCfg?.voice_selection_enabled === true;
  const canEditForwarding = planCode === 'professional';

  // Felder extrahieren
  const {
    // Ab Business
    voice_id,
    assistant_name,
    // Alle Pakete
    ai_business_description,
    ai_services,
    ai_location_hours,
    ai_tone,
    ai_address_form,
    // Nur Professional
    ai_forwarding_1_name,
    ai_forwarding_1_number,
    ai_forwarding_1_trigger,
    ai_forwarding_2_name,
    ai_forwarding_2_number,
    ai_forwarding_2_trigger,
    ai_emergency_number,
    // Notifications
    notification_mode,
    // SMS
    sms_notify_enabled,
    sms_notify_trigger,
    sms_notify_number,
    sms_caller_enabled,
    sms_caller_trigger,
    sms_caller_template,
  } = body;

  const patch = { updated_at: new Date().toISOString() };
  const errors = [];

  // Alle Pakete — Profil/Erreichbarkeit/Ton
  if (ai_business_description !== undefined) patch.ai_business_description = String(ai_business_description).trim() || null;
  if (ai_services !== undefined)             patch.ai_services             = String(ai_services).trim() || null;
  if (ai_location_hours !== undefined)       patch.ai_location_hours       = String(ai_location_hours).trim() || null;
  if (ai_tone !== undefined)                 patch.ai_tone                 = String(ai_tone).trim() || null;
  if (ai_address_form !== undefined)         patch.ai_address_form         = String(ai_address_form).trim() || null;

  // Ab Business — Stimme + Name
  if (voice_id !== undefined) {
    if (!canEditVoice) errors.push('voice_not_allowed_on_plan');
    else patch.voice_id = String(voice_id).trim() || null;
  }
  if (assistant_name !== undefined) {
    if (!canEditName) errors.push('assistant_name_not_allowed_on_plan');
    else patch.assistant_name = String(assistant_name).trim() || null;
  }

  // notification_mode
  if (notification_mode !== undefined) {
    const validModes = ['none', 'callback_only', 'all_calls'];
    if (validModes.includes(String(notification_mode))) patch.notification_mode = notification_mode;
  }

  // SMS Einstellungen — alle Pakete (Add-on Check in Frontend)
  if (sms_notify_enabled !== undefined) patch.sms_notify_enabled = Boolean(sms_notify_enabled);
  if (sms_notify_trigger !== undefined) patch.sms_notify_trigger = String(sms_notify_trigger).trim() || 'all';
  if (sms_notify_number !== undefined)  patch.sms_notify_number  = String(sms_notify_number).trim() || null;
  if (sms_caller_enabled !== undefined) patch.sms_caller_enabled = Boolean(sms_caller_enabled);
  if (sms_caller_trigger !== undefined) patch.sms_caller_trigger = String(sms_caller_trigger).trim() || 'callback_only';
  if (sms_caller_template !== undefined) patch.sms_caller_template = String(sms_caller_template).trim() || null;

  // Nur Professional — Weiterleitungen (pending Admin-Bestätigung)
  if (ai_forwarding_1_name !== undefined || ai_forwarding_1_number !== undefined || ai_forwarding_1_trigger !== undefined ||
      ai_forwarding_2_name !== undefined || ai_forwarding_2_number !== undefined || ai_forwarding_2_trigger !== undefined ||
      ai_emergency_number !== undefined) {
    if (!canEditForwarding) {
      errors.push('forwarding_not_allowed_on_plan');
    } else {
      if (ai_forwarding_1_name !== undefined)   patch.ai_forwarding_1_name   = String(ai_forwarding_1_name).trim() || null;
      if (ai_forwarding_1_number !== undefined) patch.ai_forwarding_1_number = String(ai_forwarding_1_number).trim() || null;
      if (ai_forwarding_1_trigger !== undefined)patch.ai_forwarding_1_trigger= String(ai_forwarding_1_trigger).trim() || null;
      if (ai_forwarding_2_name !== undefined)   patch.ai_forwarding_2_name   = String(ai_forwarding_2_name).trim() || null;
      if (ai_forwarding_2_number !== undefined) patch.ai_forwarding_2_number = String(ai_forwarding_2_number).trim() || null;
      if (ai_forwarding_2_trigger !== undefined)patch.ai_forwarding_2_trigger= String(ai_forwarding_2_trigger).trim() || null;
      if (ai_emergency_number !== undefined)    patch.ai_emergency_number    = String(ai_emergency_number).trim() || '144';
      // Weiterleitungen: pending Admin-Bestätigung — Sync wird NICHT ausgelöst
      // TODO: Admin-Benachrichtigung implementieren
    }
  }

  // Nichts zu updaten?
  const patchKeys = Object.keys(patch).filter(k => k !== 'updated_at');
  if (!patchKeys.length) {
    return response(400, { error: 'no_valid_fields', errors });
  }

  // DB Update
  const { error: dbErr } = await sbAdmin.from('customers').update(patch).eq('id', caller.customerId);
  if (dbErr) return response(500, { error: 'update_failed', detail: dbErr.message });

  // ElevenLabs Sync — nur wenn Nicht-Weiterleitungs-Felder geändert wurden
  const forwardingFields = ['ai_forwarding_1_name','ai_forwarding_1_number','ai_forwarding_1_trigger','ai_forwarding_2_name','ai_forwarding_2_number','ai_forwarding_2_trigger','ai_emergency_number'];
  const hasNonForwardingChange = patchKeys.some(k => !forwardingFields.includes(k));

  if (hasNonForwardingChange && customer?.elevenlabs_agent_id) {
    try {
      const adminUrl = process.env.ADMIN_URL || 'https://admin.voxera.ch';
      const syncRes = await fetch(`${adminUrl}/.netlify/functions/trigger-elevenlabs-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: caller.customerId,
          agent_id: customer.elevenlabs_agent_id,
          triggered_by: 'customer_self_edit'
        })
      });
      if (!syncRes.ok) console.error('[customer-update-assistant] Sync fehlgeschlagen:', syncRes.status);
      else console.log('[customer-update-assistant] Sync erfolgreich');
    } catch (e) {
      console.error('[customer-update-assistant] Sync-Fehler:', e.message);
    }
  }

  return response(200, { success: true, updated: patchKeys, errors: errors.length ? errors : undefined });
};
