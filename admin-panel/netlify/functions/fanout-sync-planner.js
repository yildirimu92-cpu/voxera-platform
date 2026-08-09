'use strict';

// S4 / Stufe 3 — der Planer: fuellt die Warteschlange von selbst.
//
// Zwei Ausloeser, wie im Konzept vorgeschlagen:
//
//   Zeitplan (netlify.toml, naechtlich)
//     Deckt beide Faelle ab: veraltete Vorlagen UND abgelaufene
//     Betriebsinformationen (S3). Ein reiner Deploy-Ausloeser sieht den
//     zweiten Fall nie -- "Ferien bis 8. August" laeuft ab, ohne dass
//     irgendein Deploy stattfindet.
//
//   Deploy (POST mit FANOUT_DEPLOY_SECRET, z.B. aus einem Netlify-Build-Hook)
//     Standardmaessig AUS: ohne gesetztes Secret weist der Endpunkt jeden
//     Aufruf ab. Das ist Absicht. Der schwerwiegendste Einwand gegen einen
//     deploy-getriebenen Fan-out war, dass der Ausloeser dann genau der
//     Moment ist, in dem ein fehlerhafter Prompt frisch ausgeliefert wurde.
//     Wer ihn einschaltet, bekommt den Canary aus dem Worker dazu -- ein
//     kaputter Deploy erreicht einen Agenten, nicht alle.
//
// Der Planer fasst selbst keinen Agenten an und macht keinen einzigen
// ElevenLabs-Aufruf. Er liest und plant ein; die Arbeit macht der Worker.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { findStaleCustomers, enqueueFanout } = require('./_lib/elevenlabs-fanout');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEPLOY_SECRET = process.env.FANOUT_DEPLOY_SECRET || '';

const headers = { 'Content-Type': 'application/json' };
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

function log(level, event, payload = {}) {
  console.log(JSON.stringify({ level, event, planner: 'fanout-sync', ...payload }));
}

function intEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// Zeitgesteuerte Netlify-Funktionen kommen ohne HTTP-Kontext; ein Aufruf von
// aussen bringt einen. Nur der zweite Fall muss sich ausweisen.
function isScheduledInvocation(event) {
  return !event || !event.httpMethod;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

exports.handler = async (event) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return response(500, { error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }

  const scheduled = isScheduledInvocation(event);
  let trigger = 'schedule';

  if (!scheduled) {
    if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
    // Ohne konfiguriertes Secret ist der Deploy-Ausloeser bewusst nicht
    // benutzbar -- nicht "offen, aber ungenutzt".
    if (!DEPLOY_SECRET) {
      return response(404, { error: 'Deploy-Ausloeser ist nicht konfiguriert.' });
    }
    const provided = event.headers?.['x-fanout-secret'] || event.headers?.['X-Fanout-Secret'] || '';
    if (!timingSafeEqual(provided, DEPLOY_SECRET)) {
      return response(401, { error: 'Unauthorized' });
    }
    trigger = 'deploy';
  }

  const maxPerRun = intEnv('FANOUT_MAX_PER_RUN', 25);
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const stale = await findStaleCustomers(sb);
    if (!stale.length) {
      log('info', 'nothing_to_plan', { trigger });
      return response(200, { success: true, trigger, enqueued: 0, stale: 0 });
    }

    // Obergrenze pro Lauf, damit ein einmaliger Vorlagenwechsel nicht die
    // gesamte Kundenbasis in eine Warteschlange kippt. Was uebrig bleibt, holt
    // der naechste Lauf -- und was abgeschnitten wurde, steht im Log. Eine
    // stille Kuerzung waere schlimmer als gar keine Grenze: sie laese den Lauf
    // aussehen, als haette er alles erledigt.
    const selected = stale.slice(0, maxPerRun);
    const dropped = stale.length - selected.length;
    if (dropped > 0) {
      log('warn', 'run_capped', { trigger, stale: stale.length, planned: selected.length, dropped });
    }

    const runId = crypto.randomUUID();
    const result = await enqueueFanout(sb, { runId, customers: selected });

    log('info', 'planned', {
      trigger,
      run_id: runId,
      stale: stale.length,
      enqueued: result.enqueued,
      skipped: result.skipped,
      dropped,
      reasons: selected.reduce((acc, row) => {
        acc[row.reason] = (acc[row.reason] || 0) + 1;
        return acc;
      }, {})
    });

    return response(200, {
      success: true,
      trigger,
      stale: stale.length,
      dropped,
      ...result
    });
  } catch (error) {
    log('error', 'planning_failed', { trigger, error: error?.message || String(error) });
    return response(500, { error: 'Fan-out konnte nicht geplant werden.' });
  }
};
