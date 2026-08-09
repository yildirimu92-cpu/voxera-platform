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

const MASTER = '# Master Layer 1\r\n\r\n---\r\n\r\n## ROLLE\r\nDu bist {{ASSISTANT_NAME}}.';
const INDUSTRY = '## BRANCHE\nIT-Support.';

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
    fp.split('.').slice(1, -2).join('.') === PROMPT_BUILDER_VERSION,
    `${fp} enthaelt ${PROMPT_BUILDER_VERSION}`);
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
  const context = { masterPrompt: MASTER, industryPrompts: new Map([['it-support', INDUSTRY]]) };
  const ohneBranche = fingerprintFor(context, { industry_template_id: null });
  const fehlendeVorlage = fingerprintFor(context, { industry_template_id: 'gibt-es-nicht' });
  const leererString = fingerprintFor(context, { industry_template_id: '  ' });
  check('Kunde ohne Branche und Kunde mit fehlender Vorlage sind gleich',
    ohneBranche === fehlendeVorlage && ohneBranche === leererString);

  const mitBranche = fingerprintFor(context, { industry_template_id: 'it-support' });
  check('Kunde mit vorhandener Vorlage unterscheidet sich davon', mitBranche !== ohneBranche);
  check('fingerprintFor deckt sich mit promptFingerprint',
    mitBranche === promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY }));
  check('fingerprintFor vertraegt einen leeren Kunden', typeof fingerprintFor(context, null) === 'string');
}

// ── Verdrahtung: die Aufrufer benutzen die Funktion wirklich ─────────────────
const trigger = fs.readFileSync(TRIGGER, 'utf8');
const status = fs.readFileSync(STATUS, 'utf8');

check('Sync-Funktion berechnet den Fingerprint aus den geladenen Eingaben',
  /promptFingerprint\(\{\s*masterPrompt: inputs\.masterPrompt/.test(trigger));
check('Sync-Funktion schreibt ihn ins Log', /prompt_fingerprint: fingerprint/.test(trigger));

// Der Ist-Wert darf nur nach Erfolg fortgeschrieben werden -- sonst gilt ein
// Kunde als aktuell, dessen Agent den neuen Prompt nie bekommen hat.
check('Ist-Fingerprint wird nur nach erfolgreichem Sync gesetzt',
  /if \(syncStatus === 'success' && fingerprint\) \{\s*customerPatch\.prompt_fingerprint = fingerprint;/.test(trigger));

// Der Fallback-Insert muss die neue Spalte mit entfernen. Fehlt sie dort,
// wiederholt sich der S9-Fehler: primaerer Insert schlaegt fehl, Fallback
// schlaegt aus demselben Grund fehl, das Log bleibt leer.
check('Fallback-Insert entfernt prompt_fingerprint mit',
  /prompt_fingerprint: _fp/.test(trigger));

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
