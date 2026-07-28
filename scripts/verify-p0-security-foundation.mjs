#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

const migrationPath = new URL('../supabase/migrations/2026-07-28_p0_security_foundation.sql', import.meta.url);
const audioPath = new URL('../customer-dashboard/netlify/functions/elevenlabs-conversation-audio.js', import.meta.url);
const preflightPath = new URL('../supabase/verification/p0_security_preflight.sql', import.meta.url);
const postflightPath = new URL('../supabase/verification/p0_security_post_migration.sql', import.meta.url);

const [migration, audio, preflight, postflight] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(audioPath, 'utf8'),
  readFile(preflightPath, 'utf8'),
  readFile(postflightPath, 'utf8')
]);

const checks = [
  ['audio requires Bearer token', /auth_token_missing/.test(audio) && /auth\.getUser\(token\)/.test(audio)],
  ['audio resolves public.users tenant', /\.from\('users'\)/.test(audio) && /customer_id/.test(audio)],
  ['audio checks calls tenant before ElevenLabs', audio.indexOf(".from('calls')") < audio.indexOf('api.elevenlabs.io')],
  ['audio has no wildcard CORS', !/access-control-allow-origin['"]?\s*:\s*['"]\*/i.test(audio)],
  ['audio does not return provider response body', !/details\s*:/.test(audio) && !/await providerResponse\.text/.test(audio)],
  ['delete_auth_user_data service role only', /grant execute on function public\.delete_auth_user_data\(uuid\) to service_role/i.test(migration)],
  ['delete_auth_user_data anon revoked', /revoke all privileges on function public\.delete_auth_user_data\(uuid\) from anon/i.test(migration)],
  ['legacy ensure_user_profile authenticated revoked', /ensure_user_profile\(text,text\).*authenticated/s.test(migration)],
  ['calls browser inserts revoked', /revoke insert on table public\.calls from anon/i.test(migration) && /revoke insert on table public\.calls from authenticated/i.test(migration)],
  ['notifications browser inserts revoked', /revoke insert on table public\.notifications from anon/i.test(migration) && /revoke insert on table public\.notifications from authenticated/i.test(migration)],
  ['ai_change_requests tenant policies created', /ai_change_requests_customer_select_own/.test(migration) && /customer_id = public\.current_customer_id\(\)/.test(migration)],
  ['system_config admin-only policy created', /create policy system_config_admin_select/i.test(migration) && /public\.is_admin\(auth\.uid\(\)\)/.test(migration)],
  ['migration has object guards', /to_regprocedure\(/.test(migration) && /to_regclass\(/.test(migration)],
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
