'use strict';

/**
 * Die Formatierung aus shared/core/admin-format.js festnageln.
 *
 * Der abgelöste Patch lief alle 1200 ms über jeden Textknoten des Dokuments.
 * Dabei zerstörte er Inhalte: aus
 *
 *     "V1-Schätzung: Basis 5 CHF + 0.018 CHF/Minute"
 * wurde
 *     "V1-Schätzung: Basis CHF 5.00 + 0.CHF 18.00/Minute"
 *
 * weil der Ausdruck nach dem Punkt in "0.018" eine Wortgrenze fand und
 * "018 CHF" als eigenständigen Betrag las. Der erste Test unten ist genau
 * dieser Satz. Er ist die Gegenprobe: gegen den alten Ausdruck schlägt er fehl.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Das Modul fasst beim Laden document an. Ein schlanker Ersatz genügt — die
// Textfunktionen selbst brauchen kein DOM.
globalThis.document = {
  documentElement: {},
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  body: null
};
globalThis.addEventListener = () => {};

require(path.join(__dirname, '..', 'shared', 'core', 'admin-format.js'));
const format = globalThis.VoxeraFormat;

test('Der Minutentarif überlebt die Formatierung', () => {
  const vorher = 'V1-Schätzung: Basis 5 CHF + 0.018 CHF/Minute + ggf. Extra-Minutenkosten.';
  const nachher = format.text(vorher);
  assert.ok(nachher.includes('0.018 CHF/Minute'),
    `Der Tarif wurde zerstoert: ${nachher}`);
  assert.ok(!nachher.includes('0.CHF'),
    `Die alte Zerlegung ist zurueck: ${nachher}`);
  assert.strictEqual(nachher, 'V1-Schätzung: Basis CHF 5.00 + 0.018 CHF/Minute + ggf. Extra-Minutenkosten.');
});

test('Betraege mit mehr als zwei Nachkommastellen bleiben unangetastet', () => {
  // Ein Tarif ist kein Rechnungsbetrag und darf nicht gerundet werden.
  assert.strictEqual(format.text('Tarif CHF 0.018 pro Minute'), 'Tarif CHF 0.018 pro Minute');
  assert.strictEqual(format.text('0.0175 CHF je Sekunde'), '0.0175 CHF je Sekunde');
});

test('Betraege werden in Schweizer Schreibweise gesetzt', () => {
  assert.strictEqual(format.text('Offen: CHF 1234.5'), "Offen: CHF 1'234.50");
  assert.strictEqual(format.text('Betrag 1234.50 CHF bezahlt'), "Betrag CHF 1'234.50 bezahlt");
  assert.strictEqual(format.text('Summe: -250 CHF Gutschrift'), 'Summe: CHF -250.00 Gutschrift');
});

test('Die Formatierung setzt nie mitten in einer laengeren Zahl an', () => {
  // Genau das war der Fehler: eine Wortgrenze hinter einem Punkt reichte aus.
  assert.strictEqual(format.text('Version 1.0.18 CHF egal'), 'Version 1.0.18 CHF egal');
});

test('Daten werden auf Schweizer Schreibweise gebracht', () => {
  assert.strictEqual(format.text('Rechnung vom 2026-08-09'), 'Rechnung vom 09.08.2026');
  assert.strictEqual(format.text('7.5.2026 fällig'), '07.05.2026 fällig');
  assert.match(format.text('Erstellt 2026-08-09T18:30:00Z'), /Erstellt 09\.08\.2026, \d{2}:\d{2}/);
});

test('Die Einzelformatierer liefern die kanonische Form', () => {
  assert.strictEqual(format.chf(5), 'CHF 5.00');
  assert.strictEqual(format.chf(1234.5), "CHF 1'234.50");
  assert.strictEqual(format.chf('unsinn'), '');
  assert.strictEqual(format.date('2026-08-09'), '09.08.2026');
});

test('Text ohne Betrag oder Datum bleibt Zeichen fuer Zeichen gleich', () => {
  const proben = [
    'Kunde: Sanitär Meier GmbH',
    'Keine offenen Anliegen',
    'Assistent Lara, Sprache Deutsch'
  ];
  for (const probe of proben) assert.strictEqual(format.text(probe), probe);
});
