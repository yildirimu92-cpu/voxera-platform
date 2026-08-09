'use strict';

// S4 / Stufe 2+3 — wen der Fan-out anfasst, und wie er ihn einplant.
//
// Diese Datei beantwortet genau eine Frage: welche Kunden laufen nicht auf dem
// aktuellen Stand? Sie fasst dafuer keinen Agenten an und macht keinen einzigen
// ElevenLabs-Aufruf -- das ist der Grund, warum die Vorschau gefahrlos ist und
// warum der Planer nachts laufen kann, ohne dass jemand zusieht.
//
// Zwei Gruende zaehlen als "nicht aktuell":
//
//   1. Fingerprint. Builder-Version, Master-Prompt oder Branchenvorlage haben
//      sich geaendert, seit der Agent zuletzt bespielt wurde. Deckt S1, S13 und
//      jede kuenftige Korrektur an Layer 1/2 ab.
//      'fingerprint_unknown' ist derselbe Fall mit fehlender Messung: direkt
//      nach der Einfuehrung hat jeder Bestandskunde prompt_fingerprint = null.
//      Wuerde das als "aktuell" gelten, waeren ausgerechnet die Kunden
//      unsichtbar, fuer die S4 gebaut wurde.
//
//   2. Abgelaufene Betriebsinformationen (S3). loadPromptInputs() filtert
//      Betriebsinformationen zur LESEZEIT ueber ends_at > now(). Der Prompt
//      beim Agenten ist aber eingefroren: "Ferien bis 8. August" bleibt nach
//      dem 8. August stehen, bis irgendein anderer Anlass einen Sync ausloest.
//      Ein Fan-out, der nur auf Deploys reagiert, sieht diesen Fall nie -- ein
//      zeitgesteuerter loest beide.

const { loadFingerprintContext, fingerprintFor } = require('./prompt-fingerprint');

// Canary: die erste Welle ist bewusst genau ein Kunde. Der Worker gibt die
// zweite Welle erst frei, wenn die erste erfolgreich war.
const CANARY_WAVE_SIZE = 1;

const REASON_LABELS = Object.freeze({
  fingerprint_stale: 'Prompt-Stand veraltet',
  fingerprint_unknown: 'Prompt-Stand unbekannt',
  operational_expired: 'Betriebsinformation abgelaufen',
  manual: 'Manuell eingeplant'
});

/**
 * Alle Kunden mit Agent, die nicht auf dem aktuellen Stand sind.
 * Reine Leseoperation.
 */
async function findStaleCustomers(sb) {
  const [{ data: customers, error: customerError }, context] = await Promise.all([
    sb.from('customers')
      .select('id, customer_name, elevenlabs_agent_id, prompt_fingerprint, industry_template_id, elevenlabs_last_sync_at')
      .not('elevenlabs_agent_id', 'is', null),
    loadFingerprintContext(sb)
  ]);
  if (customerError) throw customerError;

  const withAgent = (customers || []).filter((row) => String(row.elevenlabs_agent_id || '').trim());
  const expiredByCustomer = await findExpiredOperationalUpdates(sb, withAgent);

  const stale = [];
  for (const customer of withAgent) {
    const expected = fingerprintFor(context, customer);
    let reason = null;
    if (!customer.prompt_fingerprint) reason = 'fingerprint_unknown';
    else if (customer.prompt_fingerprint !== expected) reason = 'fingerprint_stale';
    else if (expiredByCustomer.has(customer.id)) reason = 'operational_expired';
    if (!reason) continue;

    stale.push({
      customer_id: customer.id,
      customer_name: customer.customer_name || customer.id,
      agent_id: String(customer.elevenlabs_agent_id).trim(),
      reason,
      reason_label: REASON_LABELS[reason] || reason,
      current_fingerprint: customer.prompt_fingerprint || null,
      expected_fingerprint: expected,
      last_sync_at: customer.elevenlabs_last_sync_at || null
    });
  }
  return stale;
}

// S3: Betriebsinformationen, die seit dem letzten Sync abgelaufen sind, stehen
// im Agenten noch drin. Der Fingerprint sieht das nicht -- er kennt nur die
// gemeinsamen Vorlagen, nicht die Zeit.
async function findExpiredOperationalUpdates(sb, customers) {
  const expired = new Set();
  const candidates = customers.filter((row) => row.elevenlabs_last_sync_at);
  if (!candidates.length) return expired;

  const nowIso = new Date().toISOString();
  const { data, error } = await sb.from('customer_operational_updates')
    .select('customer_id, ends_at')
    .in('customer_id', candidates.map((row) => row.id))
    .eq('status', 'published')
    .lte('ends_at', nowIso);
  if (error) {
    // Ein Ausfall hier darf den Fingerprint-Teil nicht mitreissen: lieber
    // weniger Kunden einplanen als gar keinen Fan-out.
    console.warn('[elevenlabs-fanout] operational_lookup_failed', error.message);
    return expired;
  }

  const lastSyncById = new Map(candidates.map((row) => [row.id, new Date(row.elevenlabs_last_sync_at).getTime()]));
  for (const row of data || []) {
    const lastSync = lastSyncById.get(row.customer_id);
    const endsAt = new Date(row.ends_at).getTime();
    // Nur was NACH dem letzten Sync abgelaufen ist, steht noch im Prompt. Was
    // vorher ablief, war beim letzten Bauen schon herausgefiltert.
    if (Number.isFinite(lastSync) && Number.isFinite(endsAt) && endsAt > lastSync) {
      expired.add(row.customer_id);
    }
  }
  return expired;
}

/**
 * Legt einen Fan-out-Lauf an: Welle 1 mit einem Kunden (Canary), alles Weitere
 * in Welle 2.
 *
 * `runId` kommt vom Aufrufer, damit derselbe Lauf ueber mehrere Aufrufe hinweg
 * identifizierbar bleibt (crypto.randomUUID() beim Aufrufer, nicht hier -- so
 * bleibt diese Datei ohne Seiteneffekte testbar).
 */
async function enqueueFanout(sb, { runId, customers, canarySize = CANARY_WAVE_SIZE }) {
  if (!Array.isArray(customers) || !customers.length) {
    return { run_id: runId, enqueued: 0, skipped: 0, waves: 0 };
  }

  const rows = customers.map((entry, index) => ({
    run_id: runId,
    customer_id: entry.customer_id,
    agent_id: entry.agent_id || null,
    status: 'pending',
    reason: entry.reason || 'manual',
    wave: index < canarySize ? 1 : 2,
    expected_fingerprint: entry.expected_fingerprint || null
  }));

  // Der partielle Unique-Index laesst einen Kunden nicht zweimal offen stehen.
  // Ein Konflikt ist deshalb kein Fehler, sondern die richtige Antwort: der
  // Kunde ist bereits eingeplant. Zeile fuer Zeile, damit ein Konflikt nicht
  // den ganzen Stapel verwirft.
  let enqueued = 0;
  let skipped = 0;
  for (const row of rows) {
    const { error } = await sb.from('elevenlabs_sync_queue').insert(row);
    if (!error) { enqueued += 1; continue; }
    if (isUniqueViolation(error)) { skipped += 1; continue; }
    throw error;
  }

  return {
    run_id: runId,
    enqueued,
    skipped,
    waves: rows.some((row) => row.wave === 2) ? 2 : 1
  };
}

function isUniqueViolation(error) {
  return error?.code === '23505' || /duplicate key value/i.test(String(error?.message || ''));
}

// ── Sicherheitsmechanik ─────────────────────────────────────────────────────
// Canary und Abbruchkriterium sind die beiden Eigenschaften, die einen
// automatischen Fan-out von einem "sync alle" unterscheiden. Sie liegen
// deshalb hier und nicht im Worker: sie sind Politik, nicht Transport, und
// sind so ohne Supabase-Client pruefbar.

/**
 * Eine hoehere Welle laeuft erst, wenn ALLE vorherigen Wellen abgeschlossen und
 * erfolgreich sind. Ein einziger Fehlschlag in Welle 1 haelt Welle 2 an -- das
 * ist der ganze Zweck des Canary.
 */
async function waveIsClear(sb, runId, wave) {
  if (wave <= 1) return true;
  const { data, error } = await sb.from('elevenlabs_sync_queue')
    .select('status')
    .eq('run_id', runId)
    .lt('wave', wave);
  if (error) {
    console.warn('[elevenlabs-fanout] wave_check_failed', error.message);
    return false;
  }
  const rows = data || [];
  if (!rows.length) return true;
  return rows.every((row) => row.status === 'done');
}

/**
 * Abbruchkriterium pro Lauf. Gezaehlt wird gegen die bereits abgeschlossenen
 * Zeilen, nicht gegen die geplante Gesamtzahl -- sonst schlaegt die Schwelle
 * bei einem grossen Lauf erst zu, wenn der Schaden laengst angerichtet ist.
 *
 * `minSample` verhindert das Gegenteil: bei einer einzigen fehlgeschlagenen
 * Zeile waere die Quote 100% und jeder Lauf endete nach dem ersten Stolperer.
 */
async function abortIfFailing(sb, runId, threshold, minSample) {
  const { data, error } = await sb.from('elevenlabs_sync_queue')
    .select('status')
    .eq('run_id', runId)
    .in('status', ['done', 'failed', 'dead']);
  if (error) return false;

  const rows = data || [];
  if (rows.length < minSample) return false;
  const bad = rows.filter((row) => row.status === 'dead' || row.status === 'failed').length;
  if (bad / rows.length < threshold) return false;

  const { data: cancelled, error: cancelError } = await sb.from('elevenlabs_sync_queue')
    .update({
      status: 'cancelled',
      error_message: `Lauf abgebrochen: ${bad} von ${rows.length} Syncs fehlgeschlagen.`,
      updated_at: new Date().toISOString()
    })
    .eq('run_id', runId)
    .eq('status', 'pending')
    .select('id');
  if (cancelError) {
    console.warn('[elevenlabs-fanout] abort_cancel_failed', cancelError.message);
    return false;
  }
  console.log(JSON.stringify({
    level: 'error',
    event: 'run_aborted',
    run_id: runId,
    failed: bad,
    completed: rows.length,
    cancelled: (cancelled || []).length
  }));
  return true;
}

/** Zaehlt die Zeilen eines Laufs nach Status. */
async function runSummary(sb, runId) {
  const { data, error } = await sb.from('elevenlabs_sync_queue')
    .select('status, wave, customer_id, reason, error_message, attempts, updated_at')
    .eq('run_id', runId);
  if (error) throw error;

  const counts = { pending: 0, running: 0, done: 0, failed: 0, dead: 0, cancelled: 0 };
  for (const row of data || []) {
    if (counts[row.status] === undefined) counts[row.status] = 0;
    counts[row.status] += 1;
  }
  return { run_id: runId, counts, rows: data || [] };
}

module.exports = {
  CANARY_WAVE_SIZE,
  REASON_LABELS,
  findStaleCustomers,
  findExpiredOperationalUpdates,
  enqueueFanout,
  runSummary,
  waveIsClear,
  abortIfFailing,
  isUniqueViolation
};
