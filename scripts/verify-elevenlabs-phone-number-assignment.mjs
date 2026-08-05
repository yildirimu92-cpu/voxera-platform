import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  helper: 'admin-panel/netlify/functions/_lib/elevenlabs-phone-number.js',
  sync: 'admin-panel/netlify/functions/trigger-elevenlabs-sync.js'
};

const failures = [];
const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);

for (const [key, path] of Object.entries(files)) {
  try { new vm.Script(source[key], { filename: path }); }
  catch (error) { failures.push(error.message); }
}

for (const token of [
  "PHONE_NUMBERS_BASE = 'https://api.elevenlabs.io/v1/convai/phone-numbers'",
  "provider: 'twilio'",
  'phone_number: normalizedPhone',
  'sid,',
  'token',
  "method: 'PATCH'",
  'body: { agent_id: normalizedAgentId }',
  "status: 'already_assigned'",
  "status: 'imported_and_assigned'",
  "status: 'skipped_no_number'"
]) {
  if (!source.helper.includes(token)) failures.push(`Phone helper missing: ${token}`);
}

for (const token of [
  "require('./_lib/elevenlabs-phone-number')",
  'ensureAgentPhoneNumber({',
  'phone_number_status: phoneNumberStatus',
  'phone_number_id: phoneNumberId'
]) {
  if (!source.sync.includes(token)) failures.push(`Sync integration missing: ${token}`);
}

for (const forbidden of [
  /phone_number:\s*['"]\+\d+['"]/, 
  /agent_id:\s*['"][A-Za-z0-9_-]{10,}['"]/,
  /TWILIO_AUTH_TOKEN\s*=\s*['"][^'"]+['"]/
]) {
  if (forbidden.test(source.helper) || forbidden.test(source.sync)) {
    failures.push(`Hard-coded telephony value found: ${forbidden}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('ElevenLabs phone number assignment verification passed.');
