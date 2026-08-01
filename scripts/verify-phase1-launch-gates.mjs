#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

const paths = {
  migration: new URL('../supabase/migrations/2026-07-29_manual_admin_go_live_gate.sql', import.meta.url),
  frontend: new URL('../admin-panel/index.html', import.meta.url),
  endpoint: new URL('../admin-panel/netlify/functions/customer-go-live.js', import.meta.url),
  requireAdmin: new URL('../admin-panel/netlify/functions/_lib/require-admin.js', import.meta.url),
  onboarding: new URL('../admin-panel/netlify/functions/onboarding-update.js', import.meta.url),
  statusUpdate: new URL('../admin-panel/netlify/functions/customer-status-update.js', import.meta.url),
  subscription: new URL('../admin-panel/netlify/functions/activate-subscription.js', import.meta.url),
  access: new URL('../admin-panel/netlify/functions/send-customer-access.js', import.meta.url),
  statusModel: new URL('../admin-panel/netlify/functions/_lib/status-model.js', import.meta.url)
};

const [
  migration,
  frontend,
  endpoint,
  requireAdmin,
  onboarding,
  statusUpdate,
  subscription,
  access,
  statusModel
] = await Promise.all(Object.values(paths).map(path => readFile(path, 'utf8')));

const checks = [
  [
    'historical test-call auto-live trigger is removed',
    /drop trigger if exists trg_customer_auto_live_after_test_call/i.test(migration)
      && /drop function if exists public\.fn_customer_auto_live_after_test_call\(\)/i.test(migration)
  ],
  [
    'lifecycle approvals are audited in a service-role-only table',
    /create table if not exists public\.customer_lifecycle_events/i.test(migration)
      && /enable row level security/i.test(migration)
      && /revoke all privileges on table public\.customer_lifecycle_events from authenticated/i.test(migration)
      && /grant all privileges on table public\.customer_lifecycle_events to service_role/i.test(migration)
  ],
  [
    'approval and activation RPCs are service-role-only and role checked',
    /create or replace function public\.admin_approve_customer_go_live/i.test(migration)
      && /create or replace function public\.admin_activate_customer_go_live/i.test(migration)
      && /v_actor_role not in \('owner', 'admin'\)/i.test(migration)
      && /grant execute on function public\.admin_approve_customer_go_live[\s\S]*?to service_role/i.test(migration)
      && /grant execute on function public\.admin_activate_customer_go_live[\s\S]*?to service_role/i.test(migration)
  ],
  [
    'go-live endpoint requires lifecycle approval capability',
    /requiredCapability:\s*'lifecycle:approve'/.test(endpoint)
  ],
  [
    'go-live endpoint enforces commercial, onboarding, telephony and AI gates',
    /MASTER_FIELDS/.test(endpoint)
      && /acceptedOfferLinkedToActiveContract/.test(endpoint)
      && /STATUS\.onboarding\.BLOCKED/.test(endpoint)
      && /Voxera-Rufnummer ist nicht zugewiesen/.test(endpoint)
      && /ElevenLabs Agent-ID fehlt/.test(endpoint)
      && /AI_FIELDS/.test(endpoint)
  ],
  [
    'manual checklist includes conditional calendar validation',
    /REQUIRED_MANUAL_CHECKS/.test(endpoint)
      && /calendar_required/.test(endpoint)
      && /calendar_tested/.test(endpoint)
      && /missingManualChecks/.test(endpoint)
  ],
  [
    'final go-live revalidates approval and only accepts activated or paused customers',
    /Go-live-Gate ist seit der Freigabe nicht mehr vollständig erfüllt/.test(endpoint)
      && /STATUS\.customer\.ACTIVATED/.test(endpoint)
      && /STATUS\.customer\.PAUSED/.test(endpoint)
      && /admin_activate_customer_go_live/.test(endpoint)
  ],
  [
    'admin frontend exposes the approval and go-live workflow',
    /goLiveModal/.test(frontend)
      && /callAdminFunction\('customer-go-live'/.test(frontend)
      && /Admin-Freigabe/.test(frontend)
      && /Kunde live schalten/.test(frontend)
  ],
  [
    'customer access UI separates early portal invite from protected go-live',
    /ACCESS_INVITE_REQUIRED_FIELDS=\['email'\]/.test(frontend)
      && /Einrichtung und der Go-live bleiben separate Schritte/.test(frontend)
      && /showApproval:!approved/.test(frontend)
      && /showSendAccess:true/.test(frontend)
  ],
  [
    'internal onboarding ends with customer handoff while go-live remains separate',
    /checklist:\['customer created','Voxera number assigned','AI basics configured','agent configured','activation sent'\]/.test(frontend)
      && !/checklist:\[[^\]]*'test call completed'/.test(frontend)
      && /'activation sent':'Zugang an Kunden gesendet'/.test(frontend)
      && /operationalOnboardingStatus=missingSteps\.length===0/.test(frontend)
      && /Kundeneinrichtung abwarten/.test(frontend)
      && /Kundeneinrichtung und Test begleiten/.test(frontend)
  ],
  [
    'onboarding completion cannot promote customer lifecycle to live',
    /only customer-go-live may do that/.test(onboarding)
      && !/STATUS\.customer\.LIVE/.test(onboarding)
      && !/status:\s*['"]live['"]/.test(onboarding)
  ],
  [
    'generic customer status endpoint blocks direct live transitions',
    /targetStatus === STATUS\.customer\.LIVE/.test(statusUpdate)
      && /required_endpoint:\s*'customer-go-live'/.test(statusUpdate)
  ],
  [
    'subscription activation has no access-send or go-live side effect',
    /lifecycle_unchanged:\s*true/.test(subscription)
      && !/send-customer-access/.test(subscription)
      && !/STATUS\.customer\.LIVE/.test(subscription)
      && !/status:\s*['"]live['"]/.test(subscription)
  ],
  [
    'customer access invite is allowed during setup while lifecycle claim stays exact',
    /ACCESS_INVITE_CUSTOMER_STATUSES/.test(access)
      && /STATUS\.customer\.ONBOARDING/.test(access)
      && /STATUS\.customer\.READY/.test(access)
      && /warnings\.push\('Admin-Freigabe für den späteren Go-live fehlt noch\.'\)/.test(access)
      && /\.eq\('status', freshCustomer\.status\)/.test(access)
      && /invite_status:\s*'sending'/.test(access)
      && /\[STATUS\.customer\.READY, STATUS\.customer\.INVITED/.test(statusModel)
  ],
  [
    'customer access does not mutate subscriptions',
    !/\.from\('subscriptions'\)/.test(access)
  ],
  [
    'owner and admin may approve lifecycle while support may not',
    /owner:\s*new Set\([^\n]*'lifecycle:approve'/.test(requireAdmin)
      && /admin:\s*new Set\([^\n]*'lifecycle:approve'/.test(requireAdmin)
      && /support:\s*new Set\(\['customer:write'\]\)/.test(requireAdmin)
  ]
];

let failed = 0;
for (const [name, ok] of checks) {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`${status} ${name}`);
  if (!ok) failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed} Phase 1 launch-gate verification check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} Phase 1 launch-gate checks passed.`);
