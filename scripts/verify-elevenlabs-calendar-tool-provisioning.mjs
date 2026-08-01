import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const files = {
  helper: 'admin-panel/netlify/functions/_lib/elevenlabs-calendar-tool.js',
  sync: 'admin-panel/netlify/functions/trigger-elevenlabs-sync.js',
  adapter: 'customer-dashboard/netlify/functions/calendar-agent-tool.js',
  core: 'customer-dashboard/netlify/functions/calendar-tool.js'
};
const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]));
const failures = [];

for (const key of Object.keys(files)) {
  try { new vm.Script(source[key], { filename: files[key] }); }
  catch (error) { failures.push(error.message); }
}

for (const token of [
  "TOOL_NAME = 'manage_voxera_calendar'",
  "SECRET_NAME = 'voxera_calendar_authorization'",
  "'/secrets'",
  "'/tools'",
  "method: 'PATCH'",
  "method: 'POST'",
  'request_headers: {',
  'path_params_schema: {}',
  'dynamic_variable: variable',
  "'system__agent_id'",
  "'system__conversation_id'",
  "'system__agent_turns'",
  'tool_ids',
  'new Set'
]) {
  if (!source.helper.includes(token)) failures.push('Provisioning helper missing: ' + token);
}

for (const forbidden of [
  'query_params_schema: {',
  "value_type: 'llm_prompt'",
  "value_type: 'dynamic_variable'",
  "constant_value: ''"
]) {
  if (source.helper.includes(forbidden)) failures.push('Provisioning helper contains invalid ElevenLabs schema token: ' + forbidden);
}

for (const token of [
  "require('./_lib/elevenlabs-calendar-tool')",
  'ensureWorkspaceTool()',
  'mergedAgentToolIds(agent_id, calendarToolId)',
  'calendarPromptBlock(inputs.calendarSettings || {})',
  'promptPatch.tool_ids = toolIds',
  'calendar_tool_status'
]) {
  if (!source.sync.includes(token)) failures.push('Prompt sync integration missing: ' + token);
}

for (const token of [
  "require('./calendar-tool')",
  'stableRequestId',
  "['book', 'reschedule', 'cancel']",
  'conversation_id',
  'agent_turns',
  'crypto.createHash'
]) {
  if (!source.adapter.includes(token)) failures.push('Calendar agent adapter missing: ' + token);
}

if (source.sync.includes('prompt: { tools:') || source.helper.includes('prompt.tools')) {
  failures.push('Legacy ElevenLabs prompt.tools must not be used');
}
if (!source.core.includes('calendar_request_id_required')) {
  failures.push('Core calendar idempotency guard missing');
}

process.env.ELEVENLABS_API_KEY = 'test-api-key';
process.env.CALENDAR_TOOL_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.CALENDAR_AGENT_TOOL_URL = 'https://dashboard.voxera.ch/.netlify/functions/calendar-agent-tool';
try {
  const helper = require('../admin-panel/netlify/functions/_lib/elevenlabs-calendar-tool.js');
  const config = helper.buildToolConfig('sec_test');
  assert.equal(config.name, 'manage_voxera_calendar');
  assert.equal(config.api_schema.method, 'POST');
  assert.deepEqual(config.api_schema.path_params_schema, {});
  assert.equal(Object.hasOwn(config.api_schema, 'query_params_schema'), false);
  assert.equal(Array.isArray(config.api_schema.request_headers), false);
  assert.equal(config.api_schema.request_headers.Authorization.secret_id, 'sec_test');
  assert.equal(config.api_schema.request_headers['Content-Type'], 'application/json');

  const props = config.api_schema.request_body_schema.properties;
  assert.deepEqual(props.agent_id, { type: 'string', dynamic_variable: 'system__agent_id' });
  assert.deepEqual(props.conversation_id, { type: 'string', dynamic_variable: 'system__conversation_id' });
  assert.deepEqual(props.agent_turns, { type: 'number', dynamic_variable: 'system__agent_turns' });
  assert.equal(Object.hasOwn(props.action, 'value_type'), false);
  assert.equal(Object.hasOwn(props.attendees, 'constant_value'), false);
  assert.deepEqual(props.attendees.items, { type: 'string' });

  assert.match(helper.calendarPromptBlock({
    feature_enabled: true,
    active_provider: 'google',
    timezone: 'Europe/Zurich',
    appointment_duration_minutes: 60
  }), /Standarddauer von 60 Minuten/);
  assert.equal(helper.calendarPromptBlock({ feature_enabled: false }), '');
} catch (error) {
  failures.push('Provisioning helper contract failed: ' + error.message);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('ElevenLabs calendar tool provisioning verification passed.');
