import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BEKANNTE_STELLEN,
  BASISLINIE_NICHT_KONFORM,
  pruefeStelle,
  klassifiziereRohbefund,
  klassifiziereRestschuld,
  pruefeBegruendung,
  zaehleSchreibstellen
} from './verify-supabase-write-error-check.mjs';

const SCRIPT = fileURLToPath(new URL('./verify-supabase-write-error-check.mjs', import.meta.url));
const ROOT = join(dirname(SCRIPT), '..');

function stelle(funktion) {
  const gefunden = BEKANNTE_STELLEN.find((s) => s.funktion === funktion);
  assert.ok(gefunden, `Registry-Eintrag fehlt: ${funktion}`);
  return gefunden;
}

// ── Gegenprobe: die sechs am 2026-08-11 real gefundenen, noch offenen Stellen.
// Fixtures sind eingefroren (nicht aus der Live-Datei gelesen) -- der Test
// bleibt aussagekraeftig, auch nachdem diese sechs Stellen gefixt wurden.
// Zeigt der Detektor sie als konform, misst er am Gegenstand vorbei.

test('Gegenprobe: vxNotifMarkRead (Stand 2026-08-11, kein Helfer) wird als nicht konform erkannt', () => {
  const fixture = `
async function vxNotifMarkRead(id) {
  _vxNotifCache.forEach(function(n){ if (n.id === id) n.read = true; });
  vxBellUpdateBadge();
  var sb = (typeof getSupabaseAuthClient === 'function') ? getSupabaseAuthClient() : null;
  if (!sb) return;
  try {
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  } catch(e) { console.warn('[vxNotif] markRead error', e); }
}`;
  const ergebnis = pruefeStelle(fixture, stelle('vxNotifMarkRead'));
  assert.equal(ergebnis.ok, false, 'kein vxSbWrite() im Quelltext -- muss als nicht konform gelten');
});

test('Gegenprobe: vxNotifPersistReadIds (Stand 2026-08-11, kein Helfer) wird als nicht konform erkannt', () => {
  const fixture = `
async function vxNotifPersistReadIds(ids) {
  ids = (ids || []).filter(Boolean);
  if (!ids.length) return;
  var sb = (typeof getSupabaseAuthClient === 'function') ? getSupabaseAuthClient() : null;
  if (!sb) return;
  try {
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
  } catch(e) { console.warn('[vxNotif] persist read error', e); }
}`;
  const ergebnis = pruefeStelle(fixture, stelle('vxNotifPersistReadIds'));
  assert.equal(ergebnis.ok, false);
});

test('Gegenprobe: vxNotifMarkAllRead (Stand 2026-08-11, kein Helfer) wird als nicht konform erkannt', () => {
  const fixture = `
async function vxNotifMarkAllRead() {
  var unread = _vxNotifCache.filter(function(n){ return !n.read; });
  if (!unread.length) return;
  unread.forEach(function(n){ n.read = true; });
  vxBellUpdateBadge();
  var sb = (typeof getSupabaseAuthClient === 'function') ? getSupabaseAuthClient() : null;
  if (!sb) return;
  try {
    var ids = unread.map(function(n){ return n.id; });
    await sb.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids);
  } catch(e) { console.warn('[vxNotif] markAllRead error', e); }
}`;
  const ergebnis = pruefeStelle(fixture, stelle('vxNotifMarkAllRead'));
  assert.equal(ergebnis.ok, false);
});

test('Gegenprobe: updateChangeRequestStatus (Stand 2026-08-11, kein Helfer) wird als nicht konform erkannt', () => {
  const fixture = `
async function updateChangeRequestStatus(id, status) {
  try {
    await authClient.from('ai_change_requests').update({
      status,
      updated_at: new Date().toISOString()
    }).eq('id', id);
    showToast('Status aktualisiert.');
    loadAiChangeRequests();
  } catch(e) {
    showToast('Fehler: ' + (e.message||''));
  }
}`;
  const ergebnis = pruefeStelle(fixture, stelle('updateChangeRequestStatus'));
  assert.equal(ergebnis.ok, false);
});

test('Gegenprobe: saveChangeRequestNote (Stand 2026-08-11, kein Helfer) wird als nicht konform erkannt', () => {
  const fixture = `
async function saveChangeRequestNote(id) {
  const note = document.getElementById('admin-note-' + id)?.value.trim() || '';
  try {
    await authClient.from('ai_change_requests').update({
      admin_notes: note || null,
      updated_at: new Date().toISOString()
    }).eq('id', id);
    showToast('Notiz gespeichert.');
  } catch(e) {
    showToast('Fehler: ' + (e.message||''));
  }
}`;
  const ergebnis = pruefeStelle(fixture, stelle('saveChangeRequestNote'));
  assert.equal(ergebnis.ok, false);
});

test('Gegenprobe: Auto-Apply-Flow admin_notes (Stand 2026-08-11, kein Helfer) wird als nicht konform erkannt', () => {
  const fixture = `
    // 4. Mark request as done
    await updateChangeRequestStatus(requestId, 'done');

    // 5. Save admin note
    await authClient.from('ai_change_requests')
      .update({ admin_notes: 'Automatisch umgesetzt via AI', updated_at: new Date().toISOString() })
      .eq('id', requestId);
`;
  const ergebnis = pruefeStelle(fixture, stelle('Auto-Apply-Flow (admin_notes)'));
  assert.equal(ergebnis.ok, false);
});

// ── Positivkontrolle Codex-P2-Fund: eine Stelle mit einer Konstante statt
// eines String-Literals als Tabellenname (sb.from(CALLS_TABLE)) muss erkannt
// werden -- die urspruengliche Fassung von SCHREIBMUSTER (nur Literale) haette
// sie unsichtbar gelassen, und eine ungeprueft gebliebene neue Konstanten-
// Schreibstelle waere nie als Waise aufgefallen.

// Bis 2026-08-12 haftete dieser Test an vxBestEffortPatchCallLifecycle. Die
// Stelle ist entfallen (Lifecycle-Zeitstempel jetzt serverseitig in
// call-update-status), der Test wandert deshalb auf die zweite Stelle
// derselben Bauform: sb.from(CASES_TABLE) in vxBestEffortPatchTaskLifecycle.
// Ersatzlos streichen waere falsch -- geprueft wird hier die FAEHIGKEIT, eine
// Konstante als Tabellennamen zu erkennen, nicht eine bestimmte Funktion.
test('Positivkontrolle: sb.from(KONSTANTE) wird als Schreibstelle erkannt (Codex-P2-Fund)', () => {
  const fixture = `
async function vxBestEffortPatchTaskLifecycle(recordId, fields) {
  if (!recordId || !fields || typeof fields !== 'object') return null;
  try {
    var sb = (typeof getSupabaseAuthClient === 'function') ? getSupabaseAuthClient() : _sb;
    if (!sb || !CASES_TABLE) return null;
    var res = await sb.from(CASES_TABLE).update(fields).eq('id', entityId).select('*').maybeSingle();
    if (res && res.error) throw res.error;
  } catch(e) {}
}`;
  assert.equal(zaehleSchreibstellen(fixture), 1, 'sb.from(CASES_TABLE) ist eine echte Schreibstelle, auch ohne String-Literal');
  const ergebnis = pruefeStelle(fixture, stelle('vxBestEffortPatchTaskLifecycle'));
  assert.equal(ergebnis.ok, true);
});

test('Positivkontrolle: Array.from(x) gefolgt von einem unabhaengigen .delete() an anderer Stelle zaehlt nicht mit', () => {
  // Realer Fund waehrend des Baus dieses Wächters: Array.from(window.vxScrollLocks
  // || []) in vxDebugLog(...), gefolgt (im selben 250-Zeichen-Fenster, aber
  // hinter einem Semikolon und Funktionsende) von window.vxScrollLocks.delete(...)
  // in einer voelling anderen Funktion. Ohne die Semikolon-Grenze im Fenster
  // haette das als Supabase-Schreibzugriff gezaehlt.
  const fixture = `
function vxLogScrollLockState(locked) {
  vxDebugLog('[scroll-lock] apply', locked, Array.from(window.vxScrollLocks || []));
}

function vxSetScrollLock(reason, locked) {
  if (!window.vxScrollLocks) window.vxScrollLocks = new Set();
  if (locked) window.vxScrollLocks.add(String(reason));
  else window.vxScrollLocks.delete(String(reason));
}`;
  assert.equal(zaehleSchreibstellen(fixture), 0, 'Array.from(...) ist kein Supabase-Schreibzugriff');
});

// ── Positivkontrolle: der Detektor darf nicht einfach immer "nicht konform"
// melden. Ein bereits korrektes Muster (vxDv2SaveNote, frei nacherzaehlt) und
// ein hypothetischer vxSbWrite()-Aufruf muessen als konform durchgehen.

test('Positivkontrolle: eine bereits korrekte {error}-Pruefung wird als konform erkannt', () => {
  const fixture = `
  window.vxDv2SaveNote = function() {
    var recId = String(window._vxCurrentCallId || '').trim();
    window.vxInlineSaveStatus(btn, function() {
      return sb.from('calls').update({ notes_customer_voxera: noteText }).eq('id', recId)
        .then(function(result) {
          if (result && result.error) throw new Error(result.error.message || 'x');
        });
    });
  };`;
  const ergebnis = pruefeStelle(fixture, stelle('vxDv2SaveNote'));
  assert.equal(ergebnis.ok, true);
});

test('Positivkontrolle: ein mit vxSbWrite() umwickelter Aufruf wird als konform erkannt', () => {
  const fixture = `
async function vxNotifMarkRead(id) {
  _vxNotifCache.forEach(function(n){ if (n.id === id) n.read = true; });
  var sb = getSupabaseAuthClient();
  try {
    await vxSbWrite(sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id));
  } catch(e) { console.warn('[vxNotif] markRead error', e); }
}`;
  const ergebnis = pruefeStelle(fixture, stelle('vxNotifMarkRead'));
  assert.equal(ergebnis.ok, true);
});

test('Anker-Eindeutigkeit: fehlt der Anker, meldet pruefeStelle das statt zu raten', () => {
  const ergebnis = pruefeStelle('kein passender Text hier', stelle('vxDv2SaveNote'));
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.grund, 'anker_fehlt');
});

test('Anker-Eindeutigkeit: kommt der Anker doppelt vor, meldet pruefeStelle das statt zu raten', () => {
  const doppelt = 'window.vxDv2SaveNote = function() {}; window.vxDv2SaveNote = function() {};';
  const ergebnis = pruefeStelle(doppelt, stelle('vxDv2SaveNote'));
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.grund, 'anker_mehrdeutig');
});

// ── Dreiwertigkeit: kein Vakuum-Pass.

test('klassifiziereRohbefund: null Treffer ist SKIP, nicht OK', () => {
  assert.equal(klassifiziereRohbefund(0, 4), 'skip');
  assert.equal(klassifiziereRohbefund(0, 0), 'skip');
});

test('klassifiziereRohbefund: abweichende Zaehlung ist FAIL', () => {
  assert.equal(klassifiziereRohbefund(5, 4), 'fail');
  assert.equal(klassifiziereRohbefund(3, 4), 'fail');
});

test('klassifiziereRohbefund: uebereinstimmende Zaehlung ist OK', () => {
  assert.equal(klassifiziereRohbefund(4, 4), 'ok');
});

test('zaehleSchreibstellen findet mehrere Stellen unabhaengig von Zeilenumbruechen', () => {
  const fixture = `
    a.from('notifications').update({x:1}).eq('id', 1);
    b.from('calls')
      .update({y:2})
      .eq('id', 2);
    c.from('x').select('*');
  `;
  assert.equal(zaehleSchreibstellen(fixture), 2, 'select() darf nicht als Schreibstelle zaehlen');
});

// ── Ratsche statt Dauerrot (Codex-P1-Fund auf PR #973): bekannte Restschuld
// darf sich nur mit nachgezogener Basislinie bewegen, sonst waere jeder
// zukuenftige, thematisch unabhaengige Pull Request bis zum Sechs-Fixes-Schritt
// permanent rot -- ein Dauerrot, das niemand mehr liest.

test('klassifiziereRestschuld: unveraendert gegenueber der Basislinie ist OK', () => {
  assert.equal(klassifiziereRestschuld(6, 6), 'ok');
});

test('klassifiziereRestschuld: mehr Restschuld als die Basislinie ist eine Regression', () => {
  assert.equal(klassifiziereRestschuld(7, 6), 'regression');
});

test('klassifiziereRestschuld: weniger Restschuld als die Basislinie heisst "Basislinie nachziehen"', () => {
  assert.equal(klassifiziereRestschuld(3, 6), 'unaktualisiert');
});

test('BASISLINIE_NICHT_KONFORM entspricht der heutigen, echten Restschuld (0 -- alle sechs Stellen gefixt)', () => {
  // Kein Live-Scan der Dateien -- nur die Konstante selbst gegen den in
  // diesem Test-File dokumentierten, vom Betreiber bestaetigten Stand.
  assert.equal(BASISLINIE_NICHT_KONFORM, 0);
});

// ── Ausnahme-Begruendung: ein Platzhalter darf nicht durchgehen.

test('pruefeBegruendung lehnt leere und vertroestende Begruendungen ab', () => {
  assert.ok(pruefeBegruendung({ datei: 'x', grund: '' }));
  assert.ok(pruefeBegruendung({ datei: 'x', grund: 'spaeter' }));
  assert.ok(pruefeBegruendung({ datei: 'x', grund: 'TODO' }));
  assert.ok(pruefeBegruendung({ datei: 'x', grund: 'kümmern wir uns' }));
});

test('pruefeBegruendung akzeptiert eine tatsaechliche Begruendung', () => {
  assert.equal(
    pruefeBegruendung({
      datei: 'x',
      grund: 'Reine Pruefabfrage in einer Verifikations-Migration, rollt sich selbst zurueck.'
    }),
    null
  );
});

// ── Registry-Vollstaendigkeit gegen den echten Rohbefund (heutiger Stand).
// Dieser Block prueft die Live-Dateien und ist absichtlich vom eingefrorenen
// Gegenprobe-Block oben getrennt: er dokumentiert den *aktuellen* Zustand
// (19 Stellen, alle konform, Restschuld = 0) nach den sechs Einzelfixes.

test('Live-Smoke-Test: das Skript laeuft heute PASS (19 Stellen, Restschuld = 0)', () => {
  let exitCode = 0;
  let ausgabe = '';
  try {
    ausgabe = execFileSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    exitCode = e.status;
    ausgabe = (e.stdout || '') + (e.stderr || '');
  }
  assert.equal(exitCode, 0, 'Stand heute: alle sechs zuvor offenen Stellen sind gefixt -- PASS.');
  assert.match(ausgabe, /PASS: keine unbekannten Stellen, kein Vakuum, Restschuld = Basislinie \(0\)\./);
  assert.match(ausgabe, /0 bekannte Stelle\(n\) ohne Helfer\/Pruefung -- unveraendert gegenueber der Basislinie\./,
    'die Restschuld-Zeile muss weiterhin im Log stehen, auch bei 0');
});
