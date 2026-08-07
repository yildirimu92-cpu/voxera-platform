'use strict';

/**
 * Regression test: "Nur ungelesene" darf nur vom tatsächlichen Öffnen abhängen.
 *
 * Der Bug: neben `read_at` (DB, gesetzt von vxMarkCallAsRead() beim Öffnen der
 * Detailansicht) existiert ein zweites Gelesen-System — das Seen-Set im
 * localStorage (`voxera_seen_calls_<customerId>`). Befüllt wird es von
 * markVisibleCallsAsSeen(), sobald der Anfragen-Tab betreten wird, ohne dass
 * irgendein Eintrag geöffnet wurde. vxIsUnreadRecord() fragte dieses Set
 * zusätzlich ab und wertete jeden Treffer als gelesen. Folge: ein einziger
 * Klick auf "Anfragen" liess den Filter "Nur ungelesene" dauerhaft leer laufen
 * — und, weil dieselbe Funktion die Sidebar-Badge speist, auch diese auf 0
 * fallen. Persistiert im localStorage, überlebt Reload.
 *
 * Diese Tests fixieren beide Seiten der Trennung:
 *   1. read_at ist die alleinige Quelle für "gelesen" (Verhaltenstest gegen
 *      die zur Laufzeit aktive Fassung von vxIsUnreadRecord).
 *   2. Das Seen-Set bleibt bestehen und wird weiterhin befüllt — es darf nur
 *      den Lesestatus nicht mehr beeinflussen (Quelltext-Contract).
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractScriptBlock(id) {
  const open = dashboard.indexOf('<script id="' + id + '">');
  assert.notEqual(open, -1, 'script block not found: ' + id);
  const bodyStart = dashboard.indexOf('>', open) + 1;
  const end = dashboard.indexOf('</script>', bodyStart);
  assert.notEqual(end, -1, 'unterminated script block: ' + id);
  return dashboard.slice(bodyStart, end);
}

// Die zur Laufzeit gewinnende Fassung von vxIsUnreadRecord lebt in diesem
// Block; die frühere Funktionsdeklaration weiter oben wird davon überschrieben.
const UNREAD_BLOCK = 'vx-pr-i2-unread-source-of-truth-2026-05-23';

function loadUnreadModule({ seenIds = [], records = [] } = {}) {
  const badge = { textContent: '', style: { display: 'none' } };
  const sandbox = {
    console,
    setTimeout,
    document: {
      readyState: 'complete',
      addEventListener() {},
      getElementById(id) { return id === 'badge-anrufe' ? badge : null; }
    }
  };
  sandbox.window = sandbox;
  sandbox.allRecords = records;
  sandbox.allManualTaskRecords = [];
  // Das Seen-Set wird bewusst NICHT wegstubbt: der Test soll beweisen, dass
  // ein gefülltes Set den Lesestatus nicht mehr kippt.
  sandbox.getSeenCallIdsFromStorage = () => new Set(seenIds.map(String));
  sandbox.isManualTaskRecord = (r) => String((r && r.type) || '').includes('task');
  sandbox.vxIsCallInLivePhase = (r) =>
    ['incoming', 'ringing', 'active', 'live'].includes(
      String(((r && r.fields) || {}).live_status || '').toLowerCase()
    );

  vm.createContext(sandbox);
  new vm.Script(extractScriptBlock(UNREAD_BLOCK), { filename: UNREAD_BLOCK }).runInContext(sandbox);
  return { window: sandbox, badge };
}

const openUnread = { id: 'u1', fields: { dashboard_status: 'new', read_at: null } };
const openRead = { id: 'r1', fields: { dashboard_status: 'new', read_at: '2026-08-07T09:05:00Z' } };

test('read_at null = ungelesen, wenn das Seen-Set leer ist', () => {
  const { window } = loadUnreadModule({ seenIds: [] });
  assert.equal(window.vxIsUnreadRecord(openUnread), true);
});

test('read_at gesetzt = gelesen', () => {
  const { window } = loadUnreadModule({ seenIds: [] });
  assert.equal(window.vxIsUnreadRecord(openRead), false);
});

test('REGRESSION: ein gefülltes Seen-Set macht einen Eintrag NICHT gelesen', () => {
  // Genau dieser Fall trat nach jedem Betreten des Anfragen-Tabs ein.
  const { window } = loadUnreadModule({ seenIds: ['u1'] });
  assert.equal(
    window.vxIsUnreadRecord(openUnread), true,
    'Seen-Set aus dem localStorage darf den Lesestatus nicht mehr überschreiben'
  );
});

test('REGRESSION: Sidebar-Badge zählt nach read_at, nicht nach dem Seen-Set', () => {
  const records = [
    openUnread,
    { id: 'u2', fields: { dashboard_status: 'new', read_at: null } },
    openRead
  ];
  const { window, badge } = loadUnreadModule({ seenIds: ['u1', 'u2', 'r1'], records });
  window.vxUpdateAnfragenNavBadges();
  assert.equal(badge.textContent, '2', 'zwei Einträge ohne read_at müssen zählen');
  assert.notEqual(badge.style.display, 'none');
});

test('erledigte und archivierte Einträge zählen nie als ungelesen', () => {
  const { window } = loadUnreadModule({ seenIds: [] });
  assert.equal(window.vxIsUnreadRecord({ id: 'd1', fields: { dashboard_status: 'closed', read_at: null } }), false);
  assert.equal(window.vxIsUnreadRecord({ id: 'a1', fields: { archived_at: '2026-08-07T00:00:00Z', read_at: null } }), false);
});

test('Anrufe in der Live-Phase zählen nie als ungelesen', () => {
  const { window } = loadUnreadModule({ seenIds: [] });
  assert.equal(
    window.vxIsUnreadRecord({ id: 'l1', fields: { dashboard_status: 'new', live_status: 'active', read_at: null } }),
    false
  );
});

test('fehlende read_at-Spalte gilt nicht automatisch als ungelesen', () => {
  const { window } = loadUnreadModule({ seenIds: [] });
  assert.equal(window.vxIsUnreadRecord({ id: 'legacy', fields: { dashboard_status: 'new' } }), false);
});

// ── Quelltext-Contract ──────────────────────────────────────────────────────

test('keine der beiden vxIsUnreadRecord-Fassungen fragt das Seen-Set ab', () => {
  const marker = 'getSeenCallIdsFromStorage';
  const bodies = [];

  const patched = extractScriptBlock(UNREAD_BLOCK);
  const activeStart = patched.indexOf('window.vxIsUnreadRecord = function');
  assert.notEqual(activeStart, -1, 'aktive Fassung nicht gefunden');
  bodies.push(patched.slice(activeStart, patched.indexOf('\n  };', activeStart)));

  const legacyStart = dashboard.indexOf('function vxIsUnreadRecord(');
  assert.notEqual(legacyStart, -1, 'Fallback-Fassung nicht gefunden');
  bodies.push(dashboard.slice(legacyStart, dashboard.indexOf('\n}', legacyStart)));

  // Kommentare dürfen den Helfer benennen — hier steht die Begründung, warum
  // er nicht mehr aufgerufen wird. Geprüft wird nur ausführbarer Code.
  const stripComments = (src) => src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  bodies.forEach((body, i) => {
    assert.ok(
      !stripComments(body).includes(marker),
      'vxIsUnreadRecord (' + (i === 0 ? 'aktiv' : 'Fallback') + ') fragt wieder das Seen-Set ab — ' +
      'damit markiert schon das Betreten des Anfragen-Tabs alles als gelesen'
    );
  });
});

test('das Seen-Set bleibt für die Badge-Semantik erhalten', () => {
  // Bewusst NICHT mitentfernt: "neu seit dem letzten Blick" ist dort gewollt.
  // Ob es zwei Gelesen-Systeme geben soll, ist eine offene Produktfrage.
  assert.ok(dashboard.includes('function markVisibleCallsAsSeen(records)'), 'Seen-Set-Writer fehlt');
  assert.ok(dashboard.includes('function getSeenCallIdsFromStorage()'), 'Seen-Set-Reader fehlt');
  assert.match(dashboard, /markVisibleCallsAsSeen\(\(allRecords \|\| \[\]\)/);
});

test('read_at wird ausschliesslich beim Öffnen gesetzt', () => {
  const calls = dashboard.match(/vxMarkCallAsRead\(/g) || [];
  // eine Definition + die Aufrufe in den Detail-Öffnungspfaden
  assert.ok(calls.length >= 2, 'vxMarkCallAsRead nicht gefunden');
  assert.ok(
    !/function renderAnrufeInbox[\s\S]{0,4000}?vxMarkCallAsRead\(/.test(dashboard),
    'die Listen-Renderfunktion darf read_at nicht setzen'
  );
});
