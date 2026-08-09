'use strict';

// Liest und schreibt die Benachrichtigungseinstellungen des aufrufenden
// Admins. Bewusst nur die eigenen: wer fuer andere mitentscheidet, gehoert in
// die Rollenverteilung, und die ist laut Fahrplan zurueckgestellt, solange das
// Team aus einer Person besteht.

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const {
  ADMIN_NOTIFICATION_EVENTS,
  isAdminNotificationEvent,
  ensureAdminNotificationDefaults
} = require('./_lib/admin-notification-events');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

// Was die Oberflaeche pro Zeile braucht: den Zustand und die Information, ob
// der Schalter ueberhaupt etwas bewirken kann. `available: false` heisst: das
// Event hat eine Ausloesestelle im Code, aber noch keinen mail_type und keine
// Route in Make-Szenario 09. Die Zeile erscheint dann als "noch nicht aktiv"
// statt als Schalter -- die Diagnose vom 09.08. hat genug Schalter gefunden,
// die nichts tun.
function describeEvents(rows) {
  const byKey = new Map((rows || []).map(row => [row.event_key, row]));
  return ADMIN_NOTIFICATION_EVENTS.map(event => {
    const stored = byKey.get(event.key);
    return {
      key: event.key,
      title: event.title,
      description: event.description,
      email_enabled: stored ? stored.email_enabled === true : event.defaultEmail,
      available: Boolean(event.mailType),
      unavailable_reason: event.mailType
        ? null
        : 'Für dieses Ereignis gibt es noch keinen Versandweg in der Mail-Engine.'
    };
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return respond(405, { error: 'Method not allowed' });
  }

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return respond(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return respond(caller.statusCode, caller.body);

  // admins.id ist die Auth-User-ID (require-admin.js sucht die Zeile ueber
  // eq('id', userId)), deshalb sind beide Wege gleichwertig - admin.id zuerst,
  // damit die Herkunft im Code sichtbar bleibt.
  const adminId = caller.admin?.id || caller.userId;
  if (!adminId) return respond(403, { error: 'Admin-Konto konnte nicht aufgeloest werden.' });

  if (event.httpMethod === 'GET') {
    await ensureAdminNotificationDefaults(sbAdmin, adminId);
    const { data, error } = await sbAdmin
      .from('admin_notification_settings')
      .select('event_key, email_enabled')
      .eq('admin_id', adminId);
    if (error) {
      console.error('[admin-notification-settings] load failed', { adminId, error: error.message });
      return respond(500, { error: 'Einstellungen konnten nicht geladen werden.' });
    }
    return respond(200, { success: true, events: describeEvents(data) });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return respond(400, { error: 'Ungueltiger Request Body' }); }
  const updates = body && body.events;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return respond(400, { error: 'events fehlt oder ist kein Objekt' });
  }

  const invalid = Object.keys(updates).filter(key => !isAdminNotificationEvent(key));
  if (invalid.length) {
    return respond(400, { error: 'Unbekannte Ereignisse', invalid_events: invalid });
  }

  const rows = Object.entries(updates).map(([key, value]) => ({
    admin_id: adminId,
    event_key: key,
    email_enabled: value === true,
    updated_at: new Date().toISOString()
  }));
  if (!rows.length) return respond(400, { error: 'Keine Ereignisse uebergeben' });

  const { error: writeError } = await sbAdmin
    .from('admin_notification_settings')
    .upsert(rows, { onConflict: 'admin_id,event_key' });
  if (writeError) {
    console.error('[admin-notification-settings] save failed', { adminId, error: writeError.message });
    return respond(500, { error: 'Einstellungen konnten nicht gespeichert werden.' });
  }

  const { data, error } = await sbAdmin
    .from('admin_notification_settings')
    .select('event_key, email_enabled')
    .eq('admin_id', adminId);
  if (error) return respond(200, { success: true, events: describeEvents(rows) });
  return respond(200, { success: true, events: describeEvents(data) });
};
