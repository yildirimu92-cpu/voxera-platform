'use strict';

// updateChangeRequestStatus() / saveChangeRequestNote() / confirmApplyChange()
// (die "5. Save admin note"-Schreibstelle) riefen authClient.from(...).update(...)
// auf und lasen weder {error} noch pruefte, ob ueberhaupt eine Zeile
// betroffen war. Der Fehlerfall landete zwar in showToast('Fehler: ' +
// e.message) -- aber nur, weil ein synchroner Wurf innerhalb des try-Blocks
// dorthin fuehrte, nie weil das Ergebnis selbst geprueft wurde. Ein
// Supabase-{error}-Ergebnis oder eine durch RLS herausgefilterte Zeile waren
// also unsichtbar: "Status aktualisiert." / "Notiz gespeichert." erschien,
// obwohl nichts geschrieben wurde.
//
// Fix: ueber adminSbWrite() (shared/core/admin-supabase-write.js), das
// sowohl {error} als auch eine durch RLS auf 0 Zeilen gefilterte .select()-
// Rueckgabe prueft.
//
// Test fuehrt die echten drei Funktionen aus (herausgeschnitten), laedt das
// echte adminSbWrite() aus seiner eigenen Datei, und steuert das
// Supabase-Ergebnis der update()-Kette ueber ein Fake.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ADMIN_PATH = path.join(__dirname, '..', 'index.html');
const adminHtml = fs.readFileSync(ADMIN_PATH, 'utf8');
const ADMIN_SUPABASE_WRITE_PATH = path.join(__dirname, '..', 'shared', 'core', 'admin-supabase-write.js');
const adminSupabaseWriteSource = fs.readFileSync(ADMIN_SUPABASE_WRITE_PATH, 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  let start = adminHtml.indexOf(marker);
  assert.notEqual(start, -1, 'Funktion nicht gefunden: ' + name);
  if (adminHtml.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  let depth = 0;
  let seenBody = false;
  for (let i = adminHtml.indexOf('{', start); i < adminHtml.length; i++) {
    const ch = adminHtml[i];
    if (ch === '{') { depth++; seenBody = true; continue; }
    if (ch === '}') {
      depth--;
      if (seenBody && depth === 0) return adminHtml.slice(start, i + 1);
    }
  }
  throw new Error('Funktion nicht terminiert: ' + name);
}

// ai_change_requests.update(...).eq(...).select('id') wird ueber dieses
// Handle gesteuert: jeder Test setzt vorher, was die Kette liefern soll.
function freshSandbox(updateResult) {
  const toasts = [];
  const elements = {
    'admin-note-req-1': { value: 'eine Notiz' },
    'apply-result-req-1': { innerHTML: '' }
  };

  const sandbox = {
    console,
    document: { getElementById: (id) => elements[id] || null },
    showToast: (msg) => { toasts.push(msg); },
    esc: (v) => String(v == null ? '' : v),
    loadAiChangeRequests: () => {},
    loadAiChangesHistory: () => {},
    setTimeout: () => {},
    authClient: {
      from(table) {
        assert.equal(table, 'ai_change_requests');
        return {
          update() {
            return {
              eq() { return { select: async () => updateResult }; }
            };
          }
        };
      }
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    adminSupabaseWriteSource + '\n' +
    extractFunction('updateChangeRequestStatus') + '\n' +
    extractFunction('saveChangeRequestNote') + '\n',
    context
  );
  return { context, elements, toasts };
}

// updateChangeRequestStatus() faengt seinen eigenen Fehler seit dem
// Codex-Fund auf #975 nicht mehr ab: confirmApplyChange() wartet auf sie als
// Schritt 4 seines Auto-Apply-Flows, und ein verschluckter Fehler dort haette
// als Erfolg gegolten, obwohl der Request offen blieb. Sie muss also werfen,
// nicht selbst toasten -- der eigenstaendige <select onchange>-Aufruf faengt
// das an seiner eigenen Stelle ab (siehe Test weiter unten).
test('updateChangeRequestStatus(): ein {error}-Ergebnis wirft, statt es abzufangen', async () => {
  const { context } = freshSandbox({ error: { message: 'permission denied' } });

  await assert.rejects(
    vm.runInContext("updateChangeRequestStatus('req-1', 'done')", context),
    /permission denied/
  );
});

test('updateChangeRequestStatus(): eine RLS-gefilterte Zeile (error:null, leeres Array) wirft ebenfalls', async () => {
  const { context, toasts } = freshSandbox({ error: null, data: [] });

  await assert.rejects(
    vm.runInContext("updateChangeRequestStatus('req-1', 'done')", context),
    /Kein Datensatz betroffen/
  );
  assert.equal(toasts.length, 0, 'kein "Status aktualisiert."-Toast bei einem Fehlschlag');
});

test('<select onchange> faengt einen Fehlschlag an seiner eigenen Stelle ab', () => {
  assert.match(
    adminHtml,
    /onchange="updateChangeRequestStatus\('\$\{r\.id\}', this\.value\)\.catch\(e => showToast\('Fehler: ' \+ \(e\.message\|\|''\)\)\)"/,
    'die eigenstaendige Aufrufstelle muss die Promise selbst abfangen, seit updateChangeRequestStatus() nicht mehr intern faengt'
  );
});

test('updateChangeRequestStatus(): Erfolg zeigt "Status aktualisiert."', async () => {
  const { context, toasts } = freshSandbox({ error: null, data: [{ id: 'req-1' }] });

  await vm.runInContext("updateChangeRequestStatus('req-1', 'done')", context);

  assert.deepEqual(toasts, ['Status aktualisiert.']);
});

test('saveChangeRequestNote(): eine RLS-gefilterte Zeile zeigt "Fehler:", nicht "Notiz gespeichert."', async () => {
  const { context, toasts } = freshSandbox({ error: null, data: [] });

  await vm.runInContext("saveChangeRequestNote('req-1')", context);

  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /^Fehler:/);
});

test('saveChangeRequestNote(): Erfolg zeigt "Notiz gespeichert."', async () => {
  const { context, toasts } = freshSandbox({ error: null, data: [{ id: 'req-1' }] });

  await vm.runInContext("saveChangeRequestNote('req-1')", context);

  assert.deepEqual(toasts, ['Notiz gespeichert.']);
});

// confirmApplyChange() ist der komplexere Auto-Apply-Flow (Kundenpatch +
// ElevenLabs-Sync + Status + Notiz). Nur die Notiz-Schreibstelle (Schritt 5)
// ist Teil dieses Funds; die vorgelagerten Schritte werden gestubbt.
function freshApplySandbox(noteUpdateResult) {
  const toasts = [];
  const elements = {
    'apply-result-req-1': { innerHTML: '' }
  };

  const sandbox = {
    console,
    document: { getElementById: (id) => elements[id] || null },
    showToast: (msg) => { toasts.push(msg); },
    esc: (v) => String(v == null ? '' : v),
    setTimeout: () => {},
    loadAiChangeRequests: () => {},
    loadAiChangesHistory: () => {},
    customerById: () => ({ id: 'cust-1' }),
    callAdminFunction: async () => ({ success: true }),
    updateChangeRequestStatus: async () => {},
    window: { _pendingChanges: { 'req-1': { customerId: 'cust-1', changes: { contact_first_name: 'Neu' } } } },
    authClient: {
      from(table) {
        assert.equal(table, 'ai_change_requests');
        return {
          update() {
            return {
              eq() { return { select: async () => noteUpdateResult }; }
            };
          }
        };
      }
    }
  };
  sandbox.window.showToast = sandbox.showToast;
  const context = vm.createContext(sandbox);
  vm.runInContext(
    adminSupabaseWriteSource + '\n' +
    extractFunction('confirmApplyChange') + '\n',
    context
  );
  return { context, elements, toasts };
}

test('confirmApplyChange(): eine RLS-gefilterte Notiz-Zeile zeigt einen Fehler im Ergebnis-Panel, nicht den Erfolgstoast', async () => {
  const { context, elements, toasts } = freshApplySandbox({ error: null, data: [] });

  await vm.runInContext("confirmApplyChange('req-1', 'cust-1')", context);

  assert.match(elements['apply-result-req-1'].innerHTML, /Fehler/,
    'ohne die Laengenpruefung waere hier faelschlich der Erfolgsblock gerendert worden');
  assert.ok(!toasts.some((t) => /umgesetzt/.test(t)), 'kein Erfolgstoast bei einem Fehlschlag');
});

// Codex-Fund auf #975: solange updateChangeRequestStatus() intern faengt,
// sieht confirmApplyChange() dessen Fehlschlag nie -- der Request bliebe
// unbemerkt offen, waehrend die Oberflaeche "Änderungen übernommen" zeigt.
// Simuliert hier direkt eine werfende updateChangeRequestStatus() (Schritt 4),
// statt sie wie in den anderen Tests wegzustubben.
test('confirmApplyChange(): ein Fehlschlag von updateChangeRequestStatus() (Schritt 4) zeigt einen Fehler, nicht den Erfolgstoast', async () => {
  const toasts = [];
  const elements = { 'apply-result-req-1': { innerHTML: '' } };
  const sandbox = {
    console,
    document: { getElementById: (id) => elements[id] || null },
    showToast: (msg) => { toasts.push(msg); },
    esc: (v) => String(v == null ? '' : v),
    setTimeout: () => {},
    loadAiChangeRequests: () => {},
    loadAiChangesHistory: () => {},
    customerById: () => ({ id: 'cust-1' }),
    callAdminFunction: async () => ({ success: true }),
    updateChangeRequestStatus: async () => { throw new Error('permission denied'); },
    window: { _pendingChanges: { 'req-1': { customerId: 'cust-1', changes: { contact_first_name: 'Neu' } } } }
  };
  sandbox.window.showToast = sandbox.showToast;
  const context = vm.createContext(sandbox);
  vm.runInContext(extractFunction('confirmApplyChange'), context);

  await vm.runInContext("confirmApplyChange('req-1', 'cust-1')", context);

  assert.match(elements['apply-result-req-1'].innerHTML, /Fehler/,
    'ohne die Weitergabe waere hier faelschlich der Erfolgsblock gerendert worden, ' +
    'waehrend der Request-Status nie auf "done" gesetzt wurde');
  assert.ok(!toasts.some((t) => /umgesetzt/.test(t)), 'kein Erfolgstoast, wenn Schritt 4 fehlschlaegt');
});

test('confirmApplyChange(): Erfolg zeigt den Erfolgstoast', async () => {
  const { context, elements, toasts } = freshApplySandbox({ error: null, data: [{ id: 'req-1' }] });

  await vm.runInContext("confirmApplyChange('req-1', 'cust-1')", context);

  assert.match(elements['apply-result-req-1'].innerHTML, /Änderungen übernommen/);
  assert.ok(toasts.some((t) => /umgesetzt/.test(t)));
});
