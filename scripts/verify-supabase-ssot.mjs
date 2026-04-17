#!/usr/bin/env node
import { execSync } from 'node:child_process';

const checks = [];

function sh(cmd) {
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return { ok: true, out };
  } catch (err) {
    return {
      ok: false,
      out: err.stdout ? err.stdout.toString() : '',
      err: err.stderr ? err.stderr.toString() : err.message
    };
  }
}

function pass(name, details = '') { checks.push({ ok: true, name, details }); }
function fail(name, details = '') { checks.push({ ok: false, name, details }); }

const disallowedApi = sh("rg -n \"api\\.airtable\\.com\" admin-panel admin-panel/netlify/functions --glob '!**/node_modules/**'");
if (disallowedApi.ok && disallowedApi.out.trim()) fail('Admin contains Airtable API endpoint reference', disallowedApi.out.trim());
else pass('Admin has no Airtable API endpoint reference');

const adminTables = ['customers', 'calls', 'cases'];
for (const table of adminTables) {
  const res = sh(`rg -n "\\.from\\('${table}'\\)" admin-panel/index.html`);
  if (res.ok && res.out.trim()) pass(`Admin frontend reads ${table} from Supabase`);
  else fail(`Admin frontend missing Supabase read for ${table}`);
}

for (const table of adminTables) {
  const res = sh(`rg -n "\\.from\\('${table}'\\)" customer-dashboard --glob '!**/node_modules/**'`);
  if (res.ok && res.out.trim()) pass(`Customer surface reads ${table} from Supabase`);
  else fail(`Customer surface missing Supabase read for ${table}`);
}

const writeFns = [
  'admin-panel/netlify/functions/admin-mutate.js',
  'admin-panel/netlify/functions/cases-create.js',
  'admin-panel/netlify/functions/cases-update.js',
  'admin-panel/netlify/functions/create-customer.js'
];
for (const file of writeFns) {
  const usesSupabase = sh(`rg -n \"@supabase/supabase-js|createClient\" ${file}`);
  if (usesSupabase.ok && usesSupabase.out.trim()) pass('Admin write path is Supabase-backed', file);
  else fail('Admin write path missing Supabase client usage', file);

  const hasAirtableApi = sh(`rg -n \"api\\.airtable\\.com\" ${file}`);
  if (hasAirtableApi.ok && hasAirtableApi.out.trim()) fail('Admin write path references Airtable API', file);
  else pass('Admin write path has no Airtable API reference', file);
}

const adminCallsNoMonthFilter = sh("rg -n \"\\.gte\\('created_at',\\s*monthStartIso\\)\" admin-panel/index.html");
if (adminCallsNoMonthFilter.ok && adminCallsNoMonthFilter.out.trim()) fail('Admin calls query still uses implicit month filter', adminCallsNoMonthFilter.out.trim());
else pass('Admin calls query has no implicit month filter');

const adminCasesNoLimit = sh("rg -n \"\\.limit\\(500\\)\" admin-panel/index.html");
if (adminCasesNoLimit.ok && adminCasesNoLimit.out.trim()) fail('Admin cases query still uses implicit slice limit', adminCasesNoLimit.out.trim());
else pass('Admin cases query has no implicit slice limit');

const dashboardCallsNoLimit = sh("rg -n \"\\.limit\\(500\\)\" customer-dashboard/index.html");
if (dashboardCallsNoLimit.ok && dashboardCallsNoLimit.out.trim()) fail('Dashboard calls query still uses implicit slice limit', dashboardCallsNoLimit.out.trim());
else pass('Dashboard calls query has no implicit slice limit');

const dashboardCasesUpdatedOrder = sh("rg -n \"\\.order\\('updated_at',\\s*\\{\\s*ascending:\\s*false\\s*\\}\\)\" customer-dashboard/index.html");
if (dashboardCasesUpdatedOrder.ok && dashboardCasesUpdatedOrder.out.trim()) pass('Dashboard cases query orders by updated_at for parity');
else fail('Dashboard cases query missing updated_at ordering');

const contractWizardLocalFallback = sh("rg -n \"newId = crypto\\.randomUUID|local-state-only|Object\\.assign\\(\\{id: newId\\}, payload\\)\" admin-panel/index.html");
if (contractWizardLocalFallback.ok && contractWizardLocalFallback.out.trim()) fail('Contract wizard still contains local-only write fallback branch', contractWizardLocalFallback.out.trim());
else pass('Contract wizard has no local-only write fallback branch');

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  const icon = entry.ok ? '✅' : '❌';
  const tail = entry.details ? ` (${entry.details})` : '';
  console.log(`${icon} ${entry.name}${tail}`);
}

if (failed.length) {
  console.error(`\nSSOT verification failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nSSOT verification passed: ${checks.length} checks.`);
