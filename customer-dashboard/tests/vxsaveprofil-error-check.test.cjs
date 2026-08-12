'use strict';

// vxSaveProfil() zeigte "Gespeichert ✓" und uebernahm den neuen Namen lokal,
// auch wenn _sb.from('customers').update(...) einen Fehler im Ergebnis
// zurueckgab -- Supabase meldet einen Schreibfehlschlag ueber {error} im
// aufgeloesten Ergebnis, nicht per Promise-Rejection, und der Aufruf las das
// Ergebnis gar nicht erst. Der Kunde sah also eine Erfolgsmeldung, waehrend
// der Name nicht geschrieben wurde -- und bemerkte es erst, wenn ihm etwas
// Falsches (der alte Name) wieder begegnete.
//
// Belegt: dasselbe Muster steht im selben File bereits korrekt behandelt
// (vxDv2SaveNote(), mit demselben erklaerenden Kommentar), also ein Versehen
// an dieser einen Stelle, keine Wissensluecke im Code.
//
// Test fuehrt die echte vxSaveProfil() aus (herausgeschnitten, echtes
// vxInlineSaveStatus() aus seiner eigenen Datei geladen, nicht simuliert) und
// steuert das Supabase-Ergebnis der update()-Kette ueber ein Fake.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'index.html');
const dashboard = fs.readFileSync(DASHBOARD_PATH, 'utf8');
const INLINE_SAVE_STATUS_PATH = path.join(
  __dirname, '..', 'shared', 'customer-runtime-inline-save-status.js'
);
const inlineSaveStatusSource = fs.readFileSync(INLINE_SAVE_STATUS_PATH, 'utf8');

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

function fakeElement(initial) {
  return Object.assign({
    dataset: {},
    disabled: false,
    setAttribute() {},
    removeAttribute() {}
  }, initial);
}

// customers.update(...).eq(...) wird ueber dieses Handle gesteuert: jeder
// Test setzt vorher, was die Kette liefern soll.
function freshSandbox(updateResult) {
  const elements = {
    'fb-profil-page': fakeElement({ textContent: '' }),
    'profil-save-btn': fakeElement({ textContent: 'Speichern' }),
    'profil-name-input': fakeElement({ value: 'Neuer Name' }),
    'profil-email-input': fakeElement({ value: 'kunde@firma-a.example' }),
    'profil-name-display': fakeElement({ textContent: '' }),
    'profil-email-display': fakeElement({ textContent: '' }),
    'profil-avatar-preview': fakeElement({ textContent: '' })
  };

  const customerMeta = { customerId: 'cust-a', customerEmail: 'kunde@firma-a.example', customerName: 'Alter Name' };

  const sandbox = {
    console,
    setTimeout,
    document: { getElementById: (id) => elements[id] || null },
    customerMeta,
    getSupabaseAuthClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: {} } }),
        updateUser: async () => ({ error: null })
      },
      from(table) {
        assert.equal(table, 'customers');
        return {
          update() {
            return {
              eq() {
                return { select: async () => updateResult };
              }
            };
          }
        };
      }
    })
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    inlineSaveStatusSource + '\n' +
    extractFunction('vxSetSettingsFeedback') + '\n' +
    extractFunction('vxSaveProfil') + '\n',
    context
  );
  return { context, elements, customerMeta };
}

test('vxSaveProfil(): ein Schreibfehlschlag zeigt keinen Erfolg und uebernimmt den Namen nicht lokal', async () => {
  const { context, elements, customerMeta } = freshSandbox({ error: { message: 'permission denied' } });

  await vm.runInContext('vxSaveProfil()', context);

  assert.equal(customerMeta.customerName, 'Alter Name',
    'ohne die Pruefung waere hier bereits "Neuer Name" uebernommen worden -- exakt der Fehler');
  assert.equal(elements['profil-name-display'].textContent, '',
    'die Anzeige darf den neuen Namen nicht zeigen, wenn der Schreibvorgang fehlschlug');
  assert.match(elements['fb-profil-page'].textContent, /nicht gespeichert/,
    'der Kunde muss eine Fehlermeldung sehen statt stillschweigend nichts');
  assert.equal(elements['fb-profil-page'].dataset.state, 'error');
});

// Codex-Fund auf #971: customers_customer_update_own kann die Zeile filtern
// (z.B. Berechtigung laeuft waehrend offenem Dashboard ab), ohne dass
// PostgREST das als Fehler meldet -- error: null, aber keine betroffene
// Zeile. Ohne .select() zurueckzulesen und die leere Antwort zu pruefen,
// waere das vom echten Erfolg nicht zu unterscheiden.
test('vxSaveProfil(): eine durch RLS gefilterte Zeile (error:null, keine Zeile) zeigt keinen Erfolg', async () => {
  const { context, elements, customerMeta } = freshSandbox({ error: null, data: [] });

  await vm.runInContext('vxSaveProfil()', context);

  assert.equal(customerMeta.customerName, 'Alter Name',
    'PostgREST meldet error:null bei 0 betroffenen Zeilen -- ohne Laengenpruefung waere das ein falscher Erfolg');
  assert.equal(elements['profil-name-display'].textContent, '');
  assert.match(elements['fb-profil-page'].textContent, /nicht gespeichert/);
  assert.equal(elements['fb-profil-page'].dataset.state, 'error');
});

test('vxSaveProfil(): ein erfolgreicher Schreibvorgang uebernimmt den Namen wie zuvor', async () => {
  const { context, elements, customerMeta } = freshSandbox({ error: null, data: [{ id: 'cust-a' }] });

  await vm.runInContext('vxSaveProfil()', context);

  assert.equal(customerMeta.customerName, 'Neuer Name');
  assert.equal(elements['profil-name-display'].textContent, 'Neuer Name');
  assert.equal(elements['fb-profil-page'].textContent, '');
  assert.equal(elements['fb-profil-page'].dataset.state, undefined);
});
