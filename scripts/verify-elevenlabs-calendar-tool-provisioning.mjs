import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const files = {
  helper: 'admin-panel/netlify/functions/_lib/elevenlabs-calendar-tool.js',
  sync: 'admin-panel/netlify/functions/_lib/elevenlabs-sync.js',
  syncHandler: 'admin-panel/netlify/functions/trigger-elevenlabs-sync.js',
  adapter: 'customer-dashboard/netlify/functions/calendar-agent-tool.js',
  core: 'customer-dashboard/netlify/functions/calendar-tool.js'
};
const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]));
// S4 / Stufe 2: Der Sync-Kern liegt in _lib/elevenlabs-sync.js, der Handler
// haelt nur noch Guard, Parsing und Antwortform. Beide zusammen sind der
// Sync-Pfad -- dieser Guard prueft ihn als Ganzes, damit die Verlagerung
// keine Aussage verliert.
const syncPath = source.sync + '\n' + source.syncHandler;
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
  "require('./elevenlabs-calendar-tool')",
  'ensureWorkspaceTool()',
  'agentToolIds(agentId, calendarToolId, { attach: true })',
  'agentToolIds(agentId, calendarToolId, { attach: false })',
  'findWorkspaceToolId()',
  'calendarPromptBlock(inputs.calendarSettings || {}, appointmentMode)',
  'compiled.appointmentMode',
  // #932: Frueher setzte der Sync `promptPatch.tool_ids = toolIds` von Hand.
  // Seit der Sollzustand geteilt ist, reicht er `toolIds` an buildAgentConfig()
  // durch, das sie an conversation_config.agent.prompt.tool_ids setzt.
  'toolIds',
  'calendar_tool_status'
]) {
  if (!syncPath.includes(token)) failures.push('Prompt sync integration missing: ' + token);
}

// #932: Der Rollback-Pfad musste hier dazu. Er sendete vorher nur den Prompt --
// und da ElevenLabs `agent.prompt` ersetzt statt zusammenzufuehren, nahm ein
// Rollback dem Agenten damit sein Kalenderwerkzeug. Das ist derselbe Befund wie
// beim Sync, nur an der Stelle, die im Fehlerfall laeuft.
const restoreBody = syncPath.slice(syncPath.indexOf('async function restoreAgentPrompt'));
for (const token of [
  'calendarToolProvisioningConfigured()',
  // #930: Auch der Rollback haengt am Terminmodus -- er darf keine
  // Direktbuchung wiederherstellen, die der Kunde abgewaehlt hat.
  "const attach = customer.ai_appointment_mode === 'direct';",
  'agentToolIds(agentId, calendarToolId, { attach })',
  'buildSyncPatch({ customer, prompt, toolIds })'
]) {
  if (!restoreBody.includes(token)) failures.push('Rollback calendar tool handling missing: ' + token);
}

// #930 Schritt C: availability hinterlaesst eine Spur. Vorher schrieb die
// Aktion weder bei Erfolg noch bei Fehlschlag eine Zeile -- der einzige Beleg
// des gescheiterten Aufrufs vom 10.08. war eine Netlify-Logzeile.
for (const token of [
  "action,\n        actor_type: 'assistant',\n        status: 'success'",
  "status: 'failed'",
  'if (!claimedAuditId && customerId)',
  'let customerId = null;'
]) {
  if (!source.core.includes(token)) failures.push('Calendar tool audit missing: ' + token);
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

if (syncPath.includes('prompt: { tools:') || source.helper.includes('prompt.tools')) {
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
  assert.deepEqual(props.attendees.items, {
    type: 'string',
    description: 'Bestätigte E-Mail-Adresse eines Teilnehmers.'
  });

  const verbunden = {
    feature_enabled: true,
    active_provider: 'google',
    timezone: 'Europe/Zurich',
    appointment_duration_minutes: 60
  };

  // #930: feste Dauer statt "sofern nichts anderes vereinbart wurde". Der
  // Zusatz war ein Versprechen ohne Deckung -- book() lehnt jede
  // abweichende Dauer ab, und ein Agent, der einen Zeitraum als frei
  // meldet und ihn dann nicht buchen kann, ist schlechter als einer, der
  // gleich das Raster nennt.
  assert.match(helper.calendarPromptBlock(verbunden, 'direct'), /genau 60 Minuten/);
  assert.ok(!/sofern nichts anderes vereinbart/.test(helper.calendarPromptBlock(verbunden, 'direct')),
    'Der Prompt erlaubt weiterhin eine abweichende Dauer, die book() ablehnt');
  assert.equal(helper.calendarPromptBlock({ feature_enabled: false }, 'direct'), '');

  // #930: Der Block haengt am Terminmodus, nicht nur am Anschlussstatus. Bis
  // zum 2026-08-10 bekam jeder Kunde mit verbundenem Kalender den Satz
  // "Direkte Termine sind freigeschaltet" -- auch bei "Terminwunsch aufnehmen"
  // und bei "keine Termine".
  assert.equal(helper.calendarPromptBlock(verbunden, 'request'), '',
    'request darf keine Direktbuchungs-Anleitung erhalten');
  assert.equal(helper.calendarPromptBlock(verbunden, 'none'), '',
    'none darf keine Direktbuchungs-Anleitung erhalten');
  assert.equal(helper.calendarPromptBlock(verbunden), '',
    'ohne Modus gilt der sichere Fall');

  // Das Werkzeug muss auch wieder abgehaengt werden koennen. Die
  // Vorgaengerfunktion mergedAgentToolIds() konnte nur hinzufuegen.
  assert.equal(typeof helper.agentToolIds, 'function');
  assert.equal(typeof helper.findWorkspaceToolId, 'function');
  assert.equal(helper.mergedAgentToolIds, undefined,
    'Die additive Vorgaengerfunktion darf nicht daneben bestehen bleiben');

  // ── #930 Schritt C: der Werkzeugvertrag ────────────────────────────────────
  //
  // Alle drei Zusicherungen haengen an einem einzigen Testanruf vom 10.08., bei
  // dem der Agent "ich schaue nach, welche Termine naechste Woche verfuegbar
  // sind" sagte und der Anrufende danach "es tut mir leid, da ist ein Fehler
  // aufgetreten" hoerte.
  const body = helper.buildToolConfig('secret_1').api_schema.request_body_schema;

  // start/end standen nur in der Beschreibungsprosa. Ein Modell darf Prosa
  // ignorieren; ein required-Array nicht.
  assert.ok(body.required.includes('start'), 'start ist nicht verbindlich');
  assert.ok(body.required.includes('end'), 'end ist nicht verbindlich');

  // Die 8-Stunden-Grenze stand ausschliesslich im Servercode. Das Modell konnte
  // sie nicht kennen und lief mit "naechste Woche" hinein.
  const block = helper.calendarPromptBlock(verbunden, 'direct');
  assert.match(block, /höchstens 8 Stunden/, 'Die Fenstergrenze fehlt im Prompt');
  assert.match(block, /Halbtag/, 'Es fehlt die Anweisung, in kleineren Fenstern zu fragen');
  assert.match(body.properties.start.description, /8 Stunden/,
    'Die Fenstergrenze fehlt in der Feldbeschreibung');

  // Ein Arbeitstag von 08-17 sind neun Stunden. "Frag tageweise" waere deshalb
  // eine Anweisung, die verlaesslich in die Grenze laeuft -- der Prompt muss
  // Halbtage nennen und darf keine Tagesfenster empfehlen.
  assert.ok(!/in Tagesfenstern|tageweise|ganzen Tag prüfe/.test(block),
    'Der Prompt empfiehlt Tagesfenster, die an der 8-Stunden-Grenze scheitern');

  // Der Anrufende hoerte den Fehler woertlich. Schritt 9 verbot nur das
  // Buchungsversprechen, nicht das Aussprechen.
  assert.match(block, /sprich nie über den Fehler/, 'Das Aussprechen von Fehlern ist nicht verboten');
  assert.match(block, /Rückrufanfrage/, 'Der Ersatzweg bei Toolfehlern fehlt');
} catch (error) {
  failures.push('Provisioning helper contract failed: ' + error.message);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('ElevenLabs calendar tool provisioning verification passed.');
