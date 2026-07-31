import fs from 'node:fs';

const hotfix = fs.readFileSync('admin-panel/shared/admin-runtime-cases-state-hotfix.js', 'utf8');
const loader = fs.readFileSync('admin-panel/shared/offer-brand.js', 'utf8');

const checks = [
  ['Hotfix resolves the lexical Admin state instead of assuming window.state', hotfix.includes("typeof state !== 'undefined'") && hotfix.includes('w.state = current')],
  ['Explicit admin queue scope wins over due-date heuristics', hotfix.includes("if (scope === 'admin') return true;")],
  ['Customer follow-up queue scope is excluded', hotfix.includes("if (scope === 'customer_followup') return false;")],
  ['Admin case creation uses the dedicated endpoint', hotfix.includes("adminCall('cases-create-admin'")],
  ['Case status updates preserve and re-render the returned database row', hotfix.includes("adminCall('cases-update'") && hotfix.includes('const merged = mergeDbCase(json.case)') && hotfix.includes('renderCasesFixed();')],
  ['Case due-date updates use the dedicated endpoint', hotfix.includes("adminCall('cases-due-update'")],
  ['The Admin bootstrap loads the state hotfix last', loader.includes('/shared/admin-runtime-cases-state-hotfix.js') && loader.indexOf('/shared/admin-runtime-cases-state-hotfix.js') > loader.indexOf('/shared/admin-runtime-operations-v3.js')]
];

let failed = false;
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
  if (!passed) failed = true;
}

if (failed) process.exit(1);
