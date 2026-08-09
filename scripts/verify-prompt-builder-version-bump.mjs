#!/usr/bin/env node
/**
 * Guard fuer S4: eine Aenderung am Prompt-Builder muss PROMPT_BUILDER_VERSION
 * mitnehmen.
 *
 * Warum es diesen Guard gibt (Selbst-Check 2026-08-09):
 * Der S4-Fan-out entscheidet ueber den Prompt-Fingerprint, welche Agenten auf
 * einem veralteten Stand laufen. Die Builder-Version ist der einzige Teil
 * dieses Fingerprints, der Code-Aenderungen abbildet -- Master-Prompt und
 * Branchenvorlagen kommen aus der Datenbank und werden gehasht, der Builder
 * selbst nicht. Bleibt die Version bei einer Builder-Aenderung stehen, gilt
 * jeder Agent mit gespeichertem Fingerprint weiter als aktuell, obwohl sein
 * Prompt inzwischen anders gebaut wuerde. Der Fan-out ist fuer genau diese
 * Aenderung blind, und niemand sieht es.
 *
 * Genau das ist bei #882 passiert (Oeffnungszeiten als Wochenraster): Ausgabe
 * geaendert, Version unveraendert. Damals folgenlos, weil noch kein einziger
 * Fingerprint gespeichert war -- ab dem ersten Fan-out-Lauf waere es eine
 * stille Luecke.
 *
 * Bewusst NICHT gewaehlt: den Builder-Quelltext hashen statt der Konstante.
 * Das waere automatisch, aber das esbuild-Bundling von Netlify koennte den
 * Hash zwischen zwei Deploys veraendern, ohne dass sich inhaltlich etwas
 * geaendert hat -- und dann liefe bei JEDEM Deploy ein Fan-out ueber alle
 * Kunden. Das ist exakt das unkontrollierte Massen-Sync, gegen das S4 mit
 * Canary und Abbruchkriterium gebaut wurde. Ein deterministischer Guard, der
 * Disziplin verlangt, ist hier die robustere Wahl.
 *
 * Exit-Codes:
 *   0  Builder unveraendert, oder Version wurde mitgezogen
 *   1  Builder geaendert, Version steht still (Verstoss)
 *   2  nicht pruefbar (kein Basis-Ref) -- ebenfalls rot, denn ein Guard, der
 *      bei fehlendem Vergleich gruen meldet, schuetzt nichts
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const BUILDER = 'admin-panel/netlify/functions/_lib/prompt-builder-v2.js';
const VERSION_RE = /const PROMPT_BUILDER_VERSION = '([^']+)'/;

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_UNVERIFIABLE = 2;

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function resolveBaseRef() {
  // Im PR-Lauf nennt GitHub den Zielbranch. Lokal ist origin/main die
  // sinnvolle Annahme; beides wird geprueft statt angenommen.
  const candidates = [];
  if (process.env.GITHUB_BASE_REF) candidates.push(`origin/${process.env.GITHUB_BASE_REF}`);
  candidates.push('origin/main', 'main');
  for (const ref of candidates) {
    if (git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return ref;
  }
  return null;
}

function versionIn(text, quelle) {
  const match = VERSION_RE.exec(text || '');
  if (!match) {
    console.error(`FAIL PROMPT_BUILDER_VERSION nicht gefunden (${quelle}) — Konstante umbenannt? Dann diesen Guard mit anpassen.`);
    process.exit(EXIT_VIOLATION);
  }
  return match[1];
}

const baseRef = resolveBaseRef();
if (!baseRef) {
  console.error('FAIL Basis-Ref nicht aufloesbar (weder GITHUB_BASE_REF noch origin/main).');
  console.error('     In CI hilft actions/checkout mit fetch-depth: 0.');
  process.exit(EXIT_UNVERIFIABLE);
}

const mergeBase = git(['merge-base', baseRef, 'HEAD']);
if (!mergeBase.ok) {
  console.error(`FAIL keine gemeinsame Basis zwischen ${baseRef} und HEAD.`);
  process.exit(EXIT_UNVERIFIABLE);
}
const base = mergeBase.stdout;

const changed = git(['diff', '--name-only', base, '--', BUILDER]);
if (!changed.ok) {
  console.error(`FAIL git diff gegen ${base} fehlgeschlagen: ${changed.stderr}`);
  process.exit(EXIT_UNVERIFIABLE);
}

if (!changed.stdout) {
  console.log(`PASS Prompt-Builder gegenueber ${baseRef} unveraendert — nichts zu pruefen.`);
  process.exit(EXIT_OK);
}

const baseFile = git(['show', `${base}:${BUILDER}`]);
if (!baseFile.ok) {
  // Die Datei ist neu. Dann gibt es keine Vorversion, gegen die zu vergleichen
  // waere -- die blosse Existenz einer Version reicht.
  versionIn(fs.readFileSync(BUILDER, 'utf8'), 'Arbeitskopie');
  console.log('PASS Prompt-Builder ist neu — Version vorhanden, kein Vergleich moeglich.');
  process.exit(EXIT_OK);
}

const before = versionIn(baseFile.stdout, baseRef);
const after = versionIn(fs.readFileSync(BUILDER, 'utf8'), 'Arbeitskopie');

if (before === after) {
  console.error(`FAIL ${BUILDER} wurde gegenueber ${baseRef} geaendert, PROMPT_BUILDER_VERSION steht aber weiter auf '${after}'.`);
  console.error('');
  console.error('     Der S4-Fan-out erkennt Code-Aenderungen am Prompt ausschliesslich ueber diese');
  console.error('     Konstante. Bleibt sie stehen, gilt jeder Agent mit gespeichertem Fingerprint');
  console.error('     weiter als aktuell, obwohl sein Prompt inzwischen anders gebaut wuerde --');
  console.error('     die Aenderung erreicht dann keinen einzigen Live-Agenten.');
  console.error('');
  console.error('     Aendert sich die AUSGABE des Builders: Version anheben.');
  console.error('     Aendert sich nur Kommentar/Formatierung: diesen Guard bewusst uebersteuern');
  console.error('     (Commit-Nachricht begruenden) — nicht stillschweigend umgehen.');
  process.exit(EXIT_VIOLATION);
}

console.log(`PASS Prompt-Builder geaendert, Version mitgezogen: '${before}' → '${after}'.`);
process.exit(EXIT_OK);
