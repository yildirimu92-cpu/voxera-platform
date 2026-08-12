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

test('updateChangeRequestStatus(): ein {error}-Ergebnis zeigt "Fehler:", nicht "Status aktualisiert."', async () => {
  const { context, toasts } = freshSandbox({ error: { message: 'permission denied' } });

  await vm.runInContext("updateChangeRequestStatus('req-1', 'done')", context);

  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /^Fehler:/);
});

test('updateChangeRequestStatus(): eine RLS-gefilterte Zeile (error:null, leeres Array) zeigt ebenfalls "Fehler:"', async () => {
  const { context, toasts } = freshSandbox({ error: null, data: [] });

  await vm.runInContext("updateChangeRequestStatus('req-1', 'done')", context);

  assert.equal(toasts.length, 1, 'ohne die Laengenpruefung waere hier faelschlich "Status aktualisiert." erschienen');
  assert.match(toasts[0], /^Fehler:/);
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

test('confirmApplyChange(): Erfolg zeigt den Erfolgstoast', async () => {
  const { context, elements, toasts } = freshApplySandbox({ error: null, data: [{ id: 'req-1' }] });

  await vm.runInContext("confirmApplyChange('req-1', 'cust-1')", context);

  assert.match(elements['apply-result-req-1'].innerHTML, /Änderungen übernommen/);
  assert.ok(toasts.some((t) => /umgesetzt/.test(t)));
});
