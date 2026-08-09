// Guard fuer S9 (Diagnose 2026-08-09): elevenlabs_sync_log.changed_fields wird
// jetzt tatsaechlich befuellt. Vorher: die Spalte existierte und wurde in der
// Admin-Oberflaeche gerendert, aber `prev_values` wurde in
// trigger-elevenlabs-sync.js mit `void prev_values;` verworfen -- 0 von 20
// Zeilen in Produktion hatten changed_fields.
//
// Dieser Test fuehrt die echte diffPrevValues()-Funktion aus der Sync-Funktion
// aus (nicht nachgebaut) und prueft: pro geaendertem Feld einzeln, dass genau
// dieses Feld erscheint -- keins zu viel, keins zu wenig. Ausserdem, dass der
// Handler prev_values nicht mehr verwirft und beide Spalten in den Insert legt.
//
// Seit S4 / Stufe 2 liegt der Sync-Kern in _lib/elevenlabs-sync.js; der Handler
// ist nur noch Guard, Parsing und Antwortform. Der Guard liest deshalb die Lib
// -- und zusaetzlich den Handler, damit ein Regress "Handler reicht prev_values
// nicht mehr durch" nicht durch die Verlagerung unsichtbar wird.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const triggerPath = 'admin-panel/netlify/functions/_lib/elevenlabs-sync.js';
const handlerPath = 'admin-panel/netlify/functions/trigger-elevenlabs-sync.js';
const source = fs.readFileSync(triggerPath, 'utf8');
const handler = fs.readFileSync(handlerPath, 'utf8');

let failed = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

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

// ── prev_values wird nicht mehr verworfen ────────────────────────────────────
check('void prev_values ist entfernt', !/void\s+prev_values/.test(source));
check('Sync-Kern verwendet diffPrevValues fuer changed_fields', /diffPrevValues\(prevValues, customer\)/.test(source));
check('Insert schreibt changed_fields', /changed_fields:\s*Object\.keys\(changedFields\)/.test(source));
check('Insert schreibt prev_values', /prev_values:\s*Object\.keys\(prevValues/.test(source));

// Die Verlagerung in die Lib darf die Kette nicht unterbrechen: der Handler
// muss prev_values aus dem Request weiterhin durchreichen, sonst kommt in der
// Lib immer {} an und changed_fields bleibt fuer immer leer.
check('Handler reicht prev_values an den Sync-Kern durch',
  /prevValues: prev_values/.test(handler));
check('Handler reicht triggered_by an den Sync-Kern durch',
  /triggeredBy: triggered_by/.test(handler));

// ── diffPrevValues() isoliert ausfuehren ─────────────────────────────────────
const fnSource = extractFunction(source, 'function diffPrevValues(');
const sandbox = { console: { warn() {} } };
vm.createContext(sandbox);
new vm.Script(`${fnSource}\nglobalThis.__diff = diffPrevValues;`, { filename: triggerPath }).runInContext(sandbox);
const diffPrevValues = sandbox.__diff;

const BASE_CUSTOMER = {
  assistant_name: 'Nadia',
  ai_customer_type: 'consultant',
  ai_address_form: 'du',
  ai_tone: 'casual',
  ai_language: 'de_en',
  ai_greeting: 'Hoi, hier ist Nadia.',
  ai_business_description: 'Coaching fuer KMU',
  industry_template_id: 'tpl_consulting'
};

// Jedes Feld einzeln aendern: der Wegwerf-Testkunde aus dem Auftrag, hier
// deterministisch statt gegen Produktion.
for (const key of Object.keys(BASE_CUSTOMER)) {
  const prevValues = {};
  for (const k of Object.keys(BASE_CUSTOMER)) prevValues[k] = BASE_CUSTOMER[k];
  const after = { ...BASE_CUSTOMER, [key]: `${BASE_CUSTOMER[key]}-geaendert` };
  const changed = diffPrevValues(prevValues, after);
  check(`einzelne Aenderung an "${key}" ergibt genau {${key}}`,
    Object.keys(changed).length === 1 && key in changed,
    `changed_fields: ${JSON.stringify(changed)}`);
}

// Mehrere Felder gleichzeitig.
{
  const prevValues = { ...BASE_CUSTOMER };
  const after = { ...BASE_CUSTOMER, ai_tone: 'professional', ai_language: 'de' };
  const changed = diffPrevValues(prevValues, after);
  assert.deepEqual(Object.keys(changed).sort(), ['ai_language', 'ai_tone']);
  check('zwei gleichzeitige Aenderungen ergeben genau diese zwei Felder', true);
}

// Keine Aenderung.
{
  const prevValues = { ...BASE_CUSTOMER };
  const changed = diffPrevValues(prevValues, { ...BASE_CUSTOMER });
  check('keine Aenderung ergibt leeres changed_fields', Object.keys(changed).length === 0);
}

// null/undefined/'' sind aequivalent -- ein Aufrufer, der leere Felder mit ''
// statt null schickt (index.html: `c[k] || ''`), darf kein Phantom-Diff erzeugen.
{
  const changed = diffPrevValues({ ai_greeting: '' }, { ai_greeting: null });
  check("leer ('') vs. null zaehlt nicht als Aenderung", Object.keys(changed).length === 0);
}
{
  const changed = diffPrevValues({ ai_greeting: '' }, { ai_greeting: 'jetzt gesetzt' });
  check("leer ('') zu einem echten Wert zaehlt als Aenderung",
    Object.keys(changed).length === 1 && changed.ai_greeting === 'jetzt gesetzt');
}

// Felder, die der Aufrufer gar nicht mitschickt (Wizard, customer_request:
// prev_values = {}), werden nicht geraten.
{
  const changed = diffPrevValues({}, { ...BASE_CUSTOMER, ai_tone: 'anders' });
  check('ohne prev_values bleibt changed_fields leer', Object.keys(changed).length === 0);
}

// Malformed input darf den Sync nicht zum Absturz bringen.
{
  check('nicht-Objekt prev_values wirft nicht und ergibt leer',
    Object.keys(diffPrevValues(null, BASE_CUSTOMER)).length === 0
    && Object.keys(diffPrevValues('x', BASE_CUSTOMER)).length === 0
    && Object.keys(diffPrevValues([], BASE_CUSTOMER)).length === 0);
}

if (failed) process.exit(1);
console.log('elevenlabs_sync_log changed_fields verified.');
