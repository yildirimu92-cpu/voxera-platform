'use strict';

const ELEVENLABS_CONVAI_BASE = 'https://api.elevenlabs.io/v1/convai';
const TOOL_NAME = 'manage_voxera_calendar';
const SECRET_NAME = 'voxera_calendar_authorization';
const DEFAULT_TOOL_URL = 'https://dashboard.voxera.ch/.netlify/functions/calendar-agent-tool';

let cachedToolId = null;
let cachedSecretId = null;

function configured() {
  return Boolean(
    String(process.env.ELEVENLABS_API_KEY || '').trim()
    && String(process.env.CALENDAR_TOOL_WEBHOOK_SECRET || '').trim()
  );
}

async function elevenLabsRequest(path, { method = 'GET', body } = {}) {
  const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) throw new Error('elevenlabs_api_key_missing');

  const response = await fetch(ELEVENLABS_CONVAI_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch (_error) { payload = { raw: text.slice(0, 2000) }; }

  if (!response.ok) {
    const detail = payload.detail || payload.error || payload.raw || 'unknown_error';
    const serialized = typeof detail === 'string' ? detail : JSON.stringify(detail);
    const error = new Error(`ElevenLabs ${response.status}: ${serialized.slice(0, 2000)}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function listAll(path, key) {
  const items = [];
  let cursor = '';
  do {
    const separator = path.includes('?') ? '&' : '?';
    const payload = await elevenLabsRequest(
      path + separator + 'page_size=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
    );
    items.push(...(Array.isArray(payload[key]) ? payload[key] : []));
    cursor = String(payload.next_cursor || '').trim();
  } while (cursor);
  return items;
}

async function ensureWorkspaceSecret() {
  const secretValue = String(process.env.CALENDAR_TOOL_WEBHOOK_SECRET || '').trim();
  if (!secretValue) throw new Error('calendar_tool_webhook_secret_missing');
  if (cachedSecretId) return cachedSecretId;

  const secrets = await listAll('/secrets?search=' + encodeURIComponent(SECRET_NAME), 'secrets');
  const existing = secrets.find((item) => item && item.name === SECRET_NAME);
  const body = {
    type: existing ? 'update' : 'new',
    name: SECRET_NAME,
    value: 'Bearer ' + secretValue
  };

  const result = existing
    ? await elevenLabsRequest('/secrets/' + encodeURIComponent(existing.secret_id), { method: 'PATCH', body })
    : await elevenLabsRequest('/secrets', { method: 'POST', body });

  cachedSecretId = String(result.secret_id || existing?.secret_id || '').trim();
  if (!cachedSecretId) throw new Error('elevenlabs_calendar_secret_id_missing');
  return cachedSecretId;
}

function llmProperty(type, description, extra = {}) {
  return {
    type,
    description,
    ...extra
  };
}

function dynamicProperty(type, variable) {
  return {
    type,
    dynamic_variable: variable
  };
}

function buildToolConfig(secretId) {
  const toolUrl = String(process.env.CALENDAR_AGENT_TOOL_URL || DEFAULT_TOOL_URL).trim();
  if (!/^https:\/\//i.test(toolUrl)) throw new Error('calendar_agent_tool_url_invalid');
  if (!String(secretId || '').trim()) throw new Error('elevenlabs_calendar_secret_id_missing');

  return {
    type: 'webhook',
    name: TOOL_NAME,
    description: 'Verwaltet den kundenspezifischen Voxera-Kalender. Nur verwenden, wenn der Systemprompt direkte Kalenderbuchungen ausdrücklich erlaubt. Vor jeder Buchung zuerst availability aufrufen. Eine Buchung, Verschiebung oder Absage erst nach erfolgreicher Tool-Antwort bestätigen.',
    api_schema: {
      url: toolUrl,
      method: 'POST',
      path_params_schema: {},
      request_body_schema: {
        type: 'object',
        description: 'Kalenderaktion für den aktuell sprechenden Voxera-Agenten.',
        properties: {
          action: llmProperty('string', 'Aktion: availability prüft einen Zeitraum, book erstellt einen bestätigten Termin, reschedule verschiebt einen von Voxera erstellten Termin, cancel storniert einen von Voxera erstellten Termin.', {
            enum: ['availability', 'book', 'reschedule', 'cancel']
          }),
          agent_id: dynamicProperty('string', 'system__agent_id'),
          conversation_id: dynamicProperty('string', 'system__conversation_id'),
          agent_turns: dynamicProperty('number', 'system__agent_turns'),
          start: llmProperty('string', 'Beginn als vollständiger ISO-8601-Zeitstempel mit Schweizer Offset, zum Beispiel 2026-08-05T10:00:00+02:00. Erforderlich für availability, book und reschedule.'),
          end: llmProperty('string', 'Ende als vollständiger ISO-8601-Zeitstempel mit Schweizer Offset. Erforderlich für availability, book und reschedule.'),
          title: llmProperty('string', 'Kurzer Kalendertitel für book oder reschedule.'),
          description: llmProperty('string', 'Optionale sachliche Terminbeschreibung mit Name, Telefonnummer und Anliegen.'),
          attendees: llmProperty('array', 'Optionale Liste bestätigter E-Mail-Adressen für Einladungen.', {
            items: llmProperty('string', 'Bestätigte E-Mail-Adresse eines Teilnehmers.')
          }),
          external_event_id: llmProperty('string', 'Von Voxera zurückgegebene Kalendertermin-ID. Für reschedule und cancel zwingend; niemals erfinden.')
        },
        required: ['action', 'agent_id', 'conversation_id']
      },
      request_headers: {
        Authorization: { secret_id: String(secretId).trim() },
        'Content-Type': 'application/json'
      },
      content_type: 'application/json',
      auth_connection: null
    },
    response_timeout_secs: 20,
    dynamic_variables: { dynamic_variable_placeholders: {} },
    assignments: [],
    interruption_mode: 'allow',
    pre_tool_speech: 'auto',
    tool_call_sound: null,
    tool_call_sound_behavior: 'auto',
    execution_mode: 'immediate',
    tool_error_handling_mode: 'auto'
  };
}

async function ensureWorkspaceTool() {
  if (cachedToolId) return cachedToolId;
  const secretId = await ensureWorkspaceSecret();
  const toolConfig = buildToolConfig(secretId);
  const tools = await listAll('/tools', 'tools');
  const existing = tools.find((item) => item?.tool_config?.name === TOOL_NAME);

  const result = existing
    ? await elevenLabsRequest('/tools/' + encodeURIComponent(existing.id), {
        method: 'PATCH',
        body: { tool_config: toolConfig }
      })
    : await elevenLabsRequest('/tools', {
        method: 'POST',
        body: { tool_config: toolConfig }
      });

  cachedToolId = String(result.id || existing?.id || '').trim();
  if (!cachedToolId) throw new Error('elevenlabs_calendar_tool_id_missing');
  return cachedToolId;
}

async function mergedAgentToolIds(agentId, requiredToolId) {
  const current = await elevenLabsRequest('/agents/' + encodeURIComponent(agentId));
  const existing = current?.conversation_config?.agent?.prompt?.tool_ids;
  return [...new Set([...(Array.isArray(existing) ? existing : []), requiredToolId].filter(Boolean))];
}

function calendarPromptBlock(settings = {}) {
  if (!settings.feature_enabled || !settings.active_provider) return '';
  const duration = Number(settings.appointment_duration_minutes || 30);
  const timezone = String(settings.timezone || 'Europe/Zurich');
  return [
    '## KALENDER & DIREKTE TERMINBUCHUNG',
    'Direkte Termine sind freigeschaltet. Verwende das Tool manage_voxera_calendar für jeden konkreten Terminwunsch.',
    '1. Kläre Datum, Uhrzeit, Anliegen und falls nötig die Kontaktdaten.',
    '2. Verwende die Zeitzone ' + timezone + ' und eine Standarddauer von ' + duration + ' Minuten, sofern nichts anderes vereinbart wurde.',
    '3. Prüfe den gewünschten Zeitraum immer zuerst mit action=availability. Erfinde keine freien Zeiten.',
    '4. Bei belegtem Zeitraum: Sage nur, dass dieser Zeitraum nicht verfügbar ist, und frage nach einer Alternative.',
    '5. Bei freiem Zeitraum: Wiederhole Datum, Uhrzeit und Dauer und hole eine ausdrückliche Bestätigung ein.',
    '6. Buche erst nach dieser Bestätigung mit action=book.',
    '7. Bestätige einen Termin erst, wenn das Tool ok=true zurückgibt.',
    '8. Verwende reschedule oder cancel nur mit einer echten external_event_id aus einer früheren Voxera-Buchung. Erfinde diese ID niemals.',
    '9. Bei Toolfehlern keine Buchung versprechen; nimm stattdessen eine vollständige Rückrufanfrage auf.'
  ].join('\n');
}

function resetCache() {
  cachedToolId = null;
  cachedSecretId = null;
}

module.exports = {
  TOOL_NAME,
  SECRET_NAME,
  configured,
  buildToolConfig,
  ensureWorkspaceSecret,
  ensureWorkspaceTool,
  mergedAgentToolIds,
  calendarPromptBlock,
  resetCache,
  _test: { elevenLabsRequest, listAll, llmProperty, dynamicProperty }
};
