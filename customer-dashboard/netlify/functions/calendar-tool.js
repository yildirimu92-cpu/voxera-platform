'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { safeEqual } = require('./_lib/calendar-crypto');
const { ensureAccessToken, checkAvailability, createEvent, updateEvent, deleteEvent } = require('./_lib/calendar-providers');

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

function header(event, name) {
  const headersIn = event.headers || {};
  const key = Object.keys(headersIn).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? String(headersIn[key] || '').trim() : '';
}

function verifyHmac(event, secret) {
  const timestamp = header(event, 'X-Voxera-Timestamp');
  const provided = header(event, 'X-Voxera-Signature').replace(/^sha256=/i, '');
  if (!timestamp || !provided) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.' + String(event.body || ''), 'utf8').digest('hex');
  return safeEqual(provided, expected);
}

function verifyToolAuth(event) {
  const secret = String(process.env.CALENDAR_TOOL_WEBHOOK_SECRET || '').trim();
  if (!secret) return false;

  const authorization = header(event, 'Authorization');
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  if (bearer && safeEqual(bearer[1].trim(), secret)) return true;

  // Optional compatibility path for trusted internal callers that can sign the raw body.
  return verifyHmac(event, secret);
}

function iso(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(field + '_invalid');
  return date.toISOString();
}

function validateWindow(startIso, endIso, settings) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (end <= start) throw new Error('calendar_time_window_invalid');
  if (end - start > 8 * 60 * 60 * 1000) throw new Error('calendar_time_window_too_large');
  const notice = Number(settings.minimum_notice_minutes || 0) * 60000;
  if (start < Date.now() + notice) throw new Error('calendar_minimum_notice_not_met');
  const horizon = Number(settings.booking_horizon_days || 60) * 86400000;
  if (start > Date.now() + horizon) throw new Error('calendar_booking_horizon_exceeded');
}

function eventInput(body, settings) {
  const start = iso(body.start, 'start');
  const end = iso(body.end, 'end');
  validateWindow(start, end, settings);
  return {
    title: String(body.title || settings.appointment_title_template || 'Termin via Voxera').slice(0, 160),
    description: String(body.description || '').slice(0, 4000),
    start,
    end,
    timezone: String(settings.timezone || 'Europe/Zurich'),
    attendees: Array.isArray(body.attendees) ? body.attendees.map((value) => String(value || '').trim()).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)).slice(0, 10) : []
  };
}

async function audit(sb, input) {
  const { error } = await sb.from('calendar_booking_audit').insert(input);
  if (error) console.warn('[calendar-tool] audit failed', { error: error.message, action: input.action });
}

async function resolveCustomer(sb, body) {
  const agentId = String(body.agent_id || '').trim();
  if (agentId) {
    const { data, error } = await sb.from('customers').select('id,elevenlabs_agent_id').eq('elevenlabs_agent_id', agentId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('calendar_agent_not_mapped');
    return String(data.id);
  }
  if (process.env.CALENDAR_TOOL_ALLOW_CUSTOMER_ID === 'true') {
    const customerId = String(body.customer_id || '').trim();
    if (customerId) return customerId;
  }
  throw new Error('calendar_agent_id_required');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });
  if (process.env.CALENDAR_INTEGRATION_ENABLED !== 'true') return reply(503, { ok: false, error: 'calendar_integration_disabled' });
  if (!verifyToolAuth(event)) return reply(403, { ok: false, error: 'calendar_tool_auth_invalid' });

  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return reply(500, { ok: false, error: 'supabase_configuration_missing' });
  const sb = createClient(sbUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return reply(400, { ok: false, error: 'invalid_json' }); }

  const action = String(body.action || '').trim().toLowerCase();
  const allowedActions = ['availability', 'book', 'reschedule', 'cancel'];
  if (!allowedActions.includes(action)) return reply(400, { ok: false, error: 'calendar_action_unsupported' });
  const requestId = String(body.request_id || '').trim() || null;
  let claimedAuditId = null;

  try {
    if (requestId) {
      const { data: previous } = await sb.from('calendar_booking_audit').select('status,details').eq('request_id', requestId).maybeSingle();
      if (previous?.status === 'success' && previous.details?.response) return reply(200, previous.details.response);
      if (previous?.status === 'processing') return reply(409, { ok: false, error: 'calendar_request_in_progress' });
      if (previous?.status === 'failed') return reply(409, { ok: false, error: 'calendar_request_id_already_failed' });
    }

    const customerId = await resolveCustomer(sb, body);
    const { data: settings, error: settingsError } = await sb.from('calendar_settings').select('*').eq('customer_id', customerId).maybeSingle();
    if (settingsError) throw settingsError;
    if (!settings?.feature_enabled || !settings.active_provider) return reply(409, { ok: false, error: 'calendar_not_enabled_for_customer' });

    const { data: connection, error: connectionError } = await sb.from('calendar_connections').select('*').eq('customer_id', customerId).eq('provider', settings.active_provider).eq('status', 'connected').maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.selected_calendar_id) return reply(409, { ok: false, error: 'calendar_connection_not_ready' });

    let externalEventId = String(body.external_event_id || '').trim() || null;
    if (['reschedule', 'cancel'].includes(action)) {
      if (!externalEventId) throw new Error('external_event_id_required');
      const { data: managedEvents, error: managedError } = await sb.from('calendar_booking_audit')
        .select('id')
        .eq('customer_id', customerId)
        .eq('provider', connection.provider)
        .eq('external_event_id', externalEventId)
        .in('action', ['book', 'reschedule'])
        .eq('status', 'success')
        .limit(1);
      if (managedError) throw managedError;
      if (!managedEvents?.length) return reply(403, { ok: false, error: 'calendar_event_not_managed_by_voxera' });
    }

    if (requestId) {
      const { data: claim, error: claimError } = await sb.from('calendar_booking_audit').insert({
        request_id: requestId,
        customer_id: customerId,
        connection_id: connection.id,
        provider: connection.provider,
        action,
        actor_type: 'assistant',
        external_event_id: externalEventId,
        status: 'processing',
        details: { claimed_at: new Date().toISOString() }
      }).select('id').maybeSingle();
      if (claimError?.code === '23505') {
        const { data: existing } = await sb.from('calendar_booking_audit').select('status,details').eq('request_id', requestId).maybeSingle();
        if (existing?.status === 'success' && existing.details?.response) return reply(200, existing.details.response);
        return reply(409, { ok: false, error: existing?.status === 'processing' ? 'calendar_request_in_progress' : 'calendar_request_id_already_used' });
      }
      if (claimError) throw claimError;
      claimedAuditId = claim?.id || null;
    }

    const token = await ensureAccessToken(sb, connection);
    const startIso = body.start ? iso(body.start, 'start') : null;
    const endIso = body.end ? iso(body.end, 'end') : null;
    let responsePayload;

    if (action === 'availability') {
      validateWindow(startIso, endIso, settings);
      const bufferedStart = new Date(new Date(startIso).getTime() - Number(settings.buffer_before_minutes || 0) * 60000).toISOString();
      const bufferedEnd = new Date(new Date(endIso).getTime() + Number(settings.buffer_after_minutes || 0) * 60000).toISOString();
      const result = await checkAvailability(connection.provider, token.accessToken, connection.selected_calendar_id, bufferedStart, bufferedEnd);
      responsePayload = { ok: true, action, available: result.available, requested_start: startIso, requested_end: endIso, busy: result.busy };
    } else if (action === 'book') {
      const input = eventInput(body, settings);
      const availability = await checkAvailability(connection.provider, token.accessToken, connection.selected_calendar_id, input.start, input.end);
      if (!availability.available) {
        const conflict = new Error('calendar_slot_unavailable');
        conflict.status = 409;
        conflict.details = { busy: availability.busy };
        throw conflict;
      }
      const eventRecord = await createEvent(connection.provider, token.accessToken, connection.selected_calendar_id, input);
      externalEventId = String(eventRecord.id || '').trim();
      responsePayload = {
        ok: true, action, external_event_id: externalEventId,
        event_url: eventRecord.htmlLink || eventRecord.webLink || null,
        start: input.start, end: input.end, timezone: input.timezone
      };
    } else if (action === 'reschedule') {
      const input = eventInput(body, settings);
      const availability = await checkAvailability(connection.provider, token.accessToken, connection.selected_calendar_id, input.start, input.end, externalEventId);
      if (!availability.available) {
        const conflict = new Error('calendar_slot_unavailable');
        conflict.status = 409;
        conflict.details = { busy: availability.busy };
        throw conflict;
      }
      const eventRecord = await updateEvent(connection.provider, token.accessToken, connection.selected_calendar_id, externalEventId, input);
      responsePayload = {
        ok: true, action, external_event_id: externalEventId,
        event_url: eventRecord.htmlLink || eventRecord.webLink || null,
        start: input.start, end: input.end, timezone: input.timezone
      };
    } else {
      await deleteEvent(connection.provider, token.accessToken, connection.selected_calendar_id, externalEventId);
      responsePayload = { ok: true, action, external_event_id: externalEventId, cancelled: true };
    }

    if (claimedAuditId) {
      const { error } = await sb.from('calendar_booking_audit').update({
        external_event_id: externalEventId,
        status: 'success',
        details: { response: responsePayload, completed_at: new Date().toISOString() }
      }).eq('id', claimedAuditId);
      if (error) throw error;
    } else {
      await audit(sb, {
        request_id: null,
        customer_id: customerId,
        connection_id: connection.id,
        provider: connection.provider,
        action,
        actor_type: 'assistant',
        external_event_id: externalEventId,
        status: 'success',
        details: { response: responsePayload }
      });
    }
    return reply(200, responsePayload);
  } catch (error) {
    if (claimedAuditId) {
      await sb.from('calendar_booking_audit').update({
        status: 'failed',
        details: {
          error: error?.message || 'calendar_tool_failed',
          ...(error?.details || {}),
          failed_at: new Date().toISOString()
        }
      }).eq('id', claimedAuditId);
    }
    console.error('[calendar-tool] failed', { action, request_id: requestId, error: error?.message || String(error) });
    return reply(error.status >= 400 && error.status < 600 ? error.status : 400, {
      ok: false,
      error: error?.message || 'calendar_tool_failed',
      ...(error?.details || {})
    });
  }
};

exports._test = { verifyToolAuth, verifyHmac, validateWindow };
