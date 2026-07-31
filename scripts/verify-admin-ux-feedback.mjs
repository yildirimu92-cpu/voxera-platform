import fs from 'node:fs';

const files = {
  ui: fs.readFileSync('admin-panel/shared/admin-runtime-ui.js', 'utf8'),
  navigation: fs.readFileSync('admin-panel/shared/admin-runtime-navigation.js', 'utf8'),
  cases: fs.readFileSync('admin-panel/shared/admin-runtime-cases.js', 'utf8')
};

const checks = [
  ['Cockpit MRR is derived only from live customers', files.ui.includes("const liveCustomers = customers.filter(c => life(c) === 'live');") && files.ui.includes('const mrr = liveCustomers.reduce')],
  ['Onboarding ignores customer portal activation for operational completion', files.ui.includes('isPortalActivationStep') && files.ui.includes("return 'activated';")],
  ['Customer workspace uses the new light header treatment', files.ui.includes('#cw-header{background:linear-gradient')],
  ['Sales header is no longer sticky', files.navigation.includes('#offer-detail-shell .offer-header-card{position:static!important')],
  ['Billing customer shortcut applies an exact customer filter', files.navigation.includes('billingCustomerId') && files.navigation.includes('state.invoices = (originalRows || []).filter')],
  ['Contract customer shortcut applies an exact customer filter', files.navigation.includes('contractsCustomerId') && files.navigation.includes('state.contracts = (originalRows || []).filter')],
  ['Cases navigation is restored', files.cases.includes('function ensureCasesNavigation()') && files.cases.includes('Cases & Support')],
  ['Assistant change requests render inline', files.cases.includes('function renderAssistantRequestsInline()') && !files.cases.includes('Zu den Assistenten-Cases')]
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
