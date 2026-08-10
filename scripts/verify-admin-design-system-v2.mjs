import fs from 'node:fs';
import vm from 'node:vm';

// Welle 2 Teil 2 des Admin-Zielbilds: admin-runtime-design-system-v2.js hat
// sein Stylesheet zur Laufzeit per createElement('style') eingefuegt und
// brauchte dafuer 233 !important, um gegen die <style>-Bloecke in index.html
// anzukommen. Die Regeln liegen jetzt in shared/admin-layout.css, eingebunden
// NACH diesen Bloecken -- gleiche Spezifitaet, spaeter im Dokument, gewinnt
// ohne !important. Die JS-Datei behaelt nur, was Verhalten ist.
//
// Die Zusicherungen unten sind dieselben wie vorher; nur der Ort, an dem sie
// nachgewiesen werden, ist der neue.
const runtimePath = 'admin-panel/shared/admin-runtime-design-system-v2.js';
const layoutPath = 'admin-panel/shared/admin-layout.css';
const responsivePath = 'admin-panel/shared/admin-responsive.css';
const indexPath = 'admin-panel/index.html';
const loaderPath = 'admin-panel/shared/offer-brand.js';
const runtime = fs.readFileSync(runtimePath, 'utf8');
const layout = fs.readFileSync(layoutPath, 'utf8');
const responsive = fs.readFileSync(responsivePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');
// Die Regeln duerfen in jeder der beiden Stilschichten stehen -- geprueft wird,
// dass es sie gibt, nicht in welcher Datei sie gelandet sind.
const css = layout + '\n' + responsive;
let failed = 0;

try {
  new vm.Script(runtime, { filename: runtimePath });
  console.log(`PASS syntax ${runtimePath}`);
} catch (error) {
  failed += 1;
  console.error(`FAIL syntax ${runtimePath}: ${error.message}`);
}

try {
  new vm.Script(loader, { filename: loaderPath });
  console.log(`PASS syntax ${loaderPath}`);
} catch (error) {
  failed += 1;
  console.error(`FAIL syntax ${loaderPath}: ${error.message}`);
}

const checks = [
  ['single visual token layer exists', /--vx-admin-content-max/.test(css) && /--vx-admin-control-h/.test(css)],
  ['card and panel surfaces are unified', /\.card,\.bf-panel,\.bf-block/.test(css) && /--vx-admin-shadow/.test(css)],
  ['section headers use one light treatment', /\.vx-unified-head/.test(css) && /linear-gradient\(180deg,#FFFFFF/.test(css)],
  ['tabs share one segmented treatment', /\.module-tabs,\.bf-tabs,\.profile-tabs/.test(css) && /\.vx-module-tab/.test(css)],
  ['empty states are normalized', /patchEmptyStates/.test(runtime) && /vx-empty-success/.test(runtime)],
  ['tablet drawer starts at 1024px', /@media\s*\(max-width:\s*1024px\)/.test(css) && /mobile-menu-btn/.test(css)],
  ['phone layout has 768 and 480 breakpoints', /@media\s*\(max-width:\s*768px\)/.test(css) && /@media\s*\(max-width:\s*480px\)/.test(css)],
  ['mobile tabs scroll horizontally', /overflow-x:\s*auto/.test(css) && /-webkit-overflow-scrolling:\s*touch/.test(css)],
  ['mobile modals become bounded bottom sheets', /max-height:\s*calc\(100dvh/.test(css) && /border-radius:\s*18px 18px 0 0/.test(css)],
  ['mobile toolbars collapse to one column', /\.toolbar,\s*\.filter-bar,\s*\.vx-toolbar/.test(css) && /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css)],
  ['runtime patches dynamic content', /new MutationObserver/.test(runtime) && /patch\(document\)/.test(runtime)],
  // Frueher: "die Design-Datei laedt nach der Rechnungs-Datei" -- eine
  // Reihenfolge zwischen zwei nachgeladenen Skripten, die beide ihr CSS zur
  // Laufzeit einfuegten. Die Stilschichten sind jetzt echte Stylesheets und
  // gewinnen ueber die Dokumentreihenfolge, nicht ueber ein Ladefenster.
  // Die Position ist die ganze Begruendung dafuer, dass die Dateien ohne
  // !important auskommen: bei gleicher Spezifitaet gewinnt die spaetere Regel.
  // Geprueft wird gegen den letzten <style>-Block IM KOPF -- was im Body steht,
  // ist ohnehin spaeter und gehoert nicht zu dieser Zusage.
  ['stylesheets are linked after the inline style blocks in <head>',
    (() => {
      const kopf = index.slice(0, index.indexOf('</head>'));
      return kopf.indexOf('/shared/admin-layout.css') > kopf.lastIndexOf('</style>')
        && kopf.indexOf('/shared/admin-design-tokens.css') > kopf.lastIndexOf('</style>');
    })()],
  ['the design runtime no longer injects a stylesheet at runtime',
    !/createElement\(['"]style['"]\)/.test(runtime)],
  // Nur Regeln zaehlen, nicht der Kopfkommentar, der die alte Zahl nennt.
  ['the extracted layer needs no !important to win',
    (layout.replace(/\/\*[\s\S]*?\*\//g, '').match(/!important/g) || []).length === 0]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) process.exit(1);
console.log(`Admin design system V2 verification passed: ${checks.length} checks.`);
