import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BEKANNTE_STELLEN,
  pruefeStelle,
  klassifiziereRohbefund,
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
// Gegenprobe-Block oben getrennt: er dokumentiert den *aktuellen* Ausgangs-
// zustand (6 offene Stellen) und muss ueberarbeitet werden, sobald die sechs
// Fixes (naechste Runde, eigenes Go) gelandet sind -- dann wird aus FAIL PASS.

test('Live-Smoke-Test: das Skript laeuft heute mit exit 1 (6 bekannte offene Stellen)', () => {
  let exitCode = 0;
  let ausgabe = '';
  try {
    ausgabe = execFileSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    exitCode = e.status;
    ausgabe = (e.stdout || '') + (e.stderr || '');
  }
  assert.equal(exitCode, 1, 'Stand heute: sechs Stellen sind noch nicht auf die Helfer umgestellt.');
  assert.match(ausgabe, /FAIL: 6 Pruefung\(en\) fehlgeschlagen\./);
  assert.doesNotMatch(ausgabe, /^PASS/m, 'ein FAIL darf niemals gleichzeitig als PASS gedruckt werden');
});
