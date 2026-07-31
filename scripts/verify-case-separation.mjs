import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const customerTasks = read('customer-dashboard/netlify/functions/cases-create.js');
const supportRequest = read('customer-dashboard/netlify/functions/support-request-create.js');
const assistantRequest = read('customer-dashboard/netlify/functions/ai-change-request-create.js');
const operationalHelper = read('customer-dashboard/netlify/functions/_lib/create-operational-case.js');
const migration = read('supabase/sql/2026-07-31_operational_case_sources.sql');

const checks = [
  ['Customer follow-ups remain customer_tasks', customerTasks.includes(".from('customer_tasks')") && !customerTasks.includes(".from('voxera_cases')")],
  ['Support requests use operational cases', supportRequest.includes("insertOperationalCase") && !supportRequest.includes("customer_tasks")],
  ['Assistant changes create request and operational case', assistantRequest.includes(".from('ai_change_requests')") && assistantRequest.includes('insertOperationalCase')],
  ['Operational helper writes voxera_cases', operationalHelper.includes(".from('voxera_cases')")],
  ['Migration documents customer_tasks exclusion', migration.includes('customer_tasks are intentionally excluded')],
  ['Assistant status is synchronized from case', migration.includes('sync_ai_change_request_from_case')]
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
