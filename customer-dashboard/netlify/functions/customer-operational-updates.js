'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const allowedTypes = new Set(['closure','special_hours','absence','temporary_contact','appointment_pause','notice']);

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function parseWindow(input) {
  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(input.ends_at);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    throw new Error('operational_window_invalid');
  }
  const duration = endsAt.getTime() - startsAt.getTime();
  if (duration <= 0 || duration > 370 * 24 * 60 * 60 * 1000) {
    throw new Error('operational_window_invalid');
  }
  return { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() };
}

function normalize(input) {
  const type = cleanText(input.type, 40).toLowerCase();
  const title = cleanText(input.title, 100);
  const message = cleanText(input.message, 500);
  const behavior = cleanText(input.behavior, 500) || null;
  if (!allowedTypes.has(type)) throw new Error('operational_type_invalid');
  if (!title || !message) throw new Error('operational_required_fields_missing');
  return { type, title, message, behavior, ...parseWindow(input) };
}

async function loadState(sb, customerId) {
  const { data, error } = await sb
    .from('customer_operational_updates')
    .select('id,type,title,message,behavior,starts_at,ends_at,status,sync_status,sync_error,created_at,updated_at')
    .eq('customer_id', customerId)
    .order('starts_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return { ok: true, updates: data || [], server_time: new Date().toISOString() };
}

async function markSync(sb, customerId, ids, status, errorMessage) {
  if (!ids.length) return;
  await sb.from('customer_operational_updates').update({
    sync_status: status,
    sync_error: errorMessage || null,
    updated_at: new Date().toISOString()
  }).eq('customer_id', customerId).in('id', ids);
}

async function syncPrompt(event, customer, customerId) {
  if (!customer?.elevenlabs_agent_id) return { status: 'success', warning: 'agent_missing_sync_skipped' };
  const adminUrl = String(process.env.ADMIN_URL || 'https://admin.voxera.ch').replace(/\/$/, '');
  const authorization = event.headers?.authorization || event.headers?.Authorization || '';
  try {
    const result = await fetch(adminUrl + '/.netlify/functions/trigger-elevenlabs-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({
        customer_id: customerId,
        agent_id: customer.elevenlabs_agent_id,
        triggered_by: 'customer_operational_update'
      })
    });
    let payload = {};
    try { payload = await result.json(); } catch (_error) {}
    if (!result.ok || payload.success === false) {
      return { status: 'failed', error: String(payload.error || ('sync_http_' + result.status)).slice(0, 500) };
    }
    return { status: 'success' };
  } catch (error) {
    return { status: 'failed', error: String(error?.message || 'sync_failed').slice(0, 500) };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !serviceKey) return reply(500, { ok: false, error: 'supabase_configuration_missing' });

  const sb = createClient(sbUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({
    event, sbUrl, sbAnonKey, sbAdmin: sb, functionName: 'customer-operational-updates'
  });
  if (!caller.ok) return reply(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return reply(400, { ok: false, error: 'invalid_json' }); }
  const action = cleanText(body.action || 'list', 20).toLowerCase();

  try {
    if (action === 'list') return reply(200, await loadState(sb, caller.customerId));

    const { data: customer, error: customerError } = await sb
      .from('customers')
      .select('id,elevenlabs_agent_id')
      .eq('id', caller.customerId)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return reply(404, { ok: false, error: 'customer_not_found' });

    let changedIds = [];
    if (action === 'create') {
      const values = normalize(body.update || {});
      const { data, error } = await sb.from('customer_operational_updates').insert({
        customer_id: caller.customerId,
        ...values,
        status: 'published',
        created_by_user_id: caller.userId,
        sync_status: 'pending'
      }).select('id').single();
      if (error) throw error;
      changedIds = [data.id];
    } else if (action === 'update') {
      const id = cleanText(body.id, 80);
      if (!id) return reply(400, { ok: false, error: 'operational_id_missing' });
      const values = normalize(body.update || {});
      const { data, error } = await sb.from('customer_operational_updates').update({
        ...values,
        status: 'published',
        sync_status: 'pending',
        sync_error: null,
        updated_at: new Date().toISOString()
      }).eq('id', id).eq('customer_id', caller.customerId).select('id');
      if (error) throw error;
      if (!data?.length) return reply(404, { ok: false, error: 'operational_update_not_found' });
      changedIds = [id];
    } else if (action === 'cancel') {
      const id = cleanText(body.id, 80);
      if (!id) return reply(400, { ok: false, error: 'operational_id_missing' });
      const { data, error } = await sb.from('customer_operational_updates').update({
        status: 'cancelled',
        sync_status: 'pending',
        sync_error: null,
        updated_at: new Date().toISOString()
      }).eq('id', id).eq('customer_id', caller.customerId).select('id');
      if (error) throw error;
      if (!data?.length) return reply(404, { ok: false, error: 'operational_update_not_found' });
      changedIds = [id];
    } else {
      return reply(400, { ok: false, error: 'unsupported_action' });
    }

    const sync = await syncPrompt(event, customer, caller.customerId);
    await markSync(sb, caller.customerId, changedIds, sync.status, sync.error);
    const state = await loadState(sb, caller.customerId);
    return reply(sync.status === 'failed' ? 202 : 200, {
      ...state,
      sync_status: sync.status,
      sync_error: sync.error || null,
      warning: sync.warning || null
    });
  } catch (error) {
    const code = String(error?.message || 'operational_update_failed');
    const status = code.startsWith('operational_') ? 400 : 500;
    console.error('[customer-operational-updates] failed', {
      action,
      customer_id: caller.customerId,
      error: code
    });
    return reply(status, { ok: false, error: code });
  }
};
