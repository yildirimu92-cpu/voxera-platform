'use strict';

// S4 / Stufe 2 — der Knopf: "Veraltete Kunden synchronisieren (n)".
//
// Bewusst NICHT "alle Kunden neu synchronisieren". Ein Knopf, der stur alle
// anfasst, hat denselben Sprengradius wie ein automatischer Fan-out, nur ohne
// dessen Sicherheitsmechanik. Dieser hier arbeitet ausschliesslich die Liste
// aus Stufe 1 ab -- Kunden, deren Prompt-Stand nachweislich abweicht.
//
// Der Endpunkt fasst selbst keinen Agenten an. Er plant nur ein; die Arbeit
// macht fanout-sync-worker.js. Damit kann ein Fan-out nicht am 26-Sekunden-
// Limit von Netlify scheitern und ein Browserfenster, das zugeht, bricht ihn
// nicht ab.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { findStaleCustomers, enqueueFanout, runSummary } = require('./_lib/elevenlabs-fanout');
const { restoreAgentPrompt } = require('./_lib/elevenlabs-sync');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Der Zustand VOR dem Lauf ist der letzte erfolgreiche Sync, der aelter ist als
// die erste Zeile dieses Laufs. Alles danach stammt vom Lauf selbst -- den
// zurueckzuschreiben waere kein Rollback, sondern eine Wiederholung.
async function preRunSnapshot(sb, customerId, runStartedAt) {
  const { data, error } = await sb.from('elevenlabs_sync_log')
    .select('prompt_snapshot, created_at')
    .eq('customer_id', customerId)
    .eq('status', 'success')
    .lt('created_at', runStartedAt)
    .not('prompt_snapshot', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.prompt_snapshot || null;
}

async function rollbackRun(sb, runId, limit) {
  const { data: rows, error } = await sb.from('elevenlabs_sync_queue')
    .select('id, customer_id, agent_id, status, created_at')
    .eq('run_id', runId)
    .eq('status', 'done')
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!rows?.length) return { rolled_back: 0, remaining: 0, failures: [], message: 'Nichts zurückzurollen.' };

  const runStartedAt = rows[0].created_at;
  const batch = rows.slice(0, Math.max(1, Math.min(limit, 10)));
  let rolledBack = 0;
  const failures = [];

  for (const row of batch) {
    const agentId = String(row.agent_id || '').trim();
    if (!agentId) {
      failures.push({ customer_id: row.customer_id, error: 'Kein Agent hinterlegt.' });
      continue;
    }
    // Kein Snapshot heisst: der Kunde hatte vor diesem Lauf keinen belegten
    // Prompt-Stand. Dann gibt es nichts, worauf zurueckgerollt werden koennte,
    // und ein geratener Prompt waere schlimmer als der aktuelle.
    const snapshot = await preRunSnapshot(sb, row.customer_id, runStartedAt);
    if (!snapshot) {
      failures.push({ customer_id: row.customer_id, error: 'Kein früherer Prompt-Snapshot vorhanden.' });
      continue;
    }

    const result = await restoreAgentPrompt({
      sb,
      apiKey: ELEVENLABS_API_KEY,
      customerId: row.customer_id,
      agentId,
      prompt: snapshot
    });
    if (!result.ok) {
      failures.push({ customer_id: row.customer_id, error: result.error });
      continue;
    }
    rolledBack += 1;
    await sb.from('elevenlabs_sync_queue')
      .update({ status: 'cancelled', error_message: 'Zurückgerollt.', updated_at: new Date().toISOString() })
      .eq('id', row.id);
  }

  return {
    rolled_back: rolledBack,
    remaining: Math.max(0, rows.length - batch.length),
    failures,
    message: `${rolledBack} Agent(en) zurückgerollt.${rows.length > batch.length ? ` ${rows.length - batch.length} offen — Aufruf wiederholen.` : ''}`
  };
}

const headers = {
  'Access-Control-Allow-Origin': 'https://admin.voxera.ch',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    return response(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return response(400, { error: 'Ungültiger Request Body.' }); }

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

  const action = String(body.action || 'preview').trim();

  try {
    // Vorschau: kostet nichts und aendert nichts. Der Knopf zeigt damit seine
    // Zahl an, bevor irgendjemand ihn drueckt.
    if (action === 'preview') {
      const stale = await findStaleCustomers(sb);
      return response(200, { success: true, count: stale.length, customers: stale });
    }

    if (action === 'enqueue') {
      const stale = await findStaleCustomers(sb);
      if (!stale.length) {
        return response(200, { success: true, enqueued: 0, skipped: 0, message: 'Alle Agenten sind auf dem aktuellen Stand.' });
      }
      // Der Aufrufer darf die Auswahl einschraenken, aber nicht erweitern:
      // was nicht veraltet ist, wird auch auf Zuruf nicht angefasst.
      const requested = Array.isArray(body.customer_ids) && body.customer_ids.length
        ? new Set(body.customer_ids.map((id) => String(id)))
        : null;
      const selected = requested ? stale.filter((row) => requested.has(row.customer_id)) : stale;
      if (!selected.length) {
        return response(200, { success: true, enqueued: 0, skipped: 0, message: 'Keiner der gewählten Kunden ist veraltet.' });
      }

      const runId = crypto.randomUUID();
      const result = await enqueueFanout(sb, { runId, customers: selected });
      return response(200, {
        success: true,
        ...result,
        customers: selected,
        message: result.waves > 1
          ? `${result.enqueued} Kunden eingeplant. Der erste läuft als Canary; die übrigen folgen erst, wenn er erfolgreich war.`
          : `${result.enqueued} Kunde eingeplant.`
      });
    }

    if (action === 'status') {
      const runId = String(body.run_id || '').trim();
      if (!runId) return response(400, { error: 'run_id fehlt.' });
      return response(200, { success: true, ...(await runSummary(sb, runId)) });
    }

    // Abbruch von Hand: nimmt alles aus der Warteschlange, was noch nicht
    // laeuft. Bereits laufende Zeilen werden nicht abgeschossen -- ein
    // halb uebertragener PATCH waere schlimmer als ein fertiger.
    if (action === 'cancel') {
      const runId = String(body.run_id || '').trim();
      if (!runId) return response(400, { error: 'run_id fehlt.' });
      const { data, error } = await sb.from('elevenlabs_sync_queue')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('run_id', runId)
        .eq('status', 'pending')
        .select('id');
      if (error) throw error;
      return response(200, { success: true, cancelled: (data || []).length });
    }

    // S4 / Stufe 3 — Rollback eines Laufs aus prompt_snapshot.
    //
    // Stellt pro Kunde den Prompt wieder her, der VOR diesem Lauf zuletzt
    // erfolgreich live war. Arbeitet in Haeppchen: ein PATCH pro Kunde, und
    // Netlify schneidet bei ~26s ab. Die Antwort sagt, wie viele noch offen
    // sind -- der Aufruf wird dann einfach wiederholt.
    if (action === 'rollback') {
      if (!ELEVENLABS_API_KEY) return response(500, { error: 'ELEVENLABS_API_KEY fehlt.' });
      const runId = String(body.run_id || '').trim();
      if (!runId) return response(400, { error: 'run_id fehlt.' });
      return response(200, { success: true, ...(await rollbackRun(sb, runId, Number(body.limit) || 5)) });
    }

    return response(400, { error: `Unbekannte Aktion: ${action}` });
  } catch (error) {
    console.warn('[elevenlabs-sync-fanout]', error?.message || error);
    return response(500, { error: 'Fan-out konnte nicht ausgeführt werden.' });
  }
};
