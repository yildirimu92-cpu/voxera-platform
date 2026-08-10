import fs from 'node:fs';
import vm from 'node:vm';

const files = [
  'admin-panel/shared/admin-runtime-ui.js',
  'admin-panel/shared/admin-runtime-navigation.js',
  'admin-panel/shared/admin-runtime-sync.js',
  'admin-panel/shared/admin-runtime-cases.js',
  'admin-panel/shared/admin-runtime-cases-admin-only.js',
  'admin-panel/shared/admin-runtime-mobile.js',
  'admin-panel/shared/admin-runtime-operations-v3.js',
  'admin-panel/shared/admin-runtime-cases-state-hotfix.js',
  'admin-panel/shared/admin-runtime-cases-usability-fix.js',
  'admin-panel/shared/admin-runtime-launch-p0.js',
  'admin-panel/shared/admin-runtime-invoice-only-ch.js',
  // admin-runtime-invoice-mail-routing-fix.js ist in Welle 1 aufgeloest.
  // Seine Umleitung ist Regel 1 der Kette in shared/core/admin-api.js.
  'admin-panel/shared/core/admin-api.js',
  'customer-dashboard/shared/customer-runtime-case-intake.js',
  'customer-dashboard/shared/offer-brand.js'
];

let failed = false;
for (const file of files) {
  try {
    const source = fs.readFileSync(file, 'utf8');
    new vm.Script(source, { filename: file });
    console.log(`OK ${file}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${file}: ${error.message}`);
  }
}

const runtimeUi = fs.readFileSync('admin-panel/shared/admin-runtime-ui.js', 'utf8');
if (!runtimeUi.includes('operationalLifecycleDepth > 0') || !runtimeUi.includes('operationalLifecycleDepth -= 1')) {
  failed = true;
  console.error('FAIL admin-panel/shared/admin-runtime-ui.js: operational lifecycle recursion guard is missing');
}

// Frueher stand hier: beide Mail-Umleitungen muessen eine Schleifensperre
// (`hasAdminApiWrapper`) mitbringen, damit sie sich nicht ein zweites Mal in
// die Wrapper-Kette haengen. Der Aufwand, den eine Schicht betrieb, um sich
// nicht selbst zu verdoppeln, war das Argument gegen die Kette: seit Welle 1
// wickelt niemand mehr, die Umleitungen sind Regeln in core/admin-api.js. Die
// Sperre ist damit nicht "fehlend", sondern gegenstandslos -- geprueft wird
// jetzt die staerkere Zusage, dass es ueberhaupt keinen Wrapper mehr gibt.
{
  const patches = fs.readdirSync('admin-panel/shared')
    .filter((name) => /^admin-runtime-.*\.js$/.test(name));
  const wrapper = patches.filter((name) => /(?:w|root|window)\.callAdminFunction\s*=\s*[^=]/
    .test(fs.readFileSync(`admin-panel/shared/${name}`, 'utf8')));
  if (wrapper.length) {
    failed = true;
    console.error(`FAIL ${wrapper.join(', ')}: wickelt callAdminFunction erneut ein. `
      + 'Neue Umleitungen gehoeren in die Regelkette von shared/core/admin-api.js.');
  } else {
    console.log(`OK kein Laufzeit-Patch wickelt callAdminFunction ein (${patches.length} geprueft)`);
  }

  // Die abgeloesten Wrapper duerfen nicht als Datei zurueckkehren.
  for (const tot of ['admin-runtime-invoice-mail-routing-fix.js', 'admin-runtime-voice-errors.js',
    'admin-runtime-data-integrity.js', 'admin-runtime-contract-termination.js']) {
    if (fs.existsSync(`admin-panel/shared/${tot}`)) {
      failed = true;
      console.error(`FAIL admin-panel/shared/${tot} ist wieder da. Diese Datei wurde in Welle 1 aufgeloest.`);
    }
  }
}

if (failed) process.exit(1);
