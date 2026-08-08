#!/usr/bin/env node
/**
 * Live-Prüfung des Post-Call-Webhooks gegen eine deployte Site.
 *
 * Deckt die zwei Dinge ab, die sich nur über HTTP prüfen lassen:
 *   1. Der Lebenszyklus wird nicht zurückgedreht — ein Eintrag auf
 *      closed/archived/follow_up_scheduled/in_progress bleibt, wo er ist
 *      (Fix vom 08.08.2026, docs/POSTCALL_LIFECYCLE_DOWNGRADE_FIX_2026-08-08.md).
 *   2. Eine Kundenkorrektur der Zusammenfassung überlebt den erneuten Webhook
 *      (Etappe 4 Teil B / Feature 3).
 *
 * Das Secret wird ausschliesslich aus der Umgebung gelesen und nirgends
 * ausgegeben — auch nicht in Fehlermeldungen.
 *
 * ── ACHTUNG: DIESER AUFRUF HAT ECHTE NEBENWIRKUNGEN ────────────────────────
 * Ein erfolgreich zugestellter post_call_transcription-Webhook löst in der
 * Function zusätzlich aus:
 *   * MAKE_MAIL_WEBHOOK — ein echter E-Mail-Versand an den Kunden,
 *   * einen Eintrag in `notifications` (Glocke im Dashboard),
 *   * ein Überschreiben von call_summary / call_summary_short / transcript
 *     auf dem getroffenen Datensatz,
 *   * bis zu fünf ElevenLabs-API-Abrufe (Polling), sofern ELEVENLABS_API_KEY
 *     gesetzt ist.
 * Deshalb: nur gegen einen Testkunden-Datensatz fahren, dessen Inhalt
 * verloren gehen darf.
 *
 * ── Aufruf ────────────────────────────────────────────────────────────────
 *   SITE_URL=https://<site> \
 *   ELEVENLABS_WEBHOOK_SECRET=... \
 *   CONVERSATION_ID=conv_... \
 *   node scripts/live-check-postcall-webhook.mjs            # Trockenlauf
 *
 * Fügt --send hinzu, um den Request tatsächlich abzuschicken.
 *
 * Danach den Datenbank-Teil prüfen mit
 * supabase/verification/call_summary_correction_post_migration.sql
 * bzw. direkt:
 *   select dashboard_status, call_summary, call_summary_corrected
 *   from calls where elevenlabs_conversation_id = '<CONVERSATION_ID>';
 */

import crypto from 'node:crypto';

const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET || '';
const CONVERSATION_ID = process.env.CONVERSATION_ID || '';
const SEND = process.argv.includes('--send');

const missing = [];
if (!SITE_URL) missing.push('SITE_URL');
if (!SECRET) missing.push('ELEVENLABS_WEBHOOK_SECRET');
if (!CONVERSATION_ID) missing.push('CONVERSATION_ID');
if (missing.length) {
  console.error('Fehlende Umgebungsvariablen: ' + missing.join(', '));
  console.error('Siehe Kopfkommentar dieser Datei.');
  process.exit(2);
}

// Payload im Format, das der Haupt-Pfad erwartet (type + data.*). Die
// Analysefelder sind gefüllt, damit isAnalysisComplete() greift und die
// Function nicht in die Polling-Schleife läuft.
const payload = {
  type: 'post_call_transcription',
  data: {
    conversation_id: CONVERSATION_ID,
    status: 'done',
    metadata: { call_duration_secs: 92 },
    analysis: {
      data_collection_results: {
        call_summary: { value: 'ERNEUTER WEBHOOK-LAUF (Live-Pruefung ' + new Date().toISOString() + ')' },
        lead_quality: { value: 'warm' },
        priority: { value: 'medium' },
        next_action: { value: 'Rueckruf' }
      }
    }
  }
};

const rawBody = JSON.stringify(payload);
const ts = Math.floor(Date.now() / 1000);
// Format aus verifySignature(): "t=<unix>,v0=<hex>" über "<ts>.<rawBody>".
const signature =
  't=' + ts + ',v0=' +
  crypto.createHmac('sha256', SECRET).update(ts + '.' + rawBody).digest('hex');

const url = SITE_URL + '/.netlify/functions/elevenlabs-post-call';

console.log('Ziel:            ' + url);
console.log('conversation_id: ' + CONVERSATION_ID);
console.log('Signatur:        t=' + ts + ',v0=<' + 64 + ' hex-Zeichen>');
console.log('Body-Groesse:    ' + Buffer.byteLength(rawBody) + ' Bytes');

if (!SEND) {
  console.log('\nTrockenlauf — nichts gesendet. Mit --send tatsaechlich abschicken.');
  console.log('Bedenke die Nebenwirkungen im Kopfkommentar (E-Mail, Notification,');
  console.log('Ueberschreiben der Zusammenfassung).');
  process.exit(0);
}

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'ElevenLabs-Signature': signature
  },
  body: rawBody
});

const text = await res.text();
console.log('\nHTTP ' + res.status);
console.log(text);

if (!res.ok) {
  console.error('\nFehlgeschlagen. 401 = Signatur oder Secret passen nicht zur Site.');
  process.exit(1);
}

console.log('\nJetzt in der Datenbank pruefen:');
console.log("  select dashboard_status, call_summary, call_summary_corrected");
console.log("  from calls where elevenlabs_conversation_id = '" + CONVERSATION_ID + "';");
console.log('\nErwartet nach dem Fix:');
console.log('  dashboard_status        — unveraendert (nicht "new"), sofern der');
console.log('                            Eintrag vorher weiter als "new" war');
console.log('  call_summary            — ueberschrieben (gehoert dem Webhook)');
console.log('  call_summary_corrected  — unveraendert, falls eine Korrektur bestand');
