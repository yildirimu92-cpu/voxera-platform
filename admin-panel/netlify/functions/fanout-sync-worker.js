'use strict';

// S4 / Stufe 2+3 — der Worker, der die Fan-out-Warteschlange abarbeitet.
//
// Muster uebernommen von outbox-retry-worker.js: Claiming per bedingtem
// Status-Update (zwei gleichzeitige Laeufe koennen sich dieselbe Zeile nicht
// teilen), Backoff ueber attempts, Batch-Groesse per Env.
//
// Drei Sicherheitsmechaniken, die ein reiner "sync alle"-Job nicht haette:
//
//   Canary   Welle 1 enthaelt genau einen Kunden. Welle 2 wird erst freigegeben,
//            wenn Welle 1 vollstaendig erfolgreich war. Ein Deploy, der den
//            Prompt kaputt macht, erreicht damit einen Agenten statt aller.
//
//   Abbruch  Ueberschreitet die Fehlerquote eines Laufs die Schwelle, werden
//            alle noch wartenden Zeilen desselben Laufs auf 'cancelled'
//            gesetzt. Der Lauf hoert von selbst auf, statt sich durch alle
//            Kunden zu arbeiten.
//
//   Budget   Pro Invocation wird nur eine begrenzte Zahl Kunden bearbeitet,
//            und der Worker hoert auf, bevor Netlify ihn abschneidet. Was
//            liegen bleibt, laeuft beim naechsten Tick weiter.

const { createClient } = require('@supabase/supabase-js');
const { syncCustomerToElevenLabs } = require('./_lib/elevenlabs-sync');
// Canary und Abbruchkriterium liegen in der Fan-out-Lib: sie sind Politik,
// nicht Transport, und dort ohne Supabase-Client pruefbar.
const { waveIsClear, abortIfFailing } = require('./_lib/elevenlabs-fanout');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = { 'Content-Type': 'application/json' };
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

function log(level, event, payload = {}) {
  console.log(JSON.stringify({ level, event, worker: 'fanout-sync', ...payload }));
}

function intEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function floatEnv(name, fallback) {
  const raw = Number.parseFloat(process.env[name] || '');
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : fallback;
}

// Netlify schneidet synchrone Funktionen bei ~26s ab. Der Worker hoert vorher
// von selbst auf: eine abgeschnittene Invocation wuerde Zeilen im Status
// 'running' zuruecklassen, die niemand mehr anfasst.
const WALL_CLOCK_BUDGET_MS = 20_000;
const PER_CUSTOMER_RESERVE_MS = 6_000;

async function claim(sb, row) {
  const { data, error } = await sb.from('elevenlabs_sync_queue')
    .update({
      status: 'running',
      attempts: row.attempts + 1,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', row.id)
    .eq('status', row.status)
    .select('id, run_id, customer_id, agent_id, wave, attempts, reason')
    .maybeSingle();
  if (error) {
    log('warn', 'claim_failed', { queue_id: row.id, error: error.message });
    return null;
  }
  return data || null;
}

async function finish(sb, id, patch) {
  const { error } = await sb.from('elevenlabs_sync_queue')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) log('warn', 'finish_failed', { queue_id: id, error: error.message });
}

exports.handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return response(500, { error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }
  if (!ELEVENLABS_API_KEY) {
    // Ohne Schluessel wuerde jeder Sync fehlschlagen und die Zeilen ins
    // Abbruchkriterium laufen lassen. Lieber gar nicht anfangen.
    return response(500, { error: 'ELEVENLABS_API_KEY fehlt.' });
  }

  const batchSize = intEnv('FANOUT_BATCH_SIZE', 3);
  const maxAttempts = intEnv('FANOUT_MAX_ATTEMPTS', 3);
  const abortThreshold = floatEnv('FANOUT_ABORT_THRESHOLD', 0.5);
  const abortMinSample = intEnv('FANOUT_ABORT_MIN_SAMPLE', 2);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const startedAt = Date.now();
  const { data: candidates, error: candidateError } = await sb.from('elevenlabs_sync_queue')
    .select('id, run_id, customer_id, agent_id, status, wave, attempts, reason')
    .in('status', ['pending', 'failed'])
    .lt('attempts', maxAttempts)
    .order('wave', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(batchSize * 4);

  if (candidateError) {
    log('error', 'candidates_read_failed', { error: candidateError.message });
    return response(500, { error: 'Warteschlange konnte nicht gelesen werden.' });
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let held = 0;
  const abortedRuns = new Set();

  for (const candidate of candidates || []) {
    if (processed >= batchSize) break;
    if (Date.now() - startedAt > WALL_CLOCK_BUDGET_MS - PER_CUSTOMER_RESERVE_MS) {
      log('info', 'budget_reached', { processed, remaining: (candidates || []).length - processed });
      break;
    }
    if (abortedRuns.has(candidate.run_id)) continue;

    if (!(await waveIsClear(sb, candidate.run_id, candidate.wave))) {
      held += 1;
      continue;
    }

    const claimed = await claim(sb, candidate);
    if (!claimed) continue;
    processed += 1;

    const agentId = String(claimed.agent_id || '').trim();
    if (!agentId) {
      // Der Agent kann zwischen Einplanung und Ausfuehrung verschwunden sein.
      // Das ist kein Fehlschlag des Syncs, sondern eine ueberholte Zeile.
      await finish(sb, claimed.id, { status: 'dead', error_message: 'Kein ElevenLabs-Agent hinterlegt.' });
      failed += 1;
      continue;
    }

    let result;
    try {
      result = await syncCustomerToElevenLabs({
        sb,
        apiKey: ELEVENLABS_API_KEY,
        customerId: claimed.customer_id,
        agentId,
        triggeredBy: 'fanout'
      });
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }

    if (result.ok) {
      succeeded += 1;
      await finish(sb, claimed.id, { status: 'done', error_message: null });
      log('info', 'sync_done', {
        run_id: claimed.run_id,
        customer_id: claimed.customer_id,
        wave: claimed.wave,
        reason: claimed.reason,
        fingerprint: result.promptFingerprint
      });
    } else {
      failed += 1;
      const message = String(result.code || result.error || 'sync_failed').slice(0, 500);
      const exhausted = claimed.attempts >= maxAttempts;
      await finish(sb, claimed.id, {
        status: exhausted ? 'dead' : 'failed',
        error_message: message
      });
      log('warn', 'sync_failed', {
        run_id: claimed.run_id,
        customer_id: claimed.customer_id,
        attempts: claimed.attempts,
        exhausted,
        error: message
      });
    }

    if (await abortIfFailing(sb, claimed.run_id, abortThreshold, abortMinSample)) {
      abortedRuns.add(claimed.run_id);
    }
  }

  const summary = {
    processed,
    succeeded,
    failed,
    held_for_canary: held,
    aborted_runs: [...abortedRuns],
    duration_ms: Date.now() - startedAt
  };
  if (processed || held) log('info', 'worker_finished', summary);
  return response(200, { success: true, ...summary });
};
