'use strict';

// vxNotifMarkRead / vxNotifPersistReadIds / vxNotifMarkAllRead schrieben
// direkt ueber sb.from('notifications').update(...), ohne {error} zu pruefen
// und ohne .select() -- ein Fehlschlag (RLS, Netzwerk) blieb komplett
// unsichtbar: kein Fehlertext, keine Konsequenz ausser dem stillen
// console.warn. Der optimistisch markierte Cache-Eintrag blieb "gelesen",
// bis zum naechsten Reload dann wieder "ungelesen" -- ein Widerspruch ohne
// erkennbaren Grund fuer den Kunden.
//
// Fix: ueber vxSbWrite() (shared/customer-runtime-supabase-write.js), das
// sowohl {error} als auch eine durch RLS auf 0 Zeilen gefilterte .select()-
// Rueckgabe prueft. Bewusst kein Rollback der optimistischen Markierung
// (siehe Kommentar im Quelltext) -- aber ein kurzer, sichtbarer Hinweis ueber
// toast() muss bei Fehlschlag erscheinen.
//
// Test fuehrt die echten drei Funktionen aus (herausgeschnitten), laedt das
// echte vxSbWrite() aus seiner eigenen Datei, und steuert das
// Supabase-Ergebnis der update()-Kette ueber ein Fake.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'index.html');
const dashboard = fs.readFileSync(DASHBOARD_PATH, 'utf8');
const SUPABASE_WRITE_PATH = path.join(__dirname, '..', 'shared', 'customer-runtime-supabase-write.js');
const supabaseWriteSource = fs.readFileSync(SUPABASE_WRITE_PATH, 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  let start = dashboard.indexOf(marker);
  assert.notEqual(start, -1, 'Funktion nicht gefunden: ' + name);
  if (dashboard.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  let depth = 0;
  let seenBody = false;
  for (let i = dashboard.indexOf('{', start); i < dashboard.length; i++) {
    const ch = dashboard[i];
    if (ch === '{') { depth++; seenBody = true; continue; }
    if (ch === '}') {
      depth--;
      if (seenBody && depth === 0) return dashboard.slice(start, i + 1);
    }
  }
  throw new Error('Funktion nicht terminiert: ' + name);
}

// notifications.update(...).eq/in(...).select('id') wird ueber dieses Handle
// gesteuert: jeder Test setzt vorher, was die Kette liefern soll.
function freshSandbox(updateResult) {
  const toasts = [];
  const cache = [
    { id: 'n1', recId: 'rec-1', read: false },
    { id: 'n2', recId: 'rec-2', read: false }
  ];

  const sandbox = {
    console,
    _vxNotifCache: cache,
    vxBellUpdateBadge: () => {},
    vxBellRender: () => {},
    vxBellPageRender: () => {},
    toast: (msg, type) => { toasts.push({ msg, type }); },
    getSupabaseAuthClient: () => ({
      from(table) {
        assert.equal(table, 'notifications');
        return {
          update() {
            return {
              eq() { return { select: async () => updateResult }; },
              in() { return { select: async () => updateResult }; }
            };
          }
        };
      }
    })
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    supabaseWriteSource + '\n' +
    extractFunction('vxNotifMarkRead') + '\n' +
    extractFunction('vxNotifPersistReadIds') + '\n' +
    extractFunction('vxNotifMarkAllRead') + '\n',
    context
  );
  return { context, cache, toasts };
}

test('vxNotifMarkRead(): Fehlschlag zeigt einen Hinweis, Cache bleibt (kein Rollback)', async () => {
  const { context, cache, toasts } = freshSandbox({ error: { message: 'permission denied' } });

  await vm.runInContext("vxNotifMarkRead('n1')", context);

  assert.equal(cache[0].read, true, 'bewusst kein Rollback -- die optimistische Markierung bleibt stehen');
  assert.equal(toasts.length, 1, 'der Fehlschlag muss sichtbar werden');
  assert.equal(toasts[0].type, 'error');
  assert.match(toasts[0].msg, /nicht gespeichert/);
});

test('vxNotifMarkRead(): RLS-gefilterte Zeile (error:null, leeres Array) zeigt ebenfalls einen Hinweis', async () => {
  const { context, toasts } = freshSandbox({ error: null, data: [] });

  await vm.runInContext("vxNotifMarkRead('n1')", context);

  assert.equal(toasts.length, 1, 'vxSbWrite muss die leere Rueckgabe als Fehlschlag werten');
  assert.match(toasts[0].msg, /nicht gespeichert/);
});

test('vxNotifMarkRead(): Erfolg zeigt keinen Hinweis', async () => {
  const { context, toasts } = freshSandbox({ error: null, data: [{ id: 'n1' }] });

  await vm.runInContext("vxNotifMarkRead('n1')", context);

  assert.equal(toasts.length, 0);
});

test('vxNotifPersistReadIds(): Fehlschlag zeigt einen Hinweis', async () => {
  const { context, toasts } = freshSandbox({ error: { message: 'network' } });

  await vm.runInContext("vxNotifPersistReadIds(['n1', 'n2'])", context);

  assert.equal(toasts.length, 1);
  assert.match(toasts[0].msg, /nicht gespeichert/);
});

test('vxNotifPersistReadIds(): Erfolg zeigt keinen Hinweis', async () => {
  const { context, toasts } = freshSandbox({ error: null, data: [{ id: 'n1' }, { id: 'n2' }] });

  await vm.runInContext("vxNotifPersistReadIds(['n1', 'n2'])", context);

  assert.equal(toasts.length, 0);
});

test('vxNotifMarkAllRead(): Fehlschlag zeigt einen Hinweis, Cache bleibt (kein Rollback)', async () => {
  const { context, cache, toasts } = freshSandbox({ error: { message: 'permission denied' } });

  await vm.runInContext('vxNotifMarkAllRead()', context);

  assert.equal(cache[0].read, true);
  assert.equal(cache[1].read, true);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].msg, /nicht gespeichert/);
});

test('vxNotifMarkAllRead(): Erfolg zeigt keinen Hinweis', async () => {
  const { context, toasts } = freshSandbox({ error: null, data: [{ id: 'n1' }, { id: 'n2' }] });

  await vm.runInContext('vxNotifMarkAllRead()', context);

  assert.equal(toasts.length, 0);
});
