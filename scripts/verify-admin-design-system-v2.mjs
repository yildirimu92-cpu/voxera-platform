import fs from 'node:fs';
import vm from 'node:vm';

const runtimePath = 'admin-panel/shared/admin-runtime-design-system-v2.js';
const loaderPath = 'admin-panel/shared/offer-brand.js';
const runtime = fs.readFileSync(runtimePath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');
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
  ['single visual token layer exists', /--vx-admin-content-max/.test(runtime) && /--vx-admin-control-h/.test(runtime)],
  ['card and panel surfaces are unified', /\.card,\.bf-panel,\.bf-block/.test(runtime) && /--vx-admin-shadow/.test(runtime)],
  ['section headers use one light treatment', /\.vx-unified-head/.test(runtime) && /linear-gradient\(180deg,#FFFFFF/.test(runtime)],
  ['tabs share one segmented treatment', /\.module-tabs,\.bf-tabs,\.profile-tabs/.test(runtime) && /\.vx-module-tab/.test(runtime)],
  ['empty states are normalized', /patchEmptyStates/.test(runtime) && /vx-empty-success/.test(runtime)],
  ['tablet drawer starts at 1024px', /@media\(max-width:1024px\)/.test(runtime) && /mobile-menu-btn/.test(runtime)],
  ['phone layout has 768 and 480 breakpoints', /@media\(max-width:768px\)/.test(runtime) && /@media\(max-width:480px\)/.test(runtime)],
  ['mobile tabs scroll horizontally', /overflow-x:auto!important/.test(runtime) && /-webkit-overflow-scrolling:touch/.test(runtime)],
  ['mobile modals become bounded bottom sheets', /max-height:calc\(100dvh/.test(runtime) && /border-radius:18px 18px 0 0/.test(runtime)],
  ['mobile toolbars collapse to one column', /\.toolbar,\.filter-bar,\.vx-toolbar/.test(runtime) && /grid-template-columns:minmax\(0,1fr\)/.test(runtime)],
  ['runtime patches dynamic content', /new MutationObserver/.test(runtime) && /patch\(document\)/.test(runtime)],
  ['design runtime loads after invoice and lifecycle runtimes', loader.indexOf('admin-runtime-design-system-v2.js') > loader.indexOf('admin-runtime-invoice-adjustments.js')]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) process.exit(1);
console.log(`Admin design system V2 verification passed: ${checks.length} checks.`);
