import fs from 'node:fs';

const files = {
  ui: fs.readFileSync('admin-panel/shared/admin-runtime-ui.js', 'utf8'),
  navigation: fs.readFileSync('admin-panel/shared/admin-runtime-navigation.js', 'utf8'),
  cases: fs.readFileSync('admin-panel/shared/admin-runtime-cases.js', 'utf8'),
  adminOnlyCases: fs.readFileSync('admin-panel/shared/admin-runtime-cases-admin-only.js', 'utf8'),
  mobile: fs.readFileSync('admin-panel/shared/admin-runtime-mobile.js', 'utf8'),
  loader: fs.readFileSync('admin-panel/shared/offer-brand.js', 'utf8')
};

const checks = [
  ['Cockpit MRR is derived only from live customers', files.ui.includes("const liveCustomers = customers.filter(c => life(c) === 'live');") && files.ui.includes('const mrr = liveCustomers.reduce')],
  ['Onboarding ignores customer portal activation for operational completion', files.ui.includes('isPortalActivationStep') && files.ui.includes("return 'activated';")],
  ['Customer workspace uses the new light header treatment', files.ui.includes('#cw-header{background:linear-gradient')],
  ['Sales header is no longer sticky', files.navigation.includes('#offer-detail-shell .offer-header-card{position:static!important')],
  ['Billing customer shortcut applies an exact customer filter', files.navigation.includes('billingCustomerId') && files.navigation.includes('state.invoices = (originalRows || []).filter')],
  ['Contract customer shortcut applies an exact customer filter', files.navigation.includes('contractsCustomerId') && files.navigation.includes('state.contracts = (originalRows || []).filter')],
  ['Cases navigation is restored', files.cases.includes('function ensureCasesNavigation()') && files.cases.includes('Cases & Support')],
  ['Cases heading uses explicit light surface contrast', files.cases.includes('vox-cases-head') && files.cases.includes("title.style.color = 'var(--ink)'")],
  ['Legacy follow-ups are excluded from operational Cases', files.cases.includes('function isCustomerFollowUp(row)') && files.cases.includes('filter(row => !isCustomerFollowUp(row))')],
  ['Strict admin queue admits only operational case categories', files.adminOnlyCases.includes('function isAdminQueueCase(row)') && files.adminOnlyCases.includes("if (type === 'customer_support') return true") && files.adminOnlyCases.includes("if (type === 'assistant_change') return true") && files.adminOnlyCases.includes("if (type !== 'internal_task') return false")],
  ['Customer Portal internal tasks are excluded from Admin Cases', files.adminOnlyCases.includes("source.startsWith('customer_portal')") && files.adminOnlyCases.includes("origin === 'customer_dashboard'")],
  ['Call follow-up evidence is excluded from Admin Cases', files.adminOnlyCases.includes('hasCallReference') && files.adminOnlyCases.includes('hasDueOrPhone') && files.adminOnlyCases.includes('followUpLanguage')],
  ['Cockpit and customer views use the same strict case filter', files.adminOnlyCases.includes("'renderOverview'") && files.adminOnlyCases.includes("'renderCustomerWorkspace'") && files.adminOnlyCases.includes('withAdminCases')],
  ['Admin-only case runtime is loaded by the Admin bootstrap', files.loader.includes('/shared/admin-runtime-cases-admin-only.js')],
  ['Assistant change requests render inline', files.cases.includes('function renderAssistantRequestsInline()') && !files.cases.includes('Zu den Assistenten-Cases')],
  ['Mobile tables become labelled cards', files.mobile.includes('data-mobile-label') && files.mobile.includes('table.vox-mobile-table tbody tr')],
  ['Mobile layout prevents page-level horizontal overflow', files.mobile.includes('overflow-x:hidden!important') && files.mobile.includes('grid-template-columns:minmax(0,1fr)!important')],
  ['Mobile runtime is loaded by the Admin bootstrap', files.loader.includes('/shared/admin-runtime-mobile.js')]
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
