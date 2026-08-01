import fs from 'node:fs';
import vm from 'node:vm';

const runtimePath = 'admin-panel/shared/admin-runtime-operations-v3.js';
const createPath = 'admin-panel/netlify/functions/cases-create-admin.js';
const duePath = 'admin-panel/netlify/functions/cases-due-update.js';
const loaderPath = 'admin-panel/shared/offer-brand.js';
const migrationPath = 'supabase/sql/2026-07-31_admin_case_queue_and_due_dates.sql';

for (const path of [runtimePath, createPath, duePath]) {
  new vm.Script(fs.readFileSync(path, 'utf8'), { filename: path });
  console.log(`PASS syntax ${path}`);
}

const runtime = fs.readFileSync(runtimePath, 'utf8');
const createFn = fs.readFileSync(createPath, 'utf8');
const dueFn = fs.readFileSync(duePath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');

const checks = [
  ['Customer follow-ups are excluded from Admin state', runtime.includes('function followUpEvidence') && runtime.includes('w.state.cases = w.state.cases.filter(isAdminCase)')],
  ['Case modal defaults to 24 hours', runtime.includes('Date.now() + 86400000') && runtime.includes('case-capture-due-at')],
  ['Case due date can be changed inline', runtime.includes("callAdminFunction('cases-due-update'")],
  ['Admin cases use explicit queue metadata', createFn.includes("case_type: 'internal_task'") && createFn.includes("source: 'admin_portal'") && createFn.includes("queue_scope: 'admin'")],
  ['Canonical dunning fields drive reminder state', runtime.includes('reminder_level') && runtime.includes('final_reminder_sent_at') && runtime.includes('getInvoiceDunningEligibility')],
  ['Final warnings create an escalation worklist only at suspension review', runtime.includes("stage === 'suspension_review'") && runtime.includes('Letzte Warnung versendet · Sperrung prüfen')],
  ['Billing suspension requires confirmation', runtime.includes("voxConfirm") && runtime.includes("status:'paused'")],
  ['Queue separation migration exists', migration.includes("queue_scope") && migration.includes("customer_followup")],
  ['Operations runtime is loaded', loader.includes('/shared/admin-runtime-operations-v3.js')],
  ['Due update validates the date', dueFn.includes('Ungültiges Fälligkeitsdatum')]
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
