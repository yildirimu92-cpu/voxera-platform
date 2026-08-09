'use strict';

/**
 * Regressionstest fuer die Willkommens-Karte, die am 09.08.2026 die
 * 7-Schritt-Spotlight-Tour abgeloest hat.
 *
 * Geprueft wird das Verhalten von vxOnboardingRenderBody(), weil dort die
 * drei Entscheidungen zusammenlaufen, die die alte Tour hat scheitern lassen:
 *   1. Die Bereichsnamen kommen aus der Navigation. Der alte Text nannte
 *      "Mehr", der Eintrag hiess laengst "Einstellungen" — eine zweite
 *      Textquelle veraltet still.
 *   2. Der offene Punkt "Rufumleitung" erscheint nur, wenn er offen ist, und
 *      traegt dann seine Handlung direkt daneben (Grundsatz 13).
 *   3. Kundendaten (Assistentenname, Vorname) laufen durch den Escaper.
 *
 * Nicht geprueft: Darstellung und Zusammenspiel mit der echten Datenbank.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'index.html'),
  'utf8'
);

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' nicht in index.html gefunden');
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') { depth += 1; seenBody = true; }
    else if (char === '}') {
      depth -= 1;
      if (seenBody && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Funktionsende fuer ' + name + ' nicht gefunden');
}

// Minimale DOM-Attrappe: nur was die Funktion anfasst. Der Rest des
// Dashboards ist fuer diese Frage ohne Belang.
function makeElement(id) {
  return { id, innerHTML: '', textContent: '' };
}

function render(meta, options) {
  const opts = options || {};
  const nodes = {
    'vx-onboarding-list': makeElement('vx-onboarding-list'),
    'vx-onboarding-actions': makeElement('vx-onboarding-actions'),
    'vx-onboarding-title': makeElement('vx-onboarding-title'),
    'vx-onboarding-sub': makeElement('vx-onboarding-sub'),
    'vx-onboarding-copy': makeElement('vx-onboarding-copy'),
  };
  // Die Navigation liefert die Beschriftungen. Fehlt sie (Attrappe ohne
  // Eintraege), muss die Funktion auf ihre Ersatzwerte fallen.
  if (!opts.navMissing) {
    nodes['nav-anrufe'] = Object.assign(makeElement('nav-anrufe'), { textContent: opts.anfragenLabel || '\n  Anfragen\n  ' });
    nodes['nav-assistent'] = Object.assign(makeElement('nav-assistent'), { textContent: '\n  Assistent\n  ' });
  }

  const ctx = {
    customerMeta: meta,
    isForwardingSetupCompleted: function () { return !!opts.forwardingDone; },
    _esc: function (value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    document: {
      getElementById: function (id) { return nodes[id] || null; },
    },
    console: { warn: function () {} },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction('vxOnboardingRenderBody'), ctx);
  ctx.vxOnboardingRenderBody();
  return nodes;
}

const BASE_META = { assistantName: 'Lara', contactFirstName: 'Ursula', customerName: 'Ursula Meier' };

test('offene Rufumleitung: dritter Punkt samt Handlung, Grundsatz 13', () => {
  const nodes = render(BASE_META, { forwardingDone: false });
  assert.match(nodes['vx-onboarding-list'].innerHTML, /Noch offen: Rufumleitung/);
  assert.match(nodes['vx-onboarding-actions'].innerHTML, /vxOnboardingStartForwarding\(\)/);
  assert.match(nodes['vx-onboarding-actions'].innerHTML, /Rufumleitung jetzt einrichten/);
  // Ein Aufschub muss angeboten sein, sonst ist die Karte eine Sackgasse.
  assert.match(nodes['vx-onboarding-actions'].innerHTML, /Später/);
});

test('eingerichtete Rufumleitung: kein offener Punkt, genau ein Knopf', () => {
  const nodes = render(BASE_META, { forwardingDone: true });
  assert.doesNotMatch(nodes['vx-onboarding-list'].innerHTML, /Rufumleitung/);
  assert.doesNotMatch(nodes['vx-onboarding-actions'].innerHTML, /vxOnboardingStartForwarding/);
  const buttons = nodes['vx-onboarding-actions'].innerHTML.match(/<button/g) || [];
  assert.equal(buttons.length, 1, 'ohne offenen Punkt gehoert genau ein Knopf auf die Karte');
});

test('Bereichsnamen stammen aus der Navigation, nicht aus einer zweiten Textquelle', () => {
  // Wird der Eintrag umbenannt, wandert der Name mit — genau das ist der
  // Unterschied zum alten Text, der dauerhaft "Mehr" sagte.
  const nodes = render(BASE_META, { forwardingDone: true, anfragenLabel: '\n  Posteingang\n  ' });
  assert.match(nodes['vx-onboarding-list'].innerHTML, /Posteingang/);
  assert.doesNotMatch(nodes['vx-onboarding-list'].innerHTML, />Anfragen</);
});

test('fehlende Navigation faellt auf lesbare Ersatzwerte zurueck', () => {
  // Wichtig, weil genau dieser Fall die alte Tour in eine deckende
  // Vollflaeche kippen liess. Hier darf er nur einen Ersatztext bedeuten.
  const nodes = render(BASE_META, { forwardingDone: true, navMissing: true });
  assert.match(nodes['vx-onboarding-list'].innerHTML, /Anfragen/);
  assert.match(nodes['vx-onboarding-list'].innerHTML, /Assistent/);
});

test('Assistentenname und Vorname laufen durch den Escaper', () => {
  const nodes = render(
    { assistantName: '<img src=x onerror=alert(1)>', contactFirstName: 'Ursula' },
    { forwardingDone: true }
  );
  assert.doesNotMatch(nodes['vx-onboarding-list'].innerHTML, /<img/);
  assert.match(nodes['vx-onboarding-list'].innerHTML, /&lt;img/);
  // Die Ueberschrift wird als textContent gesetzt und braucht keinen Escaper,
  // darf den Namen aber auch nicht verlieren.
  assert.equal(nodes['vx-onboarding-title'].textContent, 'Willkommen bei Voxera, Ursula');
});

test('ohne Vorname bleibt die Ueberschrift ohne Anrede', () => {
  const nodes = render({ assistantName: 'Lara' }, { forwardingDone: true });
  assert.equal(nodes['vx-onboarding-title'].textContent, 'Willkommen bei Voxera');
});

test('Vorname wird aus dem Kundennamen abgeleitet, wenn kein Kontaktvorname vorliegt', () => {
  const nodes = render({ assistantName: 'Lara', customerName: 'Ursula Meier' }, { forwardingDone: true });
  assert.equal(nodes['vx-onboarding-title'].textContent, 'Willkommen bei Voxera, Ursula');
});

test('ohne Assistentennamen steht ein neutraler Ersatz statt einer Luecke', () => {
  const nodes = render({ contactFirstName: 'Ursula' }, { forwardingDone: true });
  assert.match(nodes['vx-onboarding-sub'].textContent, /^Ihr Assistent ist eingerichtet/);
  assert.doesNotMatch(nodes['vx-onboarding-list'].innerHTML, /undefined|null/);
});
