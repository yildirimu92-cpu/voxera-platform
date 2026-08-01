'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const { randomState, hashState } = require('./_lib/calendar-crypto');
const { calendarEnabledForCustomer } = require('./_lib/calendar-rollout');
const { providerConfig, authorizationUrl, ensureAccessToken, accountSnapshot } = require('./_lib/calendar-providers');

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const providers = ['google', 'microsoft'];

function safeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!providers.includes(provider)) throw new Error('calendar_provider_unsupported');
  return provider;
}

function providerReadiness(provider) {
  try {
    providerConfig(provider);
    return true;
  } catch (_error) {
    return false;
  }
}

function dashboardOrigin() {
  const value = String(process.env.CALENDAR_DASHBOARD_ORIGIN || 'https://dashboard.voxera.ch').trim();
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    return url.origin;
  } catch (_error) {
    return '';
  }
}

async function loadStatus(sb, customerId) {
  const [{ data: connections, error: connectionError }, { data: settings, error: settingsError }] = await Promise.all([
    sb.from('calendar_connections').select('id,provider,provider_account_id,account_email,account_label,calendars,selected_calendar_id,selected_calendar_name,status,last_error,last_verified_at,created_at,updated_at').eq('customer_id', customerId).order('provider'),
    sb.from('calendar_settings').select('*').eq('customer_id', customerId).maybeSingle()
  ]);
  if (connectionError) throw connectionError;
  if (settingsError) throw settingsError;
  const normalizedConnections = connections || [];
  const providerConfigured = Object.fromEntries(providers.map((provider) => [provider, providerReadiness(provider)]));
  return {
    enabled: calendarEnabledForCustomer(customerId),
    provider_configured: providerConfigured,
    available_providers: providers.filter((provider) =>
      providerConfigured[provider] || normalizedConnections.some((item) => item.provider === provider)
    ),
    connections: normalizedConnections,
    settings: settings || {
      customer_id: customerId,
      active_provider: null,
      timezone: 'Europe/Zurich',
      appointment_duration_minutes: 30,
      buffer_before_minutes: 0,
      buffer_after_minutes: 10,
      minimum_notice_minutes: 120,
      booking_horizon_days: 60,
      feature_enabled: false
    }
  };
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
    event, sbUrl, sbAnonKey, sbAdmin: sb, functionName: 'calendar-connections'
  });
  if (!caller.ok) return reply(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return reply(400, { ok: false, error: 'invalid_json' }); }
  const action = String(body.action || 'status').trim().toLowerCase();

  try {
    if (action === 'status') return reply(200, { ok: true, ...(await loadStatus(sb, caller.customerId)) });
    if (!calendarEnabledForCustomer(caller.customerId)) return reply(503, { ok: false, error: 'calendar_integration_disabled' });

    if (action === 'oauth_start') {
      const provider = safeProvider(body.provider);
      if (!providerReadiness(provider)) {
        return reply(503, { ok: false, error: 'calendar_provider_not_configured', provider });
      }
      const origin = dashboardOrigin();
      if (!origin) return reply(500, { ok: false, error: 'calendar_dashboard_origin_invalid' });
      const state = randomState();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      await sb.from('calendar_oauth_states').delete().lt('expires_at', now.toISOString());
      const { error } = await sb.from('calendar_oauth_states').insert({
        state_hash: hashState(state),
        customer_id: caller.customerId,
        user_id: caller.userId,
        provider,
        return_origin: origin,
        expires_at: expiresAt
      });
      if (error) throw error;
      return reply(200, { ok: true, provider, authorize_url: authorizationUrl(provider, state), expires_at: expiresAt });
    }

    if (action === 'save_settings') {
      const input = body.settings && typeof body.settings === 'object' ? body.settings : {};
      const allowed = {
        active_provider: input.active_provider ? safeProvider(input.active_provider) : null,
        timezone: String(input.timezone || 'Europe/Zurich').slice(0, 80),
        appointment_duration_minutes: Number(input.appointment_duration_minutes ?? 30),
        buffer_before_minutes: Number(input.buffer_before_minutes ?? 0),
        buffer_after_minutes: Number(input.buffer_after_minutes ?? 0),
        minimum_notice_minutes: Number(input.minimum_notice_minutes ?? 120),
        booking_horizon_days: Number(input.booking_horizon_days ?? 60),
        feature_enabled: input.feature_enabled === true,
        updated_at: new Date().toISOString()
      };
      const ranges = {
        appointment_duration_minutes: [10, 240],
        buffer_before_minutes: [0, 180],
        buffer_after_minutes: [0, 180],
        minimum_notice_minutes: [0, 10080],
        booking_horizon_days: [1, 365]
      };
      const invalidNumber = Object.entries(ranges).find(([field, [min, max]]) =>
        !Number.isInteger(allowed[field]) || allowed[field] < min || allowed[field] > max
      );
      if (invalidNumber) return reply(400, { ok: false, error: 'calendar_setting_invalid', field: invalidNumber[0] });
      try { new Intl.DateTimeFormat('de-CH', { timeZone: allowed.timezone }).format(new Date()); }
      catch (_error) { return reply(400, { ok: false, error: 'calendar_timezone_invalid' }); }
      if (allowed.feature_enabled && !allowed.active_provider) {
        return reply(400, { ok: false, error: 'calendar_active_provider_required' });
      }
      if (allowed.active_provider) {
        if (!providerReadiness(allowed.active_provider)) {
          return reply(409, { ok: false, error: 'calendar_provider_not_configured', provider: allowed.active_provider });
        }
        const { data: activeConnection, error: activeError } = await sb.from('calendar_connections')
          .select('status,selected_calendar_id')
          .eq('customer_id', caller.customerId)
          .eq('provider', allowed.active_provider)
          .maybeSingle();
        if (activeError) throw activeError;
        if (!activeConnection || activeConnection.status !== 'connected' || !activeConnection.selected_calendar_id) {
          return reply(409, { ok: false, error: 'calendar_active_provider_not_ready' });
        }
      }
      const { error } = await sb.from('calendar_settings').upsert({ customer_id: caller.customerId, ...allowed }, { onConflict: 'customer_id' });
      if (error) throw error;
      return reply(200, { ok: true, ...(await loadStatus(sb, caller.customerId)) });
    }

    if (action === 'select_calendar') {
      const provider = safeProvider(body.provider);
      if (!providerReadiness(provider)) {
        return reply(503, { ok: false, error: 'calendar_provider_not_configured', provider });
      }
      const calendarId = String(body.calendar_id || '').trim();
      const { data: connection, error: lookupError } = await sb.from('calendar_connections').select('id,calendars').eq('customer_id', caller.customerId).eq('provider', provider).maybeSingle();
      if (lookupError) throw lookupError;
      if (!connection) return reply(404, { ok: false, error: 'calendar_connection_not_found' });
      const calendar = (connection.calendars || []).find((item) => String(item.id) === calendarId && item.writable !== false);
      if (!calendar) return reply(400, { ok: false, error: 'calendar_not_available' });
      const { error } = await sb.from('calendar_connections').update({
        selected_calendar_id: calendar.id,
        selected_calendar_name: calendar.name,
        updated_at: new Date().toISOString()
      }).eq('id', connection.id);
      if (error) throw error;
      return reply(200, { ok: true, ...(await loadStatus(sb, caller.customerId)) });
    }

    if (action === 'test') {
      const provider = safeProvider(body.provider);
      if (!providerReadiness(provider)) {
        return reply(503, { ok: false, error: 'calendar_provider_not_configured', provider });
      }
      const { data: connection, error: lookupError } = await sb.from('calendar_connections').select('*').eq('customer_id', caller.customerId).eq('provider', provider).maybeSingle();
      if (lookupError) throw lookupError;
      if (!connection) return reply(404, { ok: false, error: 'calendar_connection_not_found' });
      const token = await ensureAccessToken(sb, connection);
      const snapshot = await accountSnapshot(provider, token.accessToken);
      const selected = snapshot.calendars.find((item) => item.id === connection.selected_calendar_id)
        || snapshot.calendars.find((item) => item.primary && item.writable)
        || snapshot.calendars.find((item) => item.writable);
      const { error } = await sb.from('calendar_connections').update({
        provider_account_id: snapshot.accountId,
        account_email: snapshot.email,
        account_label: snapshot.label,
        calendars: snapshot.calendars,
        selected_calendar_id: selected?.id || null,
        selected_calendar_name: selected?.name || null,
        status: 'connected',
        last_error: null,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', connection.id);
      if (error) throw error;
      await sb.from('calendar_booking_audit').insert({
        customer_id: caller.customerId,
        connection_id: connection.id,
        provider,
        action: 'verify',
        actor_type: 'customer',
        status: 'success',
        details: { calendar_count: snapshot.calendars.length }
      });
      return reply(200, { ok: true, ...(await loadStatus(sb, caller.customerId)) });
    }

    if (action === 'disconnect') {
      const provider = safeProvider(body.provider);
      const { data: connection } = await sb.from('calendar_connections').select('id').eq('customer_id', caller.customerId).eq('provider', provider).maybeSingle();
      if (connection?.id) {
        await sb.from('calendar_booking_audit').insert({
          customer_id: caller.customerId,
          connection_id: connection.id,
          provider,
          action: 'disconnect',
          actor_type: 'customer',
          status: 'success'
        });
      }
      const { error } = await sb.from('calendar_connections').delete().eq('customer_id', caller.customerId).eq('provider', provider);
      if (error) throw error;
      const { data: settings } = await sb.from('calendar_settings').select('active_provider').eq('customer_id', caller.customerId).maybeSingle();
      if (settings?.active_provider === provider) {
        await sb.from('calendar_settings').update({ active_provider: null, feature_enabled: false, updated_at: new Date().toISOString() }).eq('customer_id', caller.customerId);
      }
      return reply(200, { ok: true, ...(await loadStatus(sb, caller.customerId)) });
    }

    return reply(400, { ok: false, error: 'unsupported_action' });
  } catch (error) {
    console.error('[calendar-connections] failed', { action, customer_id: caller.customerId, error: error?.message || String(error) });
    return reply(error.status >= 400 && error.status < 600 ? error.status : 500, {
      ok: false,
      error: error?.message || 'calendar_action_failed'
    });
  }
};
