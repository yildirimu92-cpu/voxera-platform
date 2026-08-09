// Guard fuer S4 / Stufe 1 (Diagnose 2026-08-09): der Prompt-Fingerprint haelt
// fest, mit welchem Stand von Builder, Master-Prompt und Branchenvorlage ein
// Agent zuletzt bespielt wurde.
//
// Warum das ein eigener Guard ist: der Fingerprint ist die Grundlage jeder
// Fan-out-Entscheidung. Rechnet er auf zwei Wegen unterschiedlich, gilt ein
// Kunde dauerhaft als veraltet und wird bei jedem Durchlauf erneut angefasst --
// oder er gilt dauerhaft als aktuell und wird nie nachgezogen. Beides faellt im
// Betrieb erst spaet auf.
//
// Der Test fuehrt die echte Funktion aus (nicht nachgebaut) und prueft
// zusaetzlich, dass die Aufrufer sie ueberhaupt verwenden.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LIB = 'admin-panel/netlify/functions/_lib/prompt-fingerprint.js';
// Seit S4 / Stufe 2 liegt der Sync-Kern in der Lib, nicht mehr im Handler.
const TRIGGER = 'admin-panel/netlify/functions/_lib/elevenlabs-sync.js';
const STATUS = 'admin-panel/netlify/functions/elevenlabs-sync-status.js';

const { promptFingerprint, fingerprintFor } = require(`../${LIB}`);
const { PROMPT_BUILDER_VERSION } = require('../admin-panel/netlify/functions/_lib/prompt-builder-v2.js');

let failed = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

// Die Builder-Version enthaelt selbst einen Punkt ('2.2'), eine Zerlegung nach
// Index waere deshalb falsch. Geprueft wird die Struktur als Ganzes: Schema,
// Builder-Version, und ein Hash je gemeinsamer Eingabe.
const SHAPE = /^v(\d+)\.(.+?)\.([0-9a-f]{12})\.([0-9a-f]{12})\.([0-9a-f]{12})\.([0-9a-f]{12})\.([0-9a-f]{12})$/;

const MASTER = '# Master Layer 1\r\n\r\n---\r\n\r\n## ROLLE\r\nDu bist {{ASSISTANT_NAME}}.';
const INDUSTRY = '## BRANCHE\nIT-Support.';
const CORE = '[{"key":"oeffnungszeiten"}]';
const EXTRA = [{ key: 'notdienst', label: 'Notdienst' }];

// ── Stabilitaet: gleiche Eingaben, gleicher Wert ─────────────────────────────
{
  const a = promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY });
  const b = promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY });
  check('gleiche Eingaben ergeben denselben Fingerprint', a === b, a);
}

// ── Jede Eingabe schlaegt einzeln durch ──────────────────────────────────────
{
  const base = promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY });
  const masterChanged = promptFingerprint({ masterPrompt: `${MASTER} `, industryPrompt: INDUSTRY });
  const industryChanged = promptFingerprint({ masterPrompt: MASTER, industryPrompt: `${INDUSTRY} ` });
  check('Aenderung am Master-Prompt aendert den Fingerprint', base !== masterChanged);
  check('Aenderung an der Branchenvorlage aendert den Fingerprint', base !== industryChanged);
  check('beide Aenderungen sind voneinander unterscheidbar', masterChanged !== industryChanged);
}

// Genau der Fall S13: der Fix aendert den ausgelieferten Prompt, ohne dass ein
// Kunde irgendetwas anfasst. Ohne diese Eigenschaft bliebe der Kunde nach einem
// Builder-Fix unsichtbar auf dem alten Stand.
{
  const fp = promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY });
  check('Builder-Version ist Teil des Fingerprints',
    SHAPE.exec(fp)?.[2] === PROMPT_BUILDER_VERSION,
    `${fp} enthaelt ${PROMPT_BUILDER_VERSION}`);
}

// Der Schema-Praefix macht eine geaenderte Zusammensetzung sichtbar: sonst
// wuerden alte und neue Werte still verglichen, obwohl sie Verschiedenes
// bedeuten.
{
  const fp = promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY });
  check('Fingerprint traegt Schema, Builder-Version und fuenf Eingabe-Hashes',
    SHAPE.test(fp), fp);
}

// ── Leere Eingaben sind ein definierter Zustand, kein Absturz ────────────────
{
  check('ohne Eingaben wirft nichts', typeof promptFingerprint() === 'string');
  check('null-Eingaben sind wie leere Eingaben',
    promptFingerprint({ masterPrompt: null, industryPrompt: null })
    === promptFingerprint({ masterPrompt: '', industryPrompt: '' }));
}

// ── fingerprintFor(): Kunde ohne Branche == Kunde mit fehlender Vorlage ──────
// Beide Wege muessen denselben Wert liefern. loadPromptInputs() in der
// Sync-Funktion ergibt bei fehlender Vorlagenzeile ebenfalls '' -- laufen die
// beiden Seiten hier auseinander, gilt der Kunde fuer immer als veraltet.
{
  const context = {
    masterPrompt: MASTER,
    coreFields: CORE,
    industryTemplates: new Map([['it-support', { promptBlock: INDUSTRY, extraSteps: EXTRA }]])
  };
  const ohneBranche = fingerprintFor(context, { industry_template_id: null });
  const fehlendeVorlage = fingerprintFor(context, { industry_template_id: 'gibt-es-nicht' });
  const leererString = fingerprintFor(context, { industry_template_id: '  ' });
  check('Kunde ohne Branche und Kunde mit fehlender Vorlage sind gleich',
    ohneBranche === fehlendeVorlage && ohneBranche === leererString);

  const mitBranche = fingerprintFor(context, { industry_template_id: 'it-support' });
  check('Kunde mit vorhandener Vorlage unterscheidet sich davon', mitBranche !== ohneBranche);
  check('fingerprintFor deckt sich mit promptFingerprint',
    mitBranche === promptFingerprint({
      masterPrompt: MASTER, industryPrompt: INDUSTRY, coreFields: CORE, industryFields: EXTRA
    }));
  check('fingerprintFor vertraegt einen leeren Kunden', typeof fingerprintFor(context, null) === 'string');
}

// ── Verdrahtung: die Aufrufer benutzen die Funktion wirklich ─────────────────
const trigger = fs.readFileSync(TRIGGER, 'utf8');
const status = fs.readFileSync(STATUS, 'utf8');

check('Sync-Funktion berechnet den Fingerprint aus den geladenen Eingaben',
  /promptFingerprint\(\{\s*masterPrompt: inputs\.masterPrompt/.test(trigger));

// Codex P1 (#881): jede gemeinsame Eingabe, die der Builder verarbeitet, muss
// auch in den Fingerprint. Sonst veraendert eine Vorlagenaenderung den Prompt,
// waehrend jeder Agent weiter als aktuell gilt.
for (const feld of ['coreFields: inputs.coreFields', 'industryFields: inputs.industryFields', 'industryRequiredInformation: inputs.industryRequiredInformation']) {
  check(`Sync-Funktion reicht ${feld.split(':')[0]} in den Fingerprint`, trigger.includes(feld));
}
check('Builder und Fingerprint sehen dieselben gemeinsamen Eingaben',
  ['masterPrompt', 'industryPrompt', 'coreFields', 'industryFields', 'industryRequiredInformation']
    .every((feld) => new RegExp(`${feld}: inputs\\.${feld}`).test(trigger)));
check('Sync-Funktion schreibt ihn ins Log', /prompt_fingerprint: fingerprint/.test(trigger));

// Der Ist-Wert darf nur nach Erfolg fortgeschrieben werden -- sonst gilt ein
// Kunde als aktuell, dessen Agent den neuen Prompt nie bekommen hat.
check('Ist-Fingerprint wird nur nach erfolgreichem Sync gesetzt',
  /if \(syncStatus === 'success' && fingerprint\) \{\s*customerPatch\.prompt_fingerprint = fingerprint;/.test(trigger));

// Die Stufenleiter aus N6 (#878) gibt "am wenigsten wertvoll zuerst" auf.
// prompt_fingerprint muss changed_fields ueberleben -- an ihm haengt der ganze
// Fan-out, changed_fields ist nur Audit.
check('Fallback-Leiter kennt prompt_fingerprint',
  /prompt_fingerprint: _fingerprintColumn/.test(trigger)
  && /const logAttempts = \[/.test(trigger));
check('prompt_fingerprint wird spaeter aufgegeben als changed_fields',
  trigger.lastIndexOf('changed_fields: syncLogRow.changed_fields')
    < trigger.lastIndexOf('prompt_fingerprint: syncLogRow.prompt_fingerprint'));

check('Status-Endpunkt berechnet den Soll-Wert', /loadFingerprintContext\(sb\)/.test(status));
check('Status-Endpunkt liefert prompt_outdated aus', /prompt_outdated: promptOutdated/.test(status));

// Der wichtigste Zustand ist 'unknown'. Direkt nach der Einfuehrung hat jeder
// Bestandskunde prompt_fingerprint = null. Wuerde das als "aktuell" gelten,
// waeren ausgerechnet die Kunden unsichtbar, fuer die S4 gebaut wurde.
check('Status-Endpunkt unterscheidet unknown von current',
  /promptState = 'unknown'/.test(status) && /promptState = 'current'/.test(status));
check('null-Fingerprint gilt nicht als aktuell',
  /if \(!customer\.prompt_fingerprint\) promptState = 'unknown';/.test(status));
check('prompt_outdated bleibt streng auf "gemessen und abweichend"',
  /promptState === 'outdated'/.test(status));

// Der Soll-Wert wird berechnet, nicht gespeichert. Ein gespeicherter Soll-Wert
// koennte selbst veralten und wuerde die Frage im Kreis beantworten.
check('Soll-Wert wird nicht in die Datenbank geschrieben',
  !/expected_prompt_fingerprint:\s*[^,\n]*\n?\s*\}\)\s*\.eq/.test(status)
  && !/update\(\{[^}]*expected_prompt_fingerprint/.test(status));

assert.ok(true);
if (failed) process.exit(1);
console.log('prompt fingerprint verified.');
