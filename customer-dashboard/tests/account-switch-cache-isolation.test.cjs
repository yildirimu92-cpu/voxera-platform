'use strict';

/**
 * Kontowechsel im selben Tab darf keinen Rest von Konto A in Konto B's
 * erstem Bildschirm hinterlassen.
 *
 * Der Bug: resolveCustomerContext() cacht customerContext modulglobal und
 * gibt ihn ohne forceReload unveraendert zurueck. loadCustomerMeta() rief
 * resolveCustomerContext() bisher ohne forceReload auf -- und
 * vxHandleSignedOut() (der allgemeine SIGNED_OUT-Handler: Token-Ablauf,
 * serverseitig beendete Sitzung, fehlgeschlagener Auto-Refresh, nicht nur
 * der explizite "Abmelden"-Knopf) leerte customerContext nicht, im
 * Unterschied zu doLogout(). Meldete sich im selben Tab ein zweites Konto an,
 * bevor der naechste erzwungene Reload lief, rendert der erste Bildschirm
 * Konto A's Stammdaten (Name, E-Mail, Rechnungen, Vertrag, Stimmauswahl) in
 * Konto B's Sitzung.
 *
 * Zwei unabhaengige Absicherungen, beide hier belegt:
 *   1. resetPerAccountCaches() laeuft jetzt in vxHandleSignedOut() genauso
 *      wie in doLogout() -- der allgemeine Pfad raeumt nicht weniger auf als
 *      der explizite.
 *   2. loadCustomerMeta() reicht forceReload an resolveCustomerContext() und
 *      vxLoadCustomerDocuments() durch, und der Boot-Pfad (loadData(),
 *      showApp()) uebergibt es. Das ist die wichtigere Absicherung: sie
 *      schuetzt auch dann, wenn Absicherung 1 aus einem noch unbekannten
 *      SIGNED_OUT-Auslöser heraus einmal nicht greift.
 *
 * Die erste Haelfte fuehrt die echten Funktionen aus (herausgeschnitten,
 * nicht simuliert -- das Skript selbst laesst sich wegen DOM- und
 * Supabase-Abhaengigkeiten nicht laden). Die zweite Haelfte haelt die
 * Verdrahtung an den Aufrufstellen als Quelltext-Contract fest.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'index.html');
const dashboard = fs.readFileSync(DASHBOARD_PATH, 'utf8');

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

// ── Zwei Konten im selben Tab ───────────────────────────────────────────────

const ACCOUNT_A = {
  authUserId: 'auth-a',
  usersCustomerId: 'cust-a',
  customerId: 'cust-a',
  customerRecord: { id: 'cust-a', customer_name: 'Firma A AG', email: 'a@firma-a.example' }
};
const ACCOUNT_B = {
  authUserId: 'auth-b',
  usersCustomerId: 'cust-b',
  customerId: 'cust-b',
  customerRecord: { id: 'cust-b', customer_name: 'Firma B GmbH', email: 'b@firma-b.example' }
};

const FAKE_USERS_TABLE = {
  'auth-a': { id: 'auth-a', customer_id: 'cust-a' },
  'auth-b': { id: 'auth-b', customer_id: 'cust-b' }
};
const FAKE_CUSTOMERS_TABLE = {
  'cust-a': ACCOUNT_A.customerRecord,
  'cust-b': ACCOUNT_B.customerRecord
};

function fakeFrom(table) {
  let matchId = null;
  return {
    select() { return this; },
    eq(_col, val) { matchId = val; return this; },
    async maybeSingle() {
      const source = table === 'users' ? FAKE_USERS_TABLE : FAKE_CUSTOMERS_TABLE;
      return { data: (matchId != null && source[matchId]) || null, error: null };
    }
  };
}

// Konto A ist bereits geladen und zwischengespeichert; Konto B ist jetzt der
// tatsaechlich angemeldete Nutzer -- der Zustand direkt nach einem SIGNED_OUT
// (A) gefolgt von einem SIGNED_IN (B) im selben Tab.
function freshSandbox() {
  const sandbox = {
    console,
    customerContext: { ...ACCOUNT_A },
    customerDocumentsState: { loading: false, loaded: true, invoices: [{ id: 'inv-a' }], contract: { id: 'contract-a' }, error: null },
    window: {
      _vxAssistantVoicesLoaded: true,
      _vxAssistantVoicesLoading: false,
      _vxAssistantVoicesPromise: null,
      assistantVoiceOptions: [{ voice_id: 'voice-a' }],
      assistantSelectedVoiceId: 'voice-a'
    },
    currentUser: { id: 'auth-b' },
    CUSTOMERS_TABLE: 'customers',
    _sb: { from: fakeFrom },
    ensurePublicUserProvisioning: async () => {},
    vxDebugInfo: () => {},
    getCurrentSessionUser: async () => ({ id: 'auth-b' })
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    extractFunction('resetPerAccountCaches') + '\n' +
    extractFunction('resolveCustomerContext') + '\n',
    context
  );
  return context;
}

// ── 1. Der Cache-Mechanismus selbst, real ausgefuehrt ───────────────────────

test('resolveCustomerContext() ohne forceReload liefert bewusst den Cache (Kontrollfall)', async () => {
  const context = freshSandbox();
  const result = await vm.runInContext('resolveCustomerContext()', context);
  assert.equal(result.customerId, 'cust-a',
    'der Cache existiert absichtlich fuer Aufrufer, die ihn wollen -- das ist nicht der Fehler');
});

test('resolveCustomerContext(true) uebergeht den Cache und laedt Konto B frisch', async () => {
  const context = freshSandbox();
  const result = await vm.runInContext('resolveCustomerContext(true)', context);
  assert.equal(result.customerId, 'cust-b', 'forceReload muss den Cache umgehen');
  assert.equal(result.customerRecord.customer_name, 'Firma B GmbH');
});

test('resetPerAccountCaches() leert customerContext, Dokumente und Stimmen-Cache vollstaendig', async () => {
  // Feldweise statt deepEqual: Objekte aus dem vm-Kontext liegen in einem
  // anderen Realm und haben eine andere Object.prototype-Identitaet --
  // deepEqual auf den ganzen Objekten schlaegt darauf fehl, unabhaengig vom
  // tatsaechlichen Inhalt.
  const context = freshSandbox();
  vm.runInContext('resetPerAccountCaches()', context);
  assert.equal(context.customerContext.authUserId, null);
  assert.equal(context.customerContext.usersCustomerId, null);
  assert.equal(context.customerContext.customerId, null);
  assert.equal(context.customerContext.customerRecord, null);
  assert.equal(context.customerDocumentsState.loaded, false);
  assert.equal(context.customerDocumentsState.invoices.length, 0);
  assert.equal(context.customerDocumentsState.contract, null);
  assert.equal(context.window._vxAssistantVoicesLoaded, false);
  assert.equal(context.window.assistantVoiceOptions.length, 0);
  assert.equal(context.window.assistantSelectedVoiceId, null);
});

test('nach resetPerAccountCaches() liefert auch resolveCustomerContext() OHNE forceReload frische Daten', async () => {
  // Das ist die eigentliche Absicherung gegen die Vermischung: selbst ein
  // Aufrufer, der (wie loadCustomerMeta() vor diesem Fix) forceReload
  // vergisst, kann nach dem Reset kein Konto-A-Rest mehr bekommen, weil die
  // Cache-Bedingung selbst nicht mehr erfuellt ist.
  const context = freshSandbox();
  vm.runInContext('resetPerAccountCaches()', context);
  const result = await vm.runInContext('resolveCustomerContext()', context);
  assert.equal(result.customerId, 'cust-b',
    'ohne Reset waere das hier noch cust-a gewesen -- exakt der Fehler');
  assert.notEqual(result.customerRecord.customer_name, 'Firma A AG');
});

// ── 2. Verdrahtung an den Aufrufstellen, als Quelltext-Contract ─────────────

test('vxHandleSignedOut() raeumt genauso auf wie doLogout() -- ueber denselben Helfer', () => {
  const signedOut = extractFunction('vxHandleSignedOut');
  assert.match(signedOut, /resetPerAccountCaches\(\)/,
    'der allgemeine SIGNED_OUT-Pfad (Token-Ablauf, serverseitig beendet) muss denselben Reset laufen lassen wie das explizite Abmelden');

  const logout = extractFunction('doLogout');
  assert.match(logout, /resetPerAccountCaches\(\)/,
    'doLogout() darf nicht wieder eine eigene, davon abweichende Reset-Kopie fuehren');
  assert.doesNotMatch(logout,
    /customerContext = \{ authUserId: null, usersCustomerId: null, customerId: null, customerRecord: null \};/,
    'eine zweite, lokale Reset-Zeile in doLogout() waere genau die Divergenz, die den Fehler verursacht hat');
});

test('loadCustomerMeta() nimmt forceReload an und reicht es an beide kontospezifischen Caches durch', () => {
  const meta = extractFunction('loadCustomerMeta');
  assert.match(meta, /^async function loadCustomerMeta\(forceReload\)/,
    'die Signatur muss forceReload annehmen');
  assert.match(meta, /resolveCustomerContext\(forceReload\)/,
    'ohne Weitergabe cacht resolveCustomerContext() weiterhin kontouebergreifend');
  assert.match(meta, /vxLoadCustomerDocuments\(forceReload\)/,
    'sonst zeigt die Dokumentenliste (Rechnungen, Vertrag) weiterhin das vorherige Konto');
});

test('der Boot-Pfad erzwingt den Reload -- loadData() und showApp() rufen mit true auf', () => {
  assert.match(dashboard, /await loadCustomerMeta\(true\)\.catch\(\(\)=>\{\}\);/,
    'loadData() ist der eine Pfad, der bei jedem Kontowechsel garantiert durchlaeuft');
  assert.match(dashboard, /vxPreloadAssistantVoices\(true\)\.catch\(function\(\)\{\}\);/,
    'sonst zeigt die Stimmauswahl beim Booten weiterhin die zwischengespeicherte Liste des vorherigen Kontos');
});
