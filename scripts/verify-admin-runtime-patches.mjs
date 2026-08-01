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
  'admin-panel/shared/admin-runtime-invoice-mail-routing-fix.js',
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

for (const [file, marker] of [
  ['admin-panel/shared/admin-runtime-invoice-only-ch.js', '__voxeraInvoiceOnly'],
  ['admin-panel/shared/admin-runtime-invoice-mail-routing-fix.js', '__voxeraInvoiceMailRoutingFix']
]) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes("current = current.__voxeraOriginal || current.__voxOriginal") || !source.includes(`hasAdminApiWrapper(current, '${marker}')`)) {
    failed = true;
    console.error(`FAIL ${file}: recursive API wrapper guard is missing`);
  }
}

if (failed) process.exit(1);
