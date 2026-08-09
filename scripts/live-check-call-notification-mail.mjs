#!/usr/bin/env node
/**
 * Rauchtest fuer die zwei neuen Routen in Make-Szenario 09
 * (call_notification_email, callback_request_email).
 *
 * Schickt genau den Payload, den _lib/call-notification.js erzeugt, direkt an
 * die Mail-Engine - ohne Anruf, ohne Datenbank, ohne Netlify. Damit laesst
 * sich vor dem Deploy pruefen, was sonst erst ein echter Anruf zeigt:
 *
 *   * trifft der Router-Filter den mail_type,
 *   * loest {{1.recipient_email}} den Empfaenger auf,
 *   * rendern die aus Szenario 01 uebernommenen Vorlagen mit den Feldnamen
 *     dieses Payloads.
 *
 * Nicht abgedeckt: ob MAKE_MAIL_WEBHOOK auf der Dashboard-Site richtig
 * gesetzt ist. Das zeigt erst der echte Anruf nach dem Deploy.
 *
 * ── ACHTUNG: VERSENDET ECHTE E-MAIL ───────────────────────────────────────
 * Mit --send geht eine echte Mail ueber die produktive Mail-Engine raus.
 * Nur an eine eigene Adresse richten, nie an eine Kundenadresse.
 *
 * ── Aufruf ────────────────────────────────────────────────────────────────
 *   MAKE_MAIL_WEBHOOK=https://hook.eu1.make.com/... \
 *   RECIPIENT_EMAIL=du@example.com \
 *   node scripts/live-check-call-notification-mail.mjs            # Trockenlauf
 *
 *   ... node scripts/live-check-call-notification-mail.mjs --send  # wirklich
 *
 * Optional: --type=call_notification_email | callback_request_email
 *           (ohne Angabe werden beide Routen geprueft)
 *
 * Danach in Make die zwei Ausfuehrungen ansehen: erwartet wird pro Lauf genau
 * EIN durchlaufenes E-Mail-Modul. Laeuft stattdessen die Fallback-Route
 * ("unbekannter mail_type", Alarmmail an info@voxera.ch), passt der Filter
 * nicht zum mail_type.
 */

const WEBHOOK = (process.env.MAKE_MAIL_WEBHOOK || '').trim();
const RECIPIENT = (process.env.RECIPIENT_EMAIL || '').trim();
const SEND = process.argv.includes('--send');
const typeArg = (process.argv.find(arg => arg.startsWith('--type=')) || '').split('=')[1];

const ALL_TYPES = ['call_notification_email', 'callback_request_email'];

const missing = [];
if (!WEBHOOK) missing.push('MAKE_MAIL_WEBHOOK');
if (!RECIPIENT) missing.push('RECIPIENT_EMAIL');
if (missing.length) {
  console.error('Fehlende Umgebungsvariablen: ' + missing.join(', '));
  console.error('Siehe Kopfkommentar dieser Datei.');
  process.exit(2);
}
if (typeArg && !ALL_TYPES.includes(typeArg)) {
  console.error(`Unbekannter --type=${typeArg}. Erlaubt: ${ALL_TYPES.join(', ')}`);
  process.exit(2);
}

// Ein Wert, an dem sich die Testmail im Postfach erkennen laesst - und der in
// der Vorlage sichtbar wird, falls doch ein Feld falsch gemappt ist.
const MARKER = `RAUCHTEST ${new Date().toISOString()}`;

// Feld fuer Feld das, was buildPayload() in _lib/call-notification.js liefert.
// Weicht diese Liste ab, prueft der Rauchtest etwas anderes als die Produktion.
function buildTestPayload(mailType) {
  const callbackRequested = mailType === 'callback_request_email';
  return {
    mail_type: mailType,
    recipient_email: RECIPIENT,
    customer_id: 'cust_rauchtest',
    customer_name: 'Rauchtest AG',
    contact_name: 'Testperson',
    caller_name: 'Rauchtest Anrufer',
    caller_phone: '+41790000000',
    called_number: '+41445052800',
    call_summary: `${MARKER} - wenn diese Mail ankommt, greifen Filter, Empfaenger und Vorlage.`,
    call_summary_short: MARKER,
    callback_requested: callbackRequested,
    category: 'Sonstiges',
    // Kleinschreibung wie in der Datenbank. In den aus Szenario 01
    // uebernommenen Vorlagen wurde gross gegen "Hot"/"Warm" verglichen - faellt
    // das Abzeichen hier in den blauen Zweig, ist die Korrektur nicht
    // mitgekommen.
    lead_quality: 'hot',
    next_action: 'Rueckruf',
    priority: 'high',
    duration_seconds: 42,
    elevenlabs_conversation_id: 'conv_rauchtest',
    call_id: 'call_rauchtest',
    dashboard_url: 'https://dashboard.voxera.ch'
  };
}

const types = typeArg ? [typeArg] : ALL_TYPES;

console.log('Ziel:      ' + WEBHOOK.replace(/\/[^/]+$/, '/<hook-id>'));
console.log('Empfaenger:' + ' ' + RECIPIENT);
console.log('Typen:     ' + types.join(', '));
console.log('Marker:    ' + MARKER);

if (!SEND) {
  console.log('\nTrockenlauf - nichts gesendet. Payload je Typ:\n');
  for (const type of types) {
    console.log(JSON.stringify(buildTestPayload(type), null, 2));
  }
  console.log('\nMit --send tatsaechlich abschicken (echte E-Mail).');
  process.exit(0);
}

let failed = false;
for (const type of types) {
  const payload = buildTestPayload(type);
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    console.log(`\n${type}: HTTP ${res.status} ${text.slice(0, 200)}`);
    if (!res.ok) failed = true;
  } catch (error) {
    console.error(`\n${type}: Request fehlgeschlagen - ${error.message}`);
    failed = true;
  }
}

console.log('\nHinweis: HTTP 200 heisst nur, dass Make den Request angenommen hat.');
console.log('Make quittiert auch Payloads mit 200, die danach in der');
console.log('Fallback-Route landen. Entscheidend ist deshalb beides:');
console.log('  1. die Mail liegt im Postfach von ' + RECIPIENT);
console.log('  2. in Make zeigt die Ausfuehrung EIN durchlaufenes E-Mail-Modul,');
console.log('     nicht die Fallback-Route "unbekannter mail_type"');

process.exit(failed ? 1 : 0);
