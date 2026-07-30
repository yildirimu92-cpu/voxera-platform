#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

const paths = {
  migration: new URL('../supabase/migrations/2026-07-30_admin_controlled_cancellation_requests.sql', import.meta.url),
  customerFrontend: new URL('../customer-dashboard/index.html', import.meta.url),
  customerEndpoint: new URL('../customer-dashboard/netlify/functions/customer-cancel-contract.js', import.meta.url),
  adminFrontend: new URL('../admin-panel/index.html', import.meta.url),
  adminEndpoint: new URL('../admin-panel/netlify/functions/admin-cancellation-request.js', import.meta.url)
};

const [
  migration,
  customerFrontend,
  customerEndpoint,
  adminFrontend,
  adminEndpoint
] = await Promise.all(Object.values(paths).map(path => readFile(path, 'utf8')));

const checks = [
  [
    'cancellation requests use a dedicated lifecycle table',
    /create table if not exists public\.cancellation_requests/i.test(migration)
      && /status in \('pending', 'processing', 'approved', 'rejected', 'withdrawn', 'finalized'\)/i.test(migration)
      && /processing_action is null or processing_action in \('approve', 'finalize'\)/i.test(migration)
  ],
  [
    'a contract can have only one operational cancellation request',
    /create unique index if not exists ux_cancellation_requests_open_contract[\s\S]*?where status in \('pending', 'processing', 'approved'\)/i.test(migration)
  ],
  [
    'request table is RLS protected and direct customer mutations are revoked',
    /enable row level security/i.test(migration)
      && /force row level security/i.test(migration)
      && /revoke all on table public\.cancellation_requests from anon/i.test(migration)
      && /revoke insert, update, delete on table public\.cancellation_requests from authenticated/i.test(migration)
      && /using \(public\.is_admin\(auth\.uid\(\)\)\)/i.test(migration)
  ],
  [
    'customer endpoint authenticates and exposes request/status/withdraw actions only',
    /requireCustomerCaller/.test(customerEndpoint)
      && /\['status', 'request_cancel', 'withdraw_request'\]\.includes\(action\)/.test(customerEndpoint)
      && !/action\s*===\s*['"]cancel['"]/.test(customerEndpoint)
      && !/action\s*===\s*['"]reactivate['"]/.test(customerEndpoint)
  ],
  [
    'customer endpoint is tenant bound and never mutates contracts',
    /\.eq\('customer_id', caller\.customerId\)/.test(customerEndpoint)
      && !/\.from\('contracts'\)/.test(customerEndpoint)
      && !/executeCommercialCommand/.test(customerEndpoint)
  ],
  [
    'customer request creation is idempotent and withdrawal is pending-only',
    /createError\.code === '23505'/.test(customerEndpoint)
      && /\.eq\('status', 'pending'\)/.test(customerEndpoint)
      && /Der Antrag wird bereits bearbeitet/.test(customerEndpoint)
  ],
  [
    'customer portal uses the authenticated function and shows explicit request states',
    /callDashboardFunction\('customer-cancel-contract'/.test(customerFrontend)
      && /action:\s*'request_cancel'/.test(customerFrontend)
      && /action:\s*'withdraw_request'/.test(customerFrontend)
      && /Zur Prüfung eingereicht/.test(customerFrontend)
      && /Genehmigt/.test(customerFrontend)
      && !/\/\.netlify\/functions\/customer-cancel-contract/.test(customerFrontend)
  ],
  [
    'admin endpoint requires contract write capability',
    /requireAdminCaller/.test(adminEndpoint)
      && /requiredCapability:\s*'contract:write'/.test(adminEndpoint)
  ],
  [
    'admin approval schedules cancellation through the commercial orchestrator',
    /command:\s*'contracts\.update'/.test(adminEndpoint)
      && /cancellation_date:\s*effectiveAt/.test(adminEndpoint)
      && /termination_type:\s*'customer_request_approved'/.test(adminEndpoint)
  ],
  [
    'only a due approved request can finalize the contract',
    /Nur eine genehmigte Kündigung kann abgeschlossen werden/.test(adminEndpoint)
      && /effectiveAt\.getTime\(\) > Date\.now\(\)/.test(adminEndpoint)
      && /command:\s*'contracts\.cancel'/.test(adminEndpoint)
  ],
  [
    'admin processing locks make approval and finalization recoverable',
    /setProcessing\(sbAdmin, requestId, 'pending', 'approve'\)/.test(adminEndpoint)
      && /setProcessing\(sbAdmin, requestId, 'approved', 'finalize'\)/.test(adminEndpoint)
      && /restoreRequestStatus\(sbAdmin, requestId, 'pending'\)/.test(adminEndpoint)
      && /restoreRequestStatus\(sbAdmin, requestId, 'approved'\)/.test(adminEndpoint)
  ],
  [
    'admin portal exposes review, reject, approve and due-date finalization',
    /id="cancellation-requests-card"/.test(adminFrontend)
      && /callAdminFunction\('admin-cancellation-request'/.test(adminFrontend)
      && /adminReviewCancellationRequest/.test(adminFrontend)
      && /Genehmigen/.test(adminFrontend)
      && /Ablehnen/.test(adminFrontend)
      && /Vertrag beenden/.test(adminFrontend)
  ],
  [
    'legacy customer cancellation notification side effect is removed',
    !/customer-cancelled/.test(customerFrontend)
      && !/action:\s*['"]cancel['"]/.test(customerFrontend)
      && !/action:\s*['"]reactivate['"]/.test(customerFrontend)
  ]
];

let failed = 0;
for (const [name, ok] of checks) {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(status + ' ' + name);
  if (!ok) failed += 1;
}

if (failed > 0) {
  console.error('\n' + failed + ' admin-controlled cancellation verification check(s) failed.');
  process.exit(1);
}

console.log('\nAll ' + checks.length + ' admin-controlled cancellation checks passed.');
