'use strict';

/**
 * Regression coverage for shared/customer-runtime-calendar-settings.js.
 *
 * Hintergrund: Der K2-Fix sperrt das Speichern, solange der gespeicherte
 * aktive Anbieter keine verbundene Verbindung hat (typisch
 * `reauthorization_required`) — sonst schrieb `save()` ein ungewolltes
 * „Nicht aktiv" zurueck. Dabei entstand eine Sackgasse: die Anbieterkarte
 * zeigte „Trennen" nur im Zustand `connected`, das Speichern war gesperrt
 * und die Anbieterauswahl deaktiviert. Damit gab es fuer einen Kunden, der
 * die Integration bewusst abschalten wollte, keinen Weg mehr heraus,
 * waehrend `calendar-tool.js` jede Buchung mangels verbundenem Anbieter
 * abwies.
 *
 * Diese Tests halten fest, dass „Trennen" an der *Existenz* der Verbindung
 * haengt, nicht an ihrem Status — und dass die Sperre des Speicherns dabei
 * erhalten bleibt.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

function makeElement(byId, tag) {
  const element = {
    tagName: String(tag || 'div').toUpperCase(),
    className: '',
    hidden: false,
    innerHTML: '',
    textContent: '',
    type: '',
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child) { this.children.push(child); return child; },
    querySelector() { return makeElement(byId, 'div'); },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeAttribute() {},
    setAttribute() {}
  };
  let ownId = '';
  Object.defineProperty(element, 'id', {
    get: () => ownId,
    set: (value) => { ownId = String(value); byId[ownId] = element; }
  });
  return element;
}

// Rendert die Kalenderseite gegen einen gestubbten Serverzustand und gibt das
// erzeugte Markup zurueck. Getrieben wird ueber preload(), das beim Laden des
// Moduls automatisch laeuft, sobald callDashboardFunction bereitsteht.
async function renderWith(status) {
  const filePath = path.join(__dirname, '..', 'shared', 'customer-runtime-calendar-settings.js');
  const code = fs.readFileSync(filePath, 'utf8');

  const byId = Object.create(null);
  ['mehr-main', 'tab-mehr', 'vx-calendar-page-body', 'vx-calendar-status'].forEach((id) => {
    const element = makeElement(byId, 'div');
    element.id = id;
  });

  const document = {
    readyState: 'complete',
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => makeElement(byId, tag),
    querySelectorAll: () => [],
    addEventListener() {}
  };

  const sandbox = {
    document,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    location: { origin: 'https://dashboard.voxera.test' },
    addEventListener() {},
    callDashboardFunction: async () => status
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'customer-runtime-calendar-settings.js' });

  // preload() ist async und haengt an mehreren await-Stufen. setImmediate
  // laeuft nach der Microtask-Queue, damit ist die Kette sicher durch.
  await new Promise((resolve) => setImmediate(resolve));

  return byId['vx-calendar-page-body'].innerHTML;
}

function statusWith(googleStatus, activeProvider) {
  return {
    enabled: true,
    available_providers: ['google'],
    provider_configured: { google: true },
    connections: googleStatus
      ? [{ provider: 'google', status: googleStatus, account_email: 'kalender@voxera.test', calendars: [], selected_calendar_id: null }]
      : [],
    settings: {
      active_provider: activeProvider || null,
      feature_enabled: !!activeProvider,
      timezone: 'Europe/Zurich',
      appointment_duration_minutes: 30,
      minimum_notice_minutes: 120,
      buffer_before_minutes: 0,
      buffer_after_minutes: 10,
      booking_horizon_days: 60
    }
  };
}

test('reauthorization_required: Trennen bleibt erreichbar, Speichern bleibt gesperrt', async () => {
  const html = await renderWith(statusWith('reauthorization_required', 'google'));

  assert.match(html, /data-calendar-disconnect="google"/,
    'Ohne „Trennen" gibt es in diesem Zustand keinen Weg aus der Integration heraus.');
  assert.match(html, /data-calendar-connect="google"/,
    'Der Weg zur Neuanmeldung muss ebenfalls sichtbar bleiben.');
  assert.match(html, /id="vx-calendar-save"[^>]*disabled/,
    'Die Sperre des Speicherns aus dem K2-Fix muss bestehen bleiben.');
  assert.match(html, /id="vx-cal-active-provider"[^>]*disabled/,
    'Die Anbieterauswahl bleibt in diesem Zustand deaktiviert.');
});

test('verbunden: Trennen und Verbindung pruefen, Speichern frei', async () => {
  const html = await renderWith(statusWith('connected', 'google'));

  assert.match(html, /data-calendar-disconnect="google"/);
  assert.match(html, /data-calendar-test="google"/);
  assert.doesNotMatch(html, /id="vx-calendar-save"[^>]*disabled/,
    'Im verbundenen Zustand darf das Speichern nicht gesperrt sein.');
});

test('ohne Verbindung: nur Verbinden, kein Trennen', async () => {
  const html = await renderWith(statusWith(null, null));

  assert.match(html, /data-calendar-connect="google"/);
  assert.doesNotMatch(html, /data-calendar-disconnect/,
    'Ohne bestehende Verbindung gibt es nichts zu trennen.');
});
