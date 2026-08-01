#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

const paths = {
  migration: new URL('../supabase/migrations/2026-07-28_p0_security_foundation.sql', import.meta.url),
  serverAudio: new URL('../customer-dashboard/netlify/functions/elevenlabs-conversation-audio.js', import.meta.url),
  clientAudio: new URL('../customer-dashboard/shared/offer-brand.js', import.meta.url),
  dashboard: new URL('../customer-dashboard/index.html', import.meta.url),
  preflight: new URL('../supabase/verification/p0_security_preflight.sql', import.meta.url),
  postflight: new URL('../supabase/verification/p0_security_post_migration.sql', import.meta.url),
  adminIndex: new URL('../admin-panel/index.html', import.meta.url),
  adminSync: new URL('../admin-panel/netlify/functions/trigger-elevenlabs-sync.js', import.meta.url),
  adminPromptSyncGuard: new URL('../admin-panel/netlify/functions/_lib/require-prompt-sync-caller.js', import.meta.url),
  adminProvision: new URL('../admin-panel/netlify/functions/elevenlabs-provision-agent.js', import.meta.url),
  adminAiApply: new URL('../admin-panel/netlify/functions/ai-apply-change.js', import.meta.url),
  adminScrape: new URL('../admin-panel/netlify/functions/scrape-website.js', import.meta.url),
  customerDuplicateAiApply: new URL('../customer-dashboard/netlify/functions/ai-apply-change.js', import.meta.url),
  callIntake: new URL('../customer-dashboard/netlify/functions/call-intake-webhook.js', import.meta.url),
  retentionJob: new URL('../customer-dashboard/netlify/functions/enforce-data-retention.js', import.meta.url),
  customerNetlify: new URL('../customer-dashboard/netlify.toml', import.meta.url)
};

const [
  migration,
  serverAudio,
  clientAudio,
  dashboard,
  preflight,
  postflight,
  adminIndex,
  adminSync,
  adminPromptSyncGuard,
  adminProvision,
  adminAiApply,
  adminScrape,
  customerDuplicateAiApply,
  callIntake,
  retentionJob,
  customerNetlify
] = await Promise.all(
  Object.values(paths).map(path => readFile(path, 'utf8'))
);

function taggedBody(source, tag) {
  const pattern = new RegExp(`as \\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$;`, 'i');
  const match = source.match(pattern);
  return match ? match[1] : '';
}

const ensureBody = taggedBody(migration, 'ensure_user_profile');
const isAdminBody = taggedBody(migration, 'is_admin');
const directProtectedAudioSrc = /(?:<audio[^>]+src|audio\.src\s*=)[^\n>]*elevenlabs-conversation-audio/i;

const checks = [
  ['admin sync requires authorized customer write',
    /requirePromptSyncCaller/.test(adminSync)
      && /requestedCustomerId:\s*customer_id/.test(adminSync)
      && /requireAdminCaller/.test(adminPromptSyncGuard)
      && /requiredCapability:\s*'customer:write'/.test(adminPromptSyncGuard)
  ],
  ['customer prompt sync is tenant-bound',
    /auth\.getUser\(token\)/.test(adminPromptSyncGuard)
      && /\.from\('users'\)/.test(adminPromptSyncGuard)
      && /\.eq\('id', userId\)/.test(adminPromptSyncGuard)
      && /customerId !== String\(requestedCustomerId \|\| ''\)\.trim\(\)/.test(adminPromptSyncGuard)
      && /guard_customer_mismatch/.test(adminPromptSyncGuard)
  ],
  ['admin provisioning requires authorized customer write', /requireAdminCaller/.test(adminProvision) && /requiredCapability: 'customer:write'/.test(adminProvision)],
  ['admin provisioning propagates auth to internal sync', /'Authorization': authHeader/.test(adminProvision)],
  ['admin AI change generation requires authorized customer write', /requireAdminCaller/.test(adminAiApply) && /requiredCapability: 'customer:write'/.test(adminAiApply)],
  ['admin website extraction requires authorized customer write', /requireAdminCaller/.test(adminScrape) && /requiredCapability: 'customer:write'/.test(adminScrape)],
  ['admin website extraction exports Netlify handler', /module\.exports\s*=\s*\{[\s\S]*?\bhandler\b/.test(adminScrape)],
  ['admin website extraction pins validated DNS and revalidates redirects', /dns\.lookup/.test(adminScrape) && /lookup:\s*createPinnedLookup/.test(adminScrape) && /return fetchWebsite\(new URL\(location, target\)\.toString\(\), redirectCount \+ 1\)/.test(adminScrape) && /private_target/.test(adminScrape)],
  ['admin website extraction limits response size', /MAX_RESPONSE_BYTES = 1_000_000/.test(adminScrape) && /website_too_large/.test(adminScrape)],
  ['admin privileged calls use authenticated helper', ['elevenlabs-provision-agent', 'trigger-elevenlabs-sync', 'ai-apply-change', 'scrape-website'].every(name => adminIndex.includes("callAdminFunction('" + name + "'"))],
  ['admin privileged calls have no direct unauthenticated fetch', !/fetch\('\/\.netlify\/functions\/(elevenlabs-provision-agent|trigger-elevenlabs-sync|ai-apply-change|scrape-website)/.test(adminIndex)],
  ['admin workspace refresh does not reload all operational data', !/await loadDataFromSupabase\(\{ silent: true \}\)/.test(adminIndex) && /loadSyncLog\(customerId\)/.test(adminIndex)],
  ['ElevenLabs provisioning enforces 90-day retention', /AUDIO_TRANSCRIPT_RETENTION_DAYS = 90/.test(adminProvision) && /retention_days: AUDIO_TRANSCRIPT_RETENTION_DAYS/.test(adminProvision) && !/retention_days: -1/.test(adminProvision)],
  ['ElevenLabs sync enforces 90-day retention for existing agents', /AUDIO_TRANSCRIPT_RETENTION_DAYS = 90/.test(adminSync) && /retention_days: AUDIO_TRANSCRIPT_RETENTION_DAYS/.test(adminSync) && !/retention_days: -1/.test(adminSync)],
  ['database retention separates raw and operational call data', /TRANSCRIPT_RETENTION_DAYS = 90/.test(retentionJob) && /CALL_RECORD_RETENTION_DAYS = 180/.test(retentionJob) && /transcript: null/.test(retentionJob) && /transcript_json: null/.test(retentionJob) && /elevenlabs_conversation_id: null/.test(retentionJob) && /\.delete\(\)/.test(retentionJob)],
  ['database retention is gated and scheduled daily', /DATA_RETENTION_ENFORCEMENT_ENABLED !== 'true'/.test(retentionJob) && /\[functions\."enforce-data-retention"\]/.test(customerNetlify) && /schedule = "17 3 \* \* \*"/.test(customerNetlify)],
  ['customer retention messaging distinguishes 90 and 180 days', /vollständige Transkripte werden nach <strong>90 Tagen<\/strong>/.test(dashboard) && /Archiveinträge nach <strong>180 Tagen<\/strong>/.test(dashboard)],
  ['duplicate customer AI mutation endpoint is quarantined', /statusCode: 410/.test(customerDuplicateAiApply) && !/SUPABASE_SERVICE_ROLE_KEY/.test(customerDuplicateAiApply) && !/ANTHROPIC_API_KEY/.test(customerDuplicateAiApply)],
  ['call intake fails closed without webhook secret', /configurationMissing: true/.test(callIntake) && /response\(503/.test(callIntake) && !/if \(!requiredSecret\) return true/.test(callIntake)],
  ['call intake compares webhook secrets in constant time', /crypto\.timingSafeEqual/.test(callIntake)],
  ['server audio requires Bearer token', /auth_token_missing/.test(serverAudio) && /auth\.getUser\(token\)/.test(serverAudio)],
  ['server audio resolves public.users tenant', /\.from\('users'\)/.test(serverAudio) && /customer_id/.test(serverAudio)],
  ['server audio checks calls tenant before ElevenLabs', serverAudio.indexOf(".from('calls')") < serverAudio.indexOf('api.elevenlabs.io')],
  ['server audio has no wildcard CORS', !/access-control-allow-origin['"]?\s*:\s*['"]\*/i.test(serverAudio)],
  ['server audio does not return provider response body', !/details\s*:/.test(serverAudio) && !/await providerResponse\.text/.test(serverAudio)],
  ['actual dashboard audio call-site exists', /function\s+vxTryLoadElevenLabsAudioFromDashboard\s*\(/.test(dashboard)],
  ['dashboard synchronously loads secure shared bootstrap', /<script\s+src=["']\/shared\/offer-brand\.js["']><\/script>/i.test(dashboard)],
  ['client loads current Supabase session', /auth\.getSession\(\)/.test(clientAudio)],
  ['client sends Bearer token', /Authorization:\s*`Bearer \$\{accessToken\}`/.test(clientAudio)],
  ['client consumes binary blob response', /await response\.blob\(\)/.test(clientAudio) && /createObjectURL\(blob\)/.test(clientAudio)],
  ['client revokes stale Object URLs', /revokeObjectURL\(previousObjectUrl\)/.test(clientAudio) && /beforeunload/.test(clientAudio)],
  ['client installs replacement for actual call-site', /vxTryLoadElevenLabsAudioFromDashboard\s*=\s*async function secureConversationAudioLoad/.test(clientAudio)],
  ['no direct protected endpoint audio src', !directProtectedAudioSrc.test(dashboard) && !directProtectedAudioSrc.test(clientAudio)],
  ['client uses no service-role key', !/SUPABASE_SERVICE_ROLE_KEY/.test(clientAudio)],
  ['delete_auth_user_data service role only', /grant execute on function public\.delete_auth_user_data\(uuid\) to service_role/i.test(migration)],
  ['legacy ensure_user_profile authenticated revoked', /ensure_user_profile\(text,text\).*authenticated/s.test(migration)],
  ['ensure_user_profile body found', ensureBody.length > 0],
  ['ensure_user_profile ignores raw user metadata', !/raw_user_meta_data|user_metadata/i.test(ensureBody)],
  ['ensure_user_profile parameters cannot bind tenant', !/p_customer_id|p_dashboard_id|p_email/i.test(ensureBody)],
  ['ensure_user_profile binds only by customers.auth_user_id', /from public\.customers/i.test(ensureBody) && /auth_user_id\s*=\s*v_auth_user_id/i.test(ensureBody)],
  ['ensure_user_profile requires unique server binding', /array_agg/i.test(ensureBody) && /array_length/i.test(ensureBody)],
  ['is_admin body found', isAdminBody.length > 0],
  ['is_admin rejects foreign UUID checks', /p_user_id is not distinct from auth\.uid\(\)/i.test(isAdminBody) && /a\.id = auth\.uid\(\)/i.test(isAdminBody)],
  ['calls browser inserts revoked', /revoke insert on table public\.calls from anon/i.test(migration) && /revoke insert on table public\.calls from authenticated/i.test(migration)],
  ['notifications browser inserts revoked', /revoke insert on table public\.notifications from anon/i.test(migration) && /revoke insert on table public\.notifications from authenticated/i.test(migration)],
  ['ai_change_requests tenant policies created', /ai_change_requests_customer_select_own/.test(migration) && /customer_id = public\.current_customer_id\(\)/.test(migration)],
  ['system_config admin-only policy created', /create policy system_config_admin_select/i.test(migration) && /public\.is_admin\(auth\.uid\(\)\)/.test(migration)],
  ['migration has object guards', /to_regprocedure\(/.test(migration) && /to_regclass\(/.test(migration)],
  ['preflight checks customers.auth_user_id uniqueness', /duplicate_customer_auth_user_bindings/.test(preflight)],
  ['postflight checks tenant-safe profile binding', /ensure_user_profile binds only via customers\.auth_user_id/.test(postflight)],
  ['postflight checks self-only admin lookup', /is_admin\(uuid\) restricts checks to auth\.uid\(\)/.test(postflight)],
  ['preflight is read only', !/^(?:\s*)(insert|update|delete|alter|create|drop|grant|revoke)\b/im.test(preflight.replace(/^--.*$/gm, ''))],
  ['postflight is read only', !/^(?:\s*)(insert|update|delete|alter|create|drop|grant|revoke)\b/im.test(postflight.replace(/^--.*$/gm, ''))]
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed > 0) {
  console.error(`P0 repository verification failed: ${failed} check(s).`);
  process.exit(1);
}

console.log(`P0 repository verification passed: ${checks.length} checks.`);
