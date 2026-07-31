import fs from 'node:fs';

const hotfix = fs.readFileSync('admin-panel/shared/admin-runtime-cases-state-hotfix.js', 'utf8');
const usability = fs.readFileSync('admin-panel/shared/admin-runtime-cases-usability-fix.js', 'utf8');
const loader = fs.readFileSync('admin-panel/shared/offer-brand.js', 'utf8');
const statusModel = fs.readFileSync('admin-panel/netlify/functions/_lib/status-model.js', 'utf8');

const checks = [
  ['Hotfix resolves the lexical Admin state instead of assuming window.state', hotfix.includes("typeof state !== 'undefined'") && hotfix.includes('w.state = current')],
  ['Explicit admin queue scope wins over due-date heuristics', hotfix.includes("if (scope === 'admin') return true;")],
  ['Customer follow-up queue scope is excluded', hotfix.includes("if (scope === 'customer_followup') return false;")],
  ['Admin case creation uses the dedicated endpoint', hotfix.includes("adminCall('cases-create-admin'")],
  ['Case status updates preserve and re-render the returned database row', hotfix.includes("adminCall('cases-update'") && hotfix.includes('const merged = mergeDbCase(json.case)') && hotfix.includes('renderCasesFixed();')],
  ['Case due-date updates use the dedicated endpoint', hotfix.includes("adminCall('cases-due-update'")],
  ['Reset is intercepted before legacy listeners and clears both filters', usability.includes("document.addEventListener('click', resetCaseFilters, true)") && usability.includes('event.stopImmediatePropagation()') && usability.includes("type.value = 'all'")],
  ['Cases page copy no longer describes Customer follow-ups', usability.includes('Interne Aufgaben, Support-Anfragen und administrative Wiedervorlagen.')],
  ['Cases page copy is changed idempotently', usability.includes('function setTextIfChanged') && usability.includes('node.textContent !== next')],
  ['Mutation callbacks are coalesced instead of recursively patching', usability.includes('if (patchScheduled) return;') && usability.includes('requestAnimationFrame')],
  ['Open cases can be completed directly', statusModel.includes("[STATUS.case.OPEN]: new Set([STATUS.case.IN_PROGRESS, STATUS.case.WAITING, STATUS.case.DONE])")],
  ['Completed cases can be reopened', statusModel.includes("[STATUS.case.DONE]: new Set([STATUS.case.OPEN, STATUS.case.IN_PROGRESS])")],
  ['The Admin bootstrap loads the state hotfix after operations', loader.includes('/shared/admin-runtime-cases-state-hotfix.js') && loader.indexOf('/shared/admin-runtime-cases-state-hotfix.js') > loader.indexOf('/shared/admin-runtime-operations-v3.js')],
  ['The usability fix is loaded last with the freeze-fix cache version', loader.includes('/shared/admin-runtime-cases-usability-fix.js?v=20260731-2') && loader.indexOf('/shared/admin-runtime-cases-usability-fix.js') > loader.indexOf('/shared/admin-runtime-cases-state-hotfix.js')]
];

let failed = false;
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
  if (!passed) failed = true;
}

if (failed) process.exit(1);
