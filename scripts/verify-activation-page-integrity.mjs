#!/usr/bin/env node
// verify-activation-page-integrity.mjs
//
// customer-dashboard/activate.html war von 70d8fc26 bis 3f06cd5 abgeschnitten:
// die Datei endete mitten im Kommentar "// -- Start ---" mit einem
// U+FFFD-Ersetzungszeichen, ohne </script>, </body> und </html>. Der HTML-Parser
// fuehrt einen bei EOF offenen script-Block nicht aus — die gesamte
// Aktivierungslogik lief nie, lautlos und ohne Fehlermeldung.
//
// Entstanden ist das durch wiederholtes Herunterladen und Wiederhochladen der
// Datei ("Rename activate (2).html to activate.html" und zwei weitere Runden).
// Genau deshalb gibt es diesen Check: die Fehlerklasse ist nicht theoretisch,
// sie ist in der Historie dieser Datei dreimal belegt und hinterlaesst im
// Browser keine Spur.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'customer-dashboard/activate.html';
const html = readFileSync(resolve(repoRoot, REL), 'utf8');

const failures = [];
const checks = [];
const ok = (l) => checks.push(l);
const fail = (l, d) => failures.push(`${l}\n    ${d}`);

// ── 1. Das Dokument ist vollstaendig ───────────────────────────────────────
for (const tag of ['</script>', '</body>', '</html>']) {
  if (html.includes(tag)) ok(`${tag} vorhanden`);
  else fail(`${tag} fehlt`, 'Die Datei ist abgeschnitten. Ein bei EOF offener script-Block wird nicht ausgefuehrt.');
}
if (html.trimEnd().endsWith('</html>')) ok('Datei endet auf </html>');
else fail('Datei endet nicht auf </html>', `Letzte 40 Zeichen: ${JSON.stringify(html.slice(-40))}`);

// ── 2. Kein Kodierungsschaden ──────────────────────────────────────────────
// U+FFFD entsteht, wenn Bytes mit falscher Zeichenkodierung gelesen werden —
// hier der Marker, an dem die Datei damals abriss.
const ffd = html.indexOf('�');
if (ffd === -1) ok('kein U+FFFD (Kodierungsschaden)');
else fail(`U+FFFD an Position ${ffd}`, `Zeile ${html.slice(0, ffd).split('\n').length}. Datei mit falscher Kodierung gespeichert.`);

// ── 3. Jeder oeffnende script-Tag wird geschlossen ─────────────────────────
const opens = (html.match(/<script\b/g) || []).length;
const closes = (html.match(/<\/script>/g) || []).length;
if (opens === closes) ok(`script-Tags paarig (${opens})`);
else fail(`script-Tags unpaarig: ${opens} offen, ${closes} geschlossen`, 'Ein nicht geschlossener Block wird stillschweigend nicht ausgefuehrt.');

// ── 4. Die Einstiegsfunktion wird auch aufgerufen ──────────────────────────
// Der eigentliche Schaden war nicht die fehlende Klammer, sondern die fehlende
// Zeile `init();` — definiert war die Funktion die ganze Zeit.
if (!/function\s+init\s*\(/.test(html)) {
  fail('init() ist nicht definiert', 'Die Aktivierungsseite braucht eine Einstiegsfunktion.');
} else if (!/^\s*(if\s*\(sb\)\s*)?init\s*\(\s*\)\s*;/m.test(html)) {
  fail('init() wird nie aufgerufen', 'Definiert, aber nicht gestartet — die Seite bleibt auf "Aktivierungslink wird geprueft..." stehen.');
} else {
  ok('init() ist definiert und wird aufgerufen');
}

// ── 5. Keine toten Cloudflare-Artefakte ────────────────────────────────────
// Die Datei wurde einmal aus einer Cloudflare-ausgelieferten Seite gespeichert.
// Deren E-Mail-Verschleierung braucht einen Decoder unter /cdn-cgi/, den es auf
// Netlify nicht gibt: die Adresse blieb als "[email protected]" stehen.
for (const [marker, note] of [
  ['__cf_email__', 'verschleierte Adresse ohne Decoder — Kunden sehen "[email protected]"'],
  ['/cdn-cgi/', 'Pfad existiert nur auf Cloudflare-Sites, auf Netlify ein 404']
]) {
  if (html.includes(marker)) fail(`Cloudflare-Artefakt "${marker}"`, note);
  else ok(`kein Cloudflare-Artefakt "${marker}"`);
}

// ── 6. Der Inline-Block ist gueltiges JavaScript ───────────────────────────
const m = html.match(/<script>\n([\s\S]*?)<\/script>/);
if (!m) {
  fail('kein Inline-script-Block gefunden', 'Erwartet wird der Block mit der Aktivierungslogik.');
} else {
  try {
    // eslint-disable-next-line no-new-func
    new Function(m[1]);
    ok('Inline-JavaScript ist syntaktisch gueltig');
  } catch (err) {
    fail('Inline-JavaScript ist ungueltig', String(err && err.message));
  }
}

// ── 7. Sitzungsspeicher stimmt mit dem Dashboard ueberein ──────────────────
// setPassword() erzeugt per signOut + signInWithPassword eine frische Session
// und leitet aufs Dashboard weiter. Weichen Schluessel oder Speicher-Backend ab,
// findet index.html diese Session nicht und zeigt trotz erfolgreicher
// Aktivierung den Login-Screen. Beide Seiten muessen deshalb dasselbe nutzen.
const dashboard = readFileSync(resolve(repoRoot, 'customer-dashboard/index.html'), 'utf8');
const keyOf = (src) => (src.match(/CUSTOMER_AUTH_STORAGE_KEY\s*=\s*'([^']+)'/) || [])[1];
const actKey = keyOf(html);
const dashKey = keyOf(dashboard);

if (!dashKey) {
  fail('CUSTOMER_AUTH_STORAGE_KEY in index.html nicht gefunden', 'Der Abgleich kann nicht geprueft werden.');
} else if (actKey !== dashKey) {
  fail(
    `Sitzungsschluessel weichen ab: activate.html ${JSON.stringify(actKey)} vs. index.html ${JSON.stringify(dashKey)}`,
    'Die bei der Aktivierung erzeugte Session waere fuer das Dashboard unsichtbar.'
  );
} else {
  ok(`Sitzungsschluessel identisch zum Dashboard ('${actKey}')`);
}

// Das Backend muss ebenso passen: der Supabase-Default ist localStorage, das
// Dashboard bevorzugt sessionStorage. Beide Seiten waehlen in derselben
// Reihenfolge — sonst reicht ein uebereinstimmender Schluessel nicht.
if (/storage:\s*getPreferredAuthStorage\(\)/.test(html)
    && /\[\s*window\.sessionStorage\s*,\s*window\.localStorage\s*\]/.test(html)) {
  ok('Speicher-Backend gewaehlt wie im Dashboard (sessionStorage bevorzugt)');
} else {
  fail(
    'activate.html waehlt das Speicher-Backend nicht wie das Dashboard',
    'Erwartet: storage: getPreferredAuthStorage() mit [sessionStorage, localStorage]. ' +
    'Ohne Angabe nutzt Supabase localStorage, das Dashboard aber sessionStorage.'
  );
}

// ── 8. Jede angesteuerte Ansicht existiert im Markup ───────────────────────
const referenced = [...html.matchAll(/showView\('([^']+)'\)/g)].map(x => x[1]);
const missing = [...new Set(referenced)].filter(id => !html.includes(`id="${id}"`));
if (missing.length === 0) ok(`alle ${new Set(referenced).size} angesteuerten Ansichten existieren`);
else fail(`Ansicht(en) ohne Markup: ${missing.join(', ')}`, 'showView() wuerde ins Leere greifen.');

console.log('\nAktivierungsseite — Integritaet\n');
for (const l of checks) console.log(`  PASS  ${l}`);
if (failures.length) {
  console.error(`\n  ${failures.length} Pruefung(en) fehlgeschlagen:\n`);
  for (const d of failures) console.error(`  FAIL  ${d}\n`);
  process.exit(1);
}
console.log(`\n  ${checks.length} Pruefungen bestanden, 0 verletzt.\n`);
