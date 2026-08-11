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
 *
 * Dritte Ebene, aus der automatisierten Review auf PR #945 selbst: der Reset
 * allein schliesst nicht die Luecke, dass eine zum Reset-Zeitpunkt bereits
 * laufende Anfrage (Kundenkontext, Dokumente, Stimmen) DANACH noch fertig
 * wird und ihr Ergebnis unbedingt zurueckschreibt -- dann stuende Konto A's
 * Antwort wieder im gerade geleerten Cache. vxAccountGeneration schliesst
 * diese zweite Luecke: jede der vier betroffenen Funktionen merkt sich die
 * Generation bei Anfragebeginn und verwirft ihr Ergebnis, wenn sie beim
 * Abschluss nicht mehr aktuell ist. Ausserdem fehlte customerMeta selbst im
 * Reset (der Namens-Fallback in loadCustomerMeta() konnte Konto A's Namen an
 * Konto B weiterreichen), und der erzwungene Dokumenten-Reload lief zunaechst
 * bei jedem 12s-Polling-Tick statt nur einmal pro Konto.
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
    customerMeta: { customerId: 'cust-a', customerName: 'Firma A AG', plan: 'Business', contactFirstName: 'Anna' },
    vxAccountGeneration: 0,
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
    extractFunction('defaultCustomerMeta') + '\n' +
    extractFunction('resetPerAccountCaches') + '\n' +
    extractFunction('resolveCustomerContext') + '\n',
    context
  );
  return context;
}

// Konto A's Anfrage steckt noch (Netzwerk, Datenbank, o.ae.), waehrend der
// Reset schon laeuft -- der Zustand, den vxAccountGeneration abfangen muss.
// Jeder Test setzt genau die eine Abhaengigkeit, die er kontrolliert
// verzoegern will; die uebrigen loesen sofort auf.
function raceSandbox(overrides) {
  const sandbox = Object.assign({
    console,
    customerContext: { authUserId: null, usersCustomerId: null, customerId: null, customerRecord: null },
    customerDocumentsState: { loading: false, loaded: false, invoices: [], contract: null, error: null },
    customerMeta: { customerId: 'cust-a', voiceId: '' },
    vxAccountGeneration: 0,
    window: {
      _vxAssistantVoicesLoaded: false,
      _vxAssistantVoicesLoading: false,
      _vxAssistantVoicesPromise: null,
      _vxAssistantVoicesError: null,
      assistantVoiceOptions: [],
      assistantSelectedVoiceId: null
    },
    currentUser: { id: 'auth-a' },
    CUSTOMERS_TABLE: 'customers',
    _sb: { from: fakeFrom },
    ensurePublicUserProvisioning: async () => {},
    vxDebugInfo: () => {},
    getCurrentSessionUser: async () => ({ id: 'auth-a' }),
    vxRenderCustomerDocuments: () => {}
  }, overrides);
  const context = vm.createContext(sandbox);
  vm.runInContext(
    extractFunction('defaultCustomerMeta') + '\n' +
    extractFunction('resetPerAccountCaches') + '\n' +
    extractFunction('resolveCustomerContext') + '\n' +
    extractFunction('vxLoadCustomerDocuments') + '\n' +
    extractFunction('vxPreloadAssistantVoices') + '\n',
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
  // customerMeta fehlte im ersten Fix -- der Namens-Fallback in
  // loadCustomerMeta() (customerName: f.contact_first_name || ... ||
  // customerMeta.customerName || '') haette Konto A's Namen sonst an Konto B
  // weitergereicht, sobald Konto B selbst keinen Namen hinterlegt hat.
  assert.equal(context.customerMeta.customerId, '');
  assert.equal(context.customerMeta.customerName, '');
  assert.equal(context.customerMeta.contactFirstName, '');
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

test('der Boot-Pfad erzwingt den Reload -- loadData() einmal pro Konto-Generation, showApp() immer', () => {
  // loadData() laeuft sowohl beim Booten als auch bei jedem 12s-Poll -- ein
  // unbedingtes forceReload=true haette (P2 aus der PR-#945-Review) die
  // Dokumente-Funktion bei jedem Tick neu aufgerufen, obwohl der Cache fuer
  // dieses Konto laengst geladen ist. vxAccountBootReloadGeneration macht
  // daraus "einmal pro Konto", nicht "einmal pro Tick".
  assert.match(dashboard, /const needsAccountBootReload = vxAccountBootReloadGeneration !== vxAccountGeneration;/,
    'ohne diese Bedingung erzwingt jeder Poll denselben vollen Reload wie der erste nach einem Kontowechsel');
  assert.match(dashboard, /await loadCustomerMeta\(needsAccountBootReload\)\.catch\(\(\)=>\{\}\);/);
  assert.match(dashboard, /if \(needsAccountBootReload\) vxAccountBootReloadGeneration = vxAccountGeneration;/,
    'ohne diese Zeile bliebe needsAccountBootReload dauerhaft wahr -- dann waere nichts gewonnen');
  // showApp() laeuft nur einmal pro Boot, nie im 12s-Poll -- hier ist ein
  // unbedingtes true weiterhin richtig, nicht dieselbe Regression.
  assert.match(dashboard, /vxPreloadAssistantVoices\(true\)\.catch\(function\(\)\{\}\);/,
    'sonst zeigt die Stimmauswahl beim Booten weiterhin die zwischengespeicherte Liste des vorherigen Kontos');
});

test('loadCustomerMeta() verwirft ein verspaetetes Ergebnis an beiden Schreibstellen', () => {
  // loadCustomerMeta() schreibt customerMeta zweimal unbedingt: einmal in
  // der grossen Zuweisung, ein zweites Mal danach -- nach einem WEITEREN
  // await -- wenn die Add-ons geladen sind. Beide Stellen muessen die
  // Generation pruefen, sonst mutiert die zweite ein Objekt, das laengst
  // einem anderen Konto gehoert.
  const meta = extractFunction('loadCustomerMeta');
  assert.match(meta, /^async function loadCustomerMeta\(forceReload\) \{\s*\n\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*const generation = vxAccountGeneration;/,
    'die Generation muss beim Anfragebeginn festgehalten werden, nicht erst am Ende');
  assert.match(meta, /if \(generation !== vxAccountGeneration\) return customerMeta; \/\/[^\n]*\n\s*customerMeta = \{/,
    'die grosse customerMeta-Zuweisung muss durch die Generation abgesichert sein');
  const addonSection = meta.slice(meta.indexOf("from('customer_addons')"));
  assert.match(addonSection, /if \(generation !== vxAccountGeneration\) return customerMeta;/,
    'die Add-on-Zuweisungen nach dem zweiten await muessen die Generation ebenfalls pruefen');
  assert.match(addonSection, /\} catch\(e\) \{\s*if \(generation !== vxAccountGeneration\) return customerMeta;/,
    'auch der Fehlerfall des Add-on-Ladevorgangs darf ein inzwischen fremdes customerMeta nicht mehr anfassen');
});

// ── 3. Wettlauf: eine Anfrage von Konto A wird ERST NACH dem Reset fertig ──
//
// resetPerAccountCaches() schliesst die Luecke, dass ein Cache nach dem
// Kontowechsel STEHEN bleibt. Es schliesst NICHT die Luecke, dass eine zum
// Reset-Zeitpunkt bereits laufende Anfrage danach noch fertig wird und ihr
// Ergebnis unbedingt zurueckschreibt. Diese drei Tests steuern die
// Netzwerk-Antwort manuell per Promise-Handle: Anfrage starten, Reset
// dazwischenschieben, dann ERST die (jetzt veraltete) Antwort liefern -- und
// pruefen, dass sie den frisch geleerten Cache nicht wieder fuellt.

test('resolveCustomerContext(): eine Antwort fuer Konto A nach dem Reset ueberschreibt den geleerten Kontext nicht', async () => {
  let resumeProvisioning;
  const context = raceSandbox({
    ensurePublicUserProvisioning: () => new Promise(function(resolve) { resumeProvisioning = resolve; })
  });

  const pending = vm.runInContext('resolveCustomerContext()', context);
  // resolveCustomerContext() haengt jetzt in ensurePublicUserProvisioning()
  // fest -- die Stelle, an der im echten Betrieb Netzwerkzeit vergeht.
  vm.runInContext('resetPerAccountCaches()', context); // Konto-Wechsel, waehrend Konto A's Anfrage noch unterwegs ist

  resumeProvisioning(); // Konto A's Anfrage laeuft jetzt weiter -- zu spaet
  await pending;

  assert.equal(context.customerContext.customerId, null,
    'Konto A durfte den nach dem Reset geleerten Kontext nicht mehr fuellen');
  assert.equal(context.customerContext.customerRecord, null);
});

test('vxLoadCustomerDocuments(): Rechnungen/Vertrag von Konto A nach dem Reset landen nicht im geleerten Cache', async () => {
  let resolveDocsCall;
  const context = raceSandbox({
    callDashboardFunction: () => new Promise(function(resolve) { resolveDocsCall = resolve; })
  });

  const pending = vm.runInContext('vxLoadCustomerDocuments()', context);
  vm.runInContext('resetPerAccountCaches()', context); // Konto-Wechsel, waehrend Konto A's Rechnungen noch unterwegs sind

  resolveDocsCall({ invoices: [{ id: 'inv-a' }], contract: { id: 'contract-a' } }); // zu spaet
  await pending;

  assert.equal(context.customerDocumentsState.invoices.length, 0,
    'Konto A\'s Rechnungen duerfen den nach dem Reset geleerten Dokumenten-Cache nicht mehr fuellen');
  assert.equal(context.customerDocumentsState.contract, null,
    'Konto A\'s Vertrag ist der schwerwiegendere Fall -- er waere hier fuer Konto B sichtbar');
});

test('vxPreloadAssistantVoices(): Stimmen von Konto A nach dem Reset landen nicht im geleerten Cache', async () => {
  let resolveVoicesFetch;
  const context = raceSandbox({
    getSupabaseAuthClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok-a' } } }) } }),
    fetch: () => new Promise(function(resolve) { resolveVoicesFetch = resolve; })
  });

  const pending = vm.runInContext('vxPreloadAssistantVoices()', context);
  vm.runInContext('resetPerAccountCaches()', context); // Konto-Wechsel, waehrend Konto A's Stimmenanfrage noch unterwegs ist

  // getSession() liegt als eigene (schnelle) Promise vor fetch() -- Microtasks
  // durchlaufen lassen, bis fetch() tatsaechlich aufgerufen und damit
  // resolveVoicesFetch zugewiesen wurde.
  await new Promise(function(resolve) { setImmediate(resolve); });
  resolveVoicesFetch({ ok: true, json: async () => ({ voices: [{ voice_id: 'voice-a' }], selected_voice_id: 'voice-a' }) }); // zu spaet

  await pending;

  assert.equal(context.window.assistantVoiceOptions.length, 0,
    'Konto A\'s Stimmenliste darf den nach dem Reset geleerten Cache nicht mehr fuellen');
  assert.equal(context.window._vxAssistantVoicesLoaded, false);
});
