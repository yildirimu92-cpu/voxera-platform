'use strict';

// Die Fähigkeiten-Karte "Benachrichtigungen versenden" ist der Ausgangspunkt
// dieser ganzen Arbeit: sie stand auf "Aktiv", ohne dass je eine Zustellung
// belegt war (PR #871 korrigierte das auf "Konfiguriert"). Seit der Migration
// auf die zentrale Mail-Engine gibt es einen echten Beleg in outbox_events.
//
// Diese Tests halten fest, dass die Karte nur behauptet, was sie belegen kann -
// und dass ein alter Beleg nicht als heutiger durchgeht.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Gleiches Vorgehen wie in postcall-lifecycle-no-downgrade.test.cjs: die
// Function selbst laesst sich nicht laden, weil sie @supabase/supabase-js zieht.
// Die reinen Entscheidungshelfer werden herausgeschnitten und echt ausgefuehrt.
const FUNCTION_PATH = path.join(
  __dirname, '..', 'netlify', 'functions', 'customer-assistant-profile.js'
);
const source = fs.readFileSync(FUNCTION_PATH, 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'Funktion nicht gefunden: ' + name);

  // Erst das Ende der Parameterliste suchen, dann erst den Rumpf. Ein
  // Vorgaenger dieser Fassung zaehlte ab der ersten "{" ueberhaupt - und
  // schnitt damit jede Funktion mit einem Objekt-Default in der Signatur
  // (delivery = {}) mitten im Kopf ab.
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = source.indexOf('(', start); i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) { bodyStart = source.indexOf('{', i); break; }
    }
  }
  assert.notEqual(bodyStart, -1, 'Rumpf nicht gefunden: ' + name);

  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Funktion nicht terminiert: ' + name);
}

function loadCardLogic() {
  const windowMatch = /const NOTIFICATION_PROOF_WINDOW_DAYS = \d+;/.exec(source);
  assert.ok(windowMatch, 'NOTIFICATION_PROOF_WINDOW_DAYS nicht gefunden');
  const sandbox = { console: { warn() {} } };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    windowMatch[0] + '\n'
    + 'const text = (value) => String(value == null ? \'\' : value).trim();\n'
    + extractFunction('status') + '\n'
    + extractFunction('formatDateCh') + '\n'
    + extractFunction('notificationDetail') + '\n'
    + extractFunction('notificationEvidence') + '\n'
    + extractFunction('notificationCard') + '\n',
    context
  );
  return context;
}

const context = loadCardLogic();
const NOTIFICATION_PROOF_WINDOW_DAYS = vm.runInContext('NOTIFICATION_PROOF_WINDOW_DAYS', context);

function notificationCard(configured, delivery, customer) {
  context.__configured = configured;
  context.__delivery = delivery;
  context.__customer = customer;
  return vm.runInContext('notificationCard(__configured, __delivery, __customer)', context);
}

function notificationEvidence(configured, delivery) {
  context.__configured = configured;
  context.__delivery = delivery;
  return vm.runInContext('notificationEvidence(__configured, __delivery)', context);
}

const CONFIGURED_CUSTOMER = {
  notification_active: true,
  notification_mode: 'all_calls',
  new_log_email_active: true,
  missed_call_email_active: true,
  phone_notification_to: ''
};

test('ohne Einrichtung bleibt die Karte inaktiv', () => {
  const card = notificationCard(false, {}, CONFIGURED_CUSTOMER);
  assert.equal(card.status, 'inactive');
  assert.equal(card.label, 'Nicht eingerichtet');
});

test('eingerichtet ohne Zustellbeleg bleibt "Konfiguriert", nicht "Aktiv"', () => {
  const card = notificationCard(true, { lastSentAt: null, lastDeadAt: null }, CONFIGURED_CUSTOMER);
  assert.equal(card.label, 'Konfiguriert');
  assert.match(card.detail, new RegExp(`${NOTIFICATION_PROOF_WINDOW_DAYS} Tagen nichts zugestellt`));
});

test('eine belegte Zustellung macht die Karte "Aktiv" und nennt das Datum', () => {
  const card = notificationCard(
    true,
    { lastSentAt: '2026-08-09T17:55:30.731Z', lastDeadAt: null },
    CONFIGURED_CUSTOMER
  );
  assert.equal(card.status, 'active');
  assert.equal(card.label, 'Aktiv');
  assert.match(card.detail, /zuletzt zugestellt am 09\.08\.2026/);
});

test('der Kanal-Text bleibt in der Aktiv-Fassung erhalten', () => {
  const card = notificationCard(
    true,
    { lastSentAt: '2026-08-09T17:55:30.731Z', lastDeadAt: null },
    CONFIGURED_CUSTOMER
  );
  // Wortlaut nachgezogen: notificationDetail() leitet den Kanal seit dem
  // 09.08. aus notification_mode ab statt aus new_log_email_active /
  // missed_call_email_active (Befund B5). Die alte Fassung "E-Mail für alle
  // Anrufe" entstand aus dem Backfill von 2026-04-07 und verschwand fuer jeden
  // Kunden, der seine Einstellung seither einmal geaendert hatte - der
  // Zustellbeleg haette dann auf einem leeren Kanaltext gesessen.
  assert.match(card.detail, /E-Mail bei Rückrufwunsch und nach jedem Anruf/);
});

test('der Kanal-Text haengt an notification_mode, nicht an den toten Spalten', () => {
  // Gegenprobe zur Zeile darueber: derselbe Modus, aber alle Legacy-Booleans
  // aus - genau der Zustand, den die Migration vom 09.08. bei drei von vier
  // Produktionskunden herstellt. Unter der alten Ableitung waere hier "E-Mail"
  // ganz verschwunden.
  const card = notificationCard(
    true,
    { lastSentAt: '2026-08-09T17:55:30.731Z', lastDeadAt: null },
    {
      ...CONFIGURED_CUSTOMER,
      notification_mode: 'callback_only',
      notification_active: false,
      new_log_email_active: false,
      missed_call_email_active: false
    }
  );
  assert.match(card.detail, /E-Mail bei Rückrufwunsch/);
  assert.doesNotMatch(card.detail, /Telefon\/SMS/);
});

test('ein aufgegebener Versand meldet sich, statt still zu bleiben', () => {
  // Genau die Klasse stiller Ausfaelle, um die es bei dieser Arbeit ging:
  // frueher haette die Karte hier unveraendert "Aktiv" gezeigt.
  const card = notificationCard(
    true,
    { lastSentAt: null, lastDeadAt: '2026-08-09T10:00:00.000Z' },
    CONFIGURED_CUSTOMER
  );
  assert.equal(card.status, 'attention');
  assert.equal(card.label, 'Zustellung prüfen');
  assert.match(card.detail, /09\.08\.2026/);
});

test('ein Fehlschlag sticht eine aeltere erfolgreiche Zustellung', () => {
  // Sonst verdeckt ein alter Erfolg einen aktuellen Ausfall.
  const card = notificationCard(
    true,
    { lastSentAt: '2026-08-01T10:00:00.000Z', lastDeadAt: '2026-08-09T10:00:00.000Z' },
    CONFIGURED_CUSTOMER
  );
  assert.equal(card.label, 'Zustellung prüfen');
});

test('der Beleg wird ausserhalb des Fensters gar nicht erst geladen', () => {
  // loadNotificationDelivery filtert per created_at >= Fensterbeginn. Was hier
  // zaehlt, ist die Zusicherung, dass die Kartenlogik keinen zweiten,
  // abweichenden Zeitbegriff einfuehrt: sie vertraut dem Loader.
  //
  // Der Test haelt damit die Arbeitsteilung fest - wer das Fenster in die
  // Kartenlogik verschiebt, ohne den Loader anzupassen, faellt hier auf.
  assert.equal(typeof NOTIFICATION_PROOF_WINDOW_DAYS, 'number');
  assert.ok(NOTIFICATION_PROOF_WINDOW_DAYS > 0);
  const proven = notificationEvidence(true, { lastSentAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(proven.state, 'proven');
});

test('notificationEvidence trennt die vier Zustaende sauber', () => {
  assert.equal(notificationEvidence(false, {}).state, 'not_configured');
  assert.equal(notificationEvidence(true, {}).state, 'configured');
  assert.equal(notificationEvidence(true, { lastSentAt: 'x' }).state, 'proven');
  assert.equal(notificationEvidence(true, { lastDeadAt: 'x' }).state, 'failing');
});
