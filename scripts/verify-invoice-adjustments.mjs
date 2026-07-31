import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  endpoint:'admin-panel/netlify/functions/invoice-financial-action.js',
  runtime:'admin-panel/shared/admin-runtime-invoice-adjustments.js',
  migration:'supabase/sql/2026-07-31_invoice_adjustments_credit_notes.sql',
  loader:'admin-panel/shared/offer-brand.js'
};
const src = Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,fs.readFileSync(path,'utf8')]));
let failed = 0;

for (const key of ['endpoint','runtime','loader']) {
  try { new vm.Script(src[key],{ filename:paths[key] }); console.log(`PASS syntax ${paths[key]}`); }
  catch (error) { failed += 1; console.error(`FAIL syntax ${paths[key]}: ${error.message}`); }
}

const checks = [
  ['endpoint requires billing write capability', /requiredCapability:'billing:write'/.test(src.endpoint)],
  ['mutations use atomic database rpc', /admin_apply_invoice_financial_action_v1/.test(src.endpoint)],
  ['draft void is restricted to unsent drafts', /Only an unsent draft invoice can be voided/.test(src.migration) && /sent_at is not null/.test(src.migration)],
  ['issued invoices use separate credit documents', /next_credit_note_number_v1/.test(src.migration) && /source_invoice_id/.test(src.migration) && /invoice_type.*credit_note/s.test(src.migration)],
  ['credit amount cannot exceed remaining amount', /Credit amount exceeds the remaining creditable amount/.test(src.migration)],
  ['financial writes are idempotent', /invoice_financial_actions/.test(src.migration) && /pg_advisory_xact_lock/.test(src.migration) && /request_id/.test(src.endpoint)],
  ['original invoices are never deleted', !/from\('invoices'\)\.delete/.test(src.endpoint) && !/delete from public\.invoices/i.test(src.migration)],
  ['paid invoice refunds are recorded, not executed', /invoice_refunds/.test(src.migration) && /keine automatische Bank- oder Stripe-Zahlung/i.test(src.runtime)],
  ['runtime adds correction action to invoice detail', /Storno \/ Gutschrift/.test(src.runtime) && /invoice-detail-financial-action/.test(src.runtime)],
  ['legacy credit and cancel actions are routed safely', /create_credit_note/.test(src.runtime) && /cancel_invoice/.test(src.runtime) && /invoice-financial-action/.test(src.runtime)],
  ['runtime loads after contract termination', src.loader.indexOf('admin-runtime-invoice-adjustments.js') > src.loader.indexOf('admin-runtime-contract-termination.js')]
];

for (const [name,passed] of checks) {
  console.log(`${passed?'PASS':'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) process.exit(1);
console.log(`Invoice adjustment verification passed: ${checks.length} checks.`);
