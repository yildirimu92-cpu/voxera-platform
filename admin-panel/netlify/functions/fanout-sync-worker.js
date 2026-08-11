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
const { waveIsClear, abortIfFailing, syncBlockedReason } = require('./_lib/elevenlabs-fanout');

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

// Gruende, aus denen eine geclaimte Zeile ueberholt ist statt fehlgeschlagen.
const OBSOLETE_MESSAGES = Object.freeze({
  customer_terminated: 'Kunde wurde nach der Einplanung gekuendigt.',
  customer_missing: 'Kunde existiert nicht mehr.'
});

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

  // Steckengebliebene Zeilen zurueckholen, BEVOR Kandidaten gelesen werden.
  //
  // claim() setzt 'running'. Bricht die Invocation danach ab -- Netlify-Timeout,
  // Prozessende, unbehandelter Fehler --, bleibt die Zeile fuer immer so stehen:
  // die Kandidatenabfrage liest nur 'pending' und 'failed', und der partielle
  // Unique-Index verhindert gleichzeitig, dass derselbe Kunde neu eingeplant
  // wird. Eine einzige abgebrochene Invocation wuerde den Kunden also dauerhaft
  // stranden -- genau den, den der Fan-out nachziehen sollte.
  //
  // Zurueck auf 'failed' statt 'pending': attempts wurde beim Claim schon
  // hochgezaehlt, damit greift die normale Versuchsgrenze und eine Zeile, die
  // den Worker reproduzierbar umbringt, laeuft nicht endlos im Kreis.
  const staleAfterMs = intEnv('FANOUT_STALE_RUNNING_MINUTES', 15) * 60_000;
  const staleCutoff = new Date(Date.now() - staleAfterMs).toISOString();
  const { data: reclaimed, error: reclaimError } = await sb.from('elevenlabs_sync_queue')
    .update({
      status: 'failed',
      error_message: 'Worker-Invocation abgebrochen, Zeile zurueckgestellt.',
      updated_at: new Date().toISOString()
    })
    .eq('status', 'running')
    .lt('last_attempt_at', staleCutoff)
    .select('id, customer_id');
  if (reclaimError) log('warn', 'reclaim_failed', { error: reclaimError.message });
  else if (reclaimed?.length) {
    log('warn', 'reclaimed_stale_running', {
      count: reclaimed.length,
      customers: reclaimed.map((row) => row.customer_id)
    });
  }

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
  let obsolete = 0;
  let held = 0;
  let statePersistFailures = 0;
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

    // Der Zustand wird an der Quelle nachgelesen, nicht der eingefrorenen
    // Warteschlangenzeile geglaubt: zwischen Einplanung und hier kann der Kunde
    // gekuendigt worden sein. Siehe syncBlockedReason().
    let blockedReason = null;
    try {
      blockedReason = await syncBlockedReason(sb, claimed.customer_id);
    } catch (error) {
      // Lesefehler ist kein Freibrief. Die Zeile geht zurueck in den normalen
      // Wiederholungspfad, statt ungeprueft zu syncen oder totgeschrieben zu
      // werden.
      const message = `Kundenzustand nicht lesbar: ${String(error?.message || error).slice(0, 300)}`;
      const exhausted = claimed.attempts >= maxAttempts;
      await finish(sb, claimed.id, { status: exhausted ? 'dead' : 'failed', error_message: message });
      failed += 1;
      log('warn', 'state_check_failed', { run_id: claimed.run_id, customer_id: claimed.customer_id, exhausted });
      continue;
    }

    if (blockedReason) {
      // Wie beim fehlenden Agenten: eine ueberholte Zeile, kein Fehlschlag.
      // Bewusst NICHT als failed gezaehlt -- sonst treibt eine Kuendigungswelle
      // die Fehlerquote hoch und abortIfFailing() bricht einen gesunden Lauf ab.
      obsolete += 1;
      await finish(sb, claimed.id, { status: 'dead', error_message: OBSOLETE_MESSAGES[blockedReason] });
      log('info', 'sync_skipped_obsolete', {
        run_id: claimed.run_id,
        customer_id: claimed.customer_id,
        reason: blockedReason
      });
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
      // Der Agent steht, aber der Ist-Fingerprint konnte nicht geschrieben
      // werden: die Zeile ist erledigt (ein zweiter PATCH repariert nichts),
      // der Grund steht aber in der Zeile statt nur im Log. Der Kunde bleibt
      // 'unknown' und wird vom naechsten Planungslauf erneut eingeplant.
      const statePersisted = result.statePersisted !== false;
      if (!statePersisted) statePersistFailures += 1;
      await finish(sb, claimed.id, {
        status: 'done',
        error_message: statePersisted
          ? null
          : `Agent aktualisiert, Zustand nicht gespeichert: ${String(result.stateError || 'unbekannt').slice(0, 300)}`
      });
      log(statePersisted ? 'info' : 'warn', 'sync_done', {
        run_id: claimed.run_id,
        customer_id: claimed.customer_id,
        wave: claimed.wave,
        reason: claimed.reason,
        fingerprint: result.promptFingerprint,
        state_persisted: statePersisted
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
    obsolete,
    held_for_canary: held,
    state_persist_failures: statePersistFailures,
    aborted_runs: [...abortedRuns],
    duration_ms: Date.now() - startedAt
  };
  if (processed || held) log('info', 'worker_finished', summary);
  return response(200, { success: true, ...summary });
};
