// Guard fuer S1 (Diagnose 2026-08-09): Der AI-Setup-Tab im Admin-Portal darf
// keine Kundenspalte schreiben, fuer die er kein Eingabefeld hat.
//
// Der Befund war nicht "ein Feld fehlt", sondern "ein Feld wird aus einer
// Variablen geschrieben, die niemand befuellt": assistant_name, ai_customer_type,
// ai_address_form, ai_tone, ai_language und ai_greeting standen als
// `cfg.assistantName||null` im Patch, obwohl weder die Hydrierung in
// loadDataFromSupabase noch sonst eine Stelle diese cfg-Schluessel je gesetzt
// hat. Jedes Speichern hat die sechs Spalten auf NULL gesetzt und der Sync
// direkt darunter hat den Verlust an ElevenLabs weitergereicht.
//
// Eine Regex auf die Feldnamen wuerde nur genau diesen Ruecksturz fangen. Der
// Test fuehrt deshalb die echte Funktion aus index.html aus: cfg bekommt exakt
// die Schluessel, die die Hydrierung erzeugt, jedes Eingabefeld liefert einen
// nicht-leeren Wert — und der resultierende Patch darf danach kein einziges
// NULL enthalten. Ein Feld, das aus einer nicht existierenden Quelle stammt,
// faellt damit auf, egal wie es heisst.

import fs from 'node:fs';
import vm from 'node:vm';

const indexPath = 'admin-panel/index.html';
const source = fs.readFileSync(indexPath, 'utf8');

let failed = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

// ── Funktionsquelle aus der Seite schneiden ──────────────────────────────────
function extractFunction(text, signature) {
  const start = text.indexOf(signature);
  if (start === -1) throw new Error(`${signature} nicht gefunden`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`${signature}: kein passendes Klammernende`);
}

// ── Welche cfg-Schluessel erzeugt die Hydrierung wirklich? ───────────────────
// Genau diese Menge — nicht mehr — steht saveCustomerAiConfig beim Speichern
// zur Verfuegung. Wird die Hydrierung spaeter erweitert, waechst der Stub mit.
function hydratedConfigKeys(text) {
  const anchor = text.indexOf('state.aiConfigs = Object.fromEntries(');
  if (anchor === -1) throw new Error('Hydrierung von state.aiConfigs nicht gefunden');
  const block = text.slice(anchor, text.indexOf('state.onboarding =', anchor));
  const keys = new Set();
  for (const match of block.matchAll(/^\s*(\w+):\s*(?:String\(|customer\.|existing\.)/gm)) keys.add(match[1]);
  for (const match of block.matchAll(/cfg\.(\w+)\s*=/g)) keys.add(match[1]);
  return keys;
}

const fnSource = extractFunction(source, 'async function saveCustomerAiConfig(');
const cfgKeys = hydratedConfigKeys(source);

check('Hydrierung liefert die bekannten Wissensfelder',
  ['businessDescription', 'services', 'internalNotes', 'industryTemplateId'].every(key => cfgKeys.has(key)),
  `${cfgKeys.size} Schluessel`);

// ── Ausfuehren mit vollstaendig befuellter Umgebung ──────────────────────────
const CUSTOMER_ID = 'cust_verify_ai_setup';
const captured = [];

const inputValues = new Map();
const element = (id) => ({
  get value() { return inputValues.has(id) ? inputValues.get(id) : `wert-${id}`; },
  set value(next) { inputValues.set(id, next); },
  disabled: false,
  textContent: '',
  style: {}
});
const elements = new Map();

const cfgStub = {};
for (const key of cfgKeys) cfgStub[key] = `hydriert-${key}`;
cfgStub.industryTemplateId = 'tpl_generic';

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    }
  },
  state: {
    aiSelectedCustomerId: CUSTOMER_ID,
    aiConfigs: { [CUSTOMER_ID]: cfgStub },
    aiChanges: [],
    events: []
  },
  authClient: {},
  // Der Kunde traegt bewusst KEINE elevenlabs_agent_id: der Sync-Zweig ist hier
  // nicht Gegenstand des Tests, nur der Patch davor.
  customerById: () => ({ id: CUSTOMER_ID, name: 'Verify AG' }),
  callAdminFunction: async (name, payload) => { captured.push({ name, payload }); return { ok: true }; },
  buildCustomerAiSummary: () => 'Zusammenfassung',
  getAIReadiness: () => ({ ready: true, missing: [] }),
  nowStamp: () => '2026-08-09 00:00',
  syncAllCustomerLifecycleStatuses: () => {},
  renderAll: () => {},
  showToast: () => {}
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
new vm.Script(`${fnSource}\nglobalThis.__run = saveCustomerAiConfig;`, { filename: indexPath }).runInContext(sandbox);
await sandbox.__run();

const call = captured.find(entry => entry.payload?.action === 'customers.update');
check('Speichern schreibt genau einen Kunden-Patch', Boolean(call) && captured.filter(e => e.payload?.action === 'customers.update').length === 1);

const patch = call?.payload?.patch || {};
const nulled = Object.entries(patch).filter(([, value]) => value === null).map(([key]) => key);

check('kein Feld wird auf NULL geschrieben, obwohl alle Quellen befuellt sind',
  nulled.length === 0,
  nulled.length ? `NULL: ${nulled.join(', ')}` : 'alle Werte gesetzt');

// Explizit, damit der konkrete Ruecksturz auch dann auffaellt, wenn jemand die
// Felder mit einem Platzhalter statt aus cfg schreibt.
const IDENTITY_COLUMNS = ['assistant_name', 'ai_customer_type', 'ai_address_form', 'ai_tone', 'ai_language', 'ai_greeting'];
const identityWrites = IDENTITY_COLUMNS.filter(column => column in patch);
check('Identitaetsfelder bleiben dem Setup-Assistenten vorbehalten',
  identityWrites.length === 0,
  identityWrites.length ? `unerwartet im Patch: ${identityWrites.join(', ')}` : 'nicht im Patch');

check('die Wissensfelder des Tabs werden weiterhin geschrieben',
  ['ai_business_description', 'ai_services', 'ai_location_hours', 'ai_booking_faq', 'ai_instructions',
   'ai_fallback_escalation', 'ai_response_constraints', 'ai_internal_notes', 'industry_template_id']
    .every(column => column in patch));

// ── Ein Klick, ein Speichervorgang ───────────────────────────────────────────
const inlineHandlers = source.match(/id="ai-save-customer"[^>]*onclick="saveCustomerAiConfig\(\)"/g) || [];
const listeners = source.match(/getElementById\('ai-save-customer'\)\.addEventListener/g) || [];
check('Speichern-Button ist genau einmal verdrahtet',
  inlineHandlers.length + listeners.length === 1,
  `onclick: ${inlineHandlers.length}, addEventListener: ${listeners.length}`);

if (failed) process.exit(1);
console.log('AI-Setup identity preservation passed.');
