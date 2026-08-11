// Test zu scripts/verify-browser-column-grants.mjs.
//
// Der wichtigste Fall ist die Gegenprobe: Der Waechter muss den Vorfall fangen,
// fuer den er gebaut wurde. Ein Waechter ohne Gegenprobe belegt nur, dass er
// laeuft -- nicht, dass er etwas findet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractBrowserWrites, compare, parseGrantRows } from '../../scripts/verify-browser-column-grants.mjs';

const grantsOf = (spec) => new Map(Object.entries(spec));
const ALL = { UPDATE: true, INSERT: true };
const NONE = { UPDATE: false, INSERT: false };

test('Gegenprobe: der callback_requested-Fall wird gefangen', () => {
  // Wortlaut aus customer-dashboard/index.html:19634, saveFollowUpV2().
  const source = `
    sb.from('calls')
      .update({ callback_requested: false })
      .eq('id', callId)
      .then(function(rr) {});
  `;
  const writes = extractBrowserWrites(source);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].columns, ['callback_requested']);

  // Rechtelage zwischen PR #847 (2026-08-08) und der Allowlist-Migration
  // (2026-08-11 19:47) -- und noch einmal in den 27 Minuten danach.
  const results = compare(writes, grantsOf({
    'calls.callback_requested': NONE,
    'calls.read_at': ALL
  }));

  const fail = results.find(r => r.status === 'FAIL');
  assert.ok(fail, 'ohne das Recht muss ein FAIL entstehen');
  assert.equal(fail.name, 'calls.callback_requested');
  assert.match(fail.detail, /403/);
});

test('mit dem Recht ist derselbe Code gruen', () => {
  const source = `sb.from('calls').update({ callback_requested: false }).eq('id', callId);`;
  const results = compare(extractBrowserWrites(source), grantsOf({ 'calls.callback_requested': ALL }));
  assert.equal(results.filter(r => r.status === 'FAIL').length, 0);
  assert.equal(results.filter(r => r.status === 'PASS').length, 1);
});

test('Tabellenkonstanten werden aufgeloest', () => {
  const source = `
    const CALLS_TABLE = 'calls';
    var res = await sb.from(CALLS_TABLE).update(fields).eq('id', recordId);
  `;
  const writes = extractBrowserWrites(source);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, 'calls');
});

test('variables Objekt ist SKIP, nicht PASS', () => {
  const source = `
    const CALLS_TABLE = 'calls';
    sb.from(CALLS_TABLE).update(fields).eq('id', id);
  `;
  const writes = extractBrowserWrites(source);
  assert.equal(writes[0].columns, null);
  const results = compare(writes, grantsOf({}));
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'SKIP');
  assert.match(results[0].detail, /variablem Objekt/);
});

test('nur Schluessel der obersten Ebene zaehlen als Spalten', () => {
  const source = `sb.from('customers').update({ in_app_notification_settings: { mail: true }, updated_at: now }).eq('id', x);`;
  const [write] = extractBrowserWrites(source);
  assert.deepEqual(write.columns, ['in_app_notification_settings', 'updated_at']);
  assert.ok(!write.columns.includes('mail'), 'verschachtelte Schluessel sind keine Spalten');
});

test('Strings mit Klammern brechen die Spaltenliste nicht ab', () => {
  const source = `sb.from('calls').update({ notes_customer_voxera: 'a } b', updated_at: t }).eq('id', x);`;
  const [write] = extractBrowserWrites(source);
  assert.deepEqual(write.columns, ['notes_customer_voxera', 'updated_at']);
});

test('insert wird als INSERT geprueft, nicht als UPDATE', () => {
  const source = `sb.from('customer_tasks').insert([taskData]).then(function(r) {});`;
  const [write] = extractBrowserWrites(source);
  assert.equal(write.operation, 'INSERT');
  // Objekt in einer Variablen -> Spalten unbekannt -> SKIP, kein falsches Gruen.
  assert.equal(write.columns, null);
});

test('insert mit Literal prueft das INSERT-Recht getrennt vom UPDATE-Recht', () => {
  const source = `sb.from('customer_tasks').insert([{ title: t, type: 'callback' }]);`;
  const [write] = extractBrowserWrites(source);
  assert.deepEqual(write.columns, ['title', 'type']);
  const results = compare([write], grantsOf({
    'customer_tasks.title': { UPDATE: true, INSERT: false },
    'customer_tasks.type': ALL
  }));
  const fail = results.find(r => r.status === 'FAIL');
  assert.equal(fail.name, 'customer_tasks.title');
  assert.match(fail.detail, /INSERT/);
});

test('Recht ohne Schreibstelle ist SKIP, niemals FAIL', () => {
  // Die Umkehrung, die am 2026-08-11 zum falschen Rechte-Entzug gefuehrt hat.
  const source = `sb.from('calls').update({ read_at: t }).eq('id', x);`;
  const results = compare(extractBrowserWrites(source), grantsOf({
    'calls.read_at': ALL,
    'calls.callback_requested': ALL
  }));
  const orphan = results.find(r => r.name === 'calls.callback_requested');
  assert.equal(orphan.status, 'SKIP');
  assert.match(orphan.detail, /Ledger/);
  assert.equal(results.filter(r => r.status === 'FAIL').length, 0);
});

test('unbekannte Spalte ist SKIP, nicht FAIL', () => {
  const source = `sb.from('calls').update({ gibt_es_nicht: 1 }).eq('id', x);`;
  const results = compare(extractBrowserWrites(source), grantsOf({ 'calls.read_at': ALL }));
  assert.equal(results.find(r => r.name === 'calls.gibt_es_nicht').status, 'SKIP');
});

test('parseGrantRows liest die psql-Ausgabe', () => {
  const grants = parseGrantRows('calls\tread_at\tt\tf\ncalls\tcallback_requested\tf\tf\n\n');
  assert.deepEqual(grants.get('calls.read_at'), { UPDATE: true, INSERT: false });
  assert.deepEqual(grants.get('calls.callback_requested'), { UPDATE: false, INSERT: false });
});

test('am echten Dashboard: die bekannten Schreibstellen werden gefunden', async () => {
  const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const writes = extractBrowserWrites(source);

  assert.ok(writes.length >= 10, `zu wenige Schreibstellen erkannt: ${writes.length}`);

  const tables = new Set(writes.map(w => w.table));
  for (const t of ['calls', 'customers', 'notifications', 'customer_tasks']) {
    assert.ok(tables.has(t), `Tabelle ${t} nicht gefunden`);
  }

  // Die Stelle aus PR #847 -- der Grund fuer dieses Skript.
  const callback = writes.find(w => (w.columns || []).includes('callback_requested'));
  assert.ok(callback, 'saveFollowUpV2: callback_requested nicht gefunden');
  assert.equal(callback.table, 'calls');

  // Und die Stelle, die heute still fehlschlaegt (vxSaveProfil).
  const profil = writes.find(w => (w.columns || []).includes('contact_first_name'));
  assert.ok(profil, 'vxSaveProfil: contact_first_name nicht gefunden');
  assert.equal(profil.table, 'customers');
});
