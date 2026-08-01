'use strict';

const { createClient } = require('@supabase/supabase-js');
const { hashState, encryptSecret } = require('./_lib/calendar-crypto');
const { exchangeAuthorizationCode, tokenExpiry, accountSnapshot } = require('./_lib/calendar-providers');

function html(statusCode, payload, origin) {
  const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const safeOrigin = JSON.stringify(origin || 'https://dashboard.voxera.ch').replace(/</g, '\\u003c');
  const title = payload.ok ? 'Kalender verbunden' : 'Verbindung fehlgeschlagen';
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
    },
    body: '<!doctype html><html lang="de"><meta charset="utf-8"><title>' + title + '</title>' +
      '<body style="font-family:system-ui;background:#f6f8fb;color:#0d1f3c;display:grid;place-items:center;min-height:100vh;margin:0">' +
      '<main style="background:#fff;border:1px solid #e4e8f0;border-radius:16px;padding:28px;max-width:440px;text-align:center"><h1 style="font-size:20px">' + title + '</h1>' +
      '<p style="color:#64748b">' + (payload.ok ? 'Sie können dieses Fenster schliessen.' : 'Bitte kehren Sie zu Voxera zurück und versuchen Sie es erneut.') + '</p></main>' +
      '<script>(function(){var payload=' + safePayload + ';var origin=' + safeOrigin + ';try{if(window.opener)window.opener.postMessage({type:"voxera-calendar-oauth",payload:payload},origin);}catch(e){}setTimeout(function(){window.close();},900);}());<\/script></body></html>'
  };
}

exports.handler = async (event) => {
  const fallbackOrigin = String(process.env.CALENDAR_DASHBOARD_ORIGIN || 'https://dashboard.voxera.ch');
  if (event.httpMethod !== 'GET') return html(405, { ok: false, error: 'method_not_allowed' }, fallbackOrigin);
  if (process.env.CALENDAR_INTEGRATION_ENABLED !== 'true') return html(503, { ok: false, error: 'calendar_integration_disabled' }, fallbackOrigin);

  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return html(500, { ok: false, error: 'supabase_configuration_missing' }, fallbackOrigin);
  const sb = createClient(sbUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const params = event.queryStringParameters || {};
  const state = String(params.state || '').trim();
  const code = String(params.code || '').trim();
  const providerError = String(params.error_description || params.error || '').trim();
  if (!state) return html(400, { ok: false, error: 'oauth_state_missing' }, fallbackOrigin);

  const { data: stateRow, error: stateError } = await sb.from('calendar_oauth_states').select('*').eq('state_hash', hashState(state)).maybeSingle();
  if (stateError || !stateRow) return html(400, { ok: false, error: 'oauth_state_invalid' }, fallbackOrigin);
  const origin = stateRow.return_origin || fallbackOrigin;
  if (stateRow.used_at || new Date(stateRow.expires_at).getTime() <= Date.now()) {
    return html(400, { ok: false, error: 'oauth_state_expired' }, origin);
  }

  await sb.from('calendar_oauth_states').update({ used_at: new Date().toISOString() }).eq('state_hash', stateRow.state_hash);
  if (providerError || !code) return html(400, { ok: false, error: providerError || 'oauth_code_missing' }, origin);

  try {
    const token = await exchangeAuthorizationCode(stateRow.provider, code);
    const snapshot = await accountSnapshot(stateRow.provider, token.access_token);
    const selected = snapshot.calendars.find((item) => item.primary && item.writable)
      || snapshot.calendars.find((item) => item.writable)
      || snapshot.calendars[0]
      || null;
    const { data: existing } = await sb.from('calendar_connections').select('id,refresh_token_encrypted').eq('customer_id', stateRow.customer_id).eq('provider', stateRow.provider).maybeSingle();
    const refreshEncrypted = token.refresh_token
      ? encryptSecret(token.refresh_token)
      : existing?.refresh_token_encrypted || null;
    if (!refreshEncrypted) throw new Error('calendar_refresh_token_missing');

    const record = {
      customer_id: stateRow.customer_id,
      provider: stateRow.provider,
      provider_account_id: snapshot.accountId,
      account_email: snapshot.email,
      account_label: snapshot.label,
      access_token_encrypted: encryptSecret(token.access_token),
      refresh_token_encrypted: refreshEncrypted,
      token_expires_at: tokenExpiry(token),
      scopes: String(token.scope || '').split(/\s+/).filter(Boolean),
      calendars: snapshot.calendars,
      selected_calendar_id: selected?.id || null,
      selected_calendar_name: selected?.name || null,
      status: 'connected',
      last_error: null,
      connected_by_user_id: stateRow.user_id,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const { data: connection, error: upsertError } = await sb.from('calendar_connections').upsert(record, { onConflict: 'customer_id,provider' }).select('id').maybeSingle();
    if (upsertError) throw upsertError;

    await sb.from('calendar_settings').upsert({
      customer_id: stateRow.customer_id,
      active_provider: stateRow.provider,
      updated_at: new Date().toISOString()
    }, { onConflict: 'customer_id' });

    await sb.from('calendar_booking_audit').insert({
      customer_id: stateRow.customer_id,
      connection_id: connection?.id || existing?.id || null,
      provider: stateRow.provider,
      action: 'connect',
      actor_type: 'customer',
      status: 'success',
      details: { account_email: snapshot.email, calendar_count: snapshot.calendars.length }
    });

    return html(200, { ok: true, provider: stateRow.provider }, origin);
  } catch (error) {
    console.error('[calendar-oauth-callback] failed', {
      provider: stateRow.provider,
      customer_id: stateRow.customer_id,
      error: error?.message || String(error)
    });
    return html(500, { ok: false, provider: stateRow.provider, error: error?.message || 'oauth_callback_failed' }, origin);
  }
};
