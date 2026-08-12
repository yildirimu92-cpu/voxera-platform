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
          action: llmProperty('string', 'Aktion: availability prüft einen Zeitraum und liefert in free_slots die buchbaren Anfangszeiten darin, book erstellt einen bestätigten Termin, reschedule verschiebt einen von Voxera erstellten Termin, cancel storniert einen von Voxera erstellten Termin.', {
            enum: ['availability', 'book', 'reschedule', 'cancel']
          }),
          agent_id: dynamicProperty('string', 'system__agent_id'),
          conversation_id: dynamicProperty('string', 'system__conversation_id'),
          agent_turns: dynamicProperty('number', 'system__agent_turns'),
          start: llmProperty('string', 'Beginn als vollständiger ISO-8601-Zeitstempel mit Schweizer Offset, zum Beispiel 2026-08-05T10:00:00+02:00. Der Zeitraum start bis end darf höchstens 8 Stunden umfassen; frage sonst nach einem Halbtag. Bei cancel wird der Wert nicht ausgewertet — sende dort den Zeitraum des betroffenen Termins und erfinde keinen.'),
          end: llmProperty('string', 'Ende als vollständiger ISO-8601-Zeitstempel mit Schweizer Offset. Bei book und reschedule ist es genau die konfigurierte Termindauer nach start.'),
          title: llmProperty('string', 'Kurzer Kalendertitel für book oder reschedule.'),
          description: llmProperty('string', 'Optionale sachliche Terminbeschreibung mit Name, Telefonnummer und Anliegen.'),
          attendees: llmProperty('array', 'Optionale Liste bestätigter E-Mail-Adressen für Einladungen.', {
            items: llmProperty('string', 'Bestätigte E-Mail-Adresse eines Teilnehmers.')
          }),
          external_event_id: llmProperty('string', 'Von Voxera zurückgegebene Kalendertermin-ID. Für reschedule und cancel zwingend; niemals erfinden.')
        },
        // #930 Schritt C: start und end sind verbindlich.
        //
        // Vorher standen sie nur in der Beschreibungsprosa ("Erforderlich fuer
        // availability, book und reschedule"). Das Modell durfte availability
        // also ohne Zeitraum aufrufen -- `new Date(null)` ergibt fuer start und
        // end denselben Zeitpunkt, `end <= start` greift, und der Anrufende
        // hoerte eine Fehlermeldung. Prosa ist fuer ein Schema keine Vorgabe.
        //
        // `cancel` braucht die beiden Werte fachlich nicht. Ein eigenes Schema
        // je Aktion gibt dieses Werkzeugformat aber nicht her, und "erfinde
        // zwei Zeitstempel" waere die schlechtere Loesung: die Beschreibung
        // sagt deshalb, bei cancel den Zeitraum des betroffenen Termins zu
        // senden -- eine wahre Angabe, die der Server ignoriert.
        required: ['action', 'agent_id', 'conversation_id', 'start', 'end']
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

// Sucht das Werkzeug, ohne es anzulegen. Gebraucht fuer den Entzugspfad: um das
// Kalender-Werkzeug von einem Agenten zu nehmen, braucht man seine ID -- aber
// kein ensureWorkspaceTool(), das es bei dieser Gelegenheit erst erzeugen wuerde.
async function findWorkspaceToolId() {
  if (cachedToolId) return cachedToolId;
  const tools = await listAll('/tools', 'tools');
  return String(tools.find((item) => item?.tool_config?.name === TOOL_NAME)?.id || '').trim() || null;
}

// Setzt die Werkzeugliste des Agenten so, dass das Kalender-Werkzeug entweder
// dran ist oder nicht -- und laesst alle uebrigen Werkzeuge unberuehrt.
//
// Hiess bis zum 2026-08-10 mergedAgentToolIds() und konnte nur hinzufuegen.
// Damit blieb das Werkzeug am Agenten haengen, sobald es einmal dran war, auch
// wenn die Direktbuchung wieder abgewaehlt wurde. Ein Terminmodus, der nur in
// eine Richtung wirkt, ist kein Schalter.
async function agentToolIds(agentId, calendarToolId, { attach }) {
  const current = await elevenLabsRequest('/agents/' + encodeURIComponent(agentId));
  const existing = current?.conversation_config?.agent?.prompt?.tool_ids;
  const others = (Array.isArray(existing) ? existing : []).filter((id) => id && id !== calendarToolId);
  return attach && calendarToolId ? [...new Set([...others, calendarToolId])] : others;
}

// Der Kalenderblock haengt am Terminmodus, nicht am Anschlussstatus.
//
// Bis zum 2026-08-10 hing weder dieser Block noch die Werkzeugzuweisung am
// Modus: geprueft wurden nur feature_enabled und active_provider. Ein Kunde mit
// verbundenem Kalender und Terminmodus "Terminwunsch aufnehmen" bekam trotzdem
// "Direkte Termine sind freigeschaltet" samt neunstufiger Buchungsanleitung --
// im Widerspruch zum Abschnitt TERMINBEFUGNIS weiter oben, der dasselbe
// Gespraech anders regelte.
//
// Fuer `request` steht hier bewusst KEIN eigener Block. Das Verhalten
// "Wunschzeit und Kontakt aufnehmen, nichts bestaetigen" formuliert
// APPOINTMENT_TEXT.request im Abschnitt TERMINBEFUGNIS bereits vollstaendig.
// Ein zweiter Text dazu waere eine weitere Doppelquelle -- genau die Bauform,
// die diesen Befund verursacht hat.
// Schritte 5 bis 8 sprechen seit dem 2026-08-12 von einzelnen Terminen statt
// von einem Zeitraum.
//
// Vorher hiess Schritt 5 "Bei belegtem Zeitraum: Sage nur, dass dieser Zeitraum
// nicht verfuegbar ist" -- und das Werkzeug meldete "belegt", sobald IRGENDEIN
// Termin im geprueften Fenster lag. Zusammen mit Schritt 4, der vage
// Terminwuensche in Halbtage lenkt, hiess das: ein einziger Termin um 09:00
// liess den Agenten "am Vormittag ist leider nichts frei" sagen, obwohl sieben
// von acht Zeiten frei waren. Die Zerlegung steckt in
// customer-dashboard/.../\_lib/calendar-slots.js; hier steht, wie der Agent das
// Ergebnis lesen soll.
//
// Wichtig ist der zweite Satz von Schritt 5: `available` heisst jetzt "es gibt
// mindestens einen buchbaren Termin", nicht mehr "der ganze Zeitraum ist frei".
// Ohne diesen Hinweis wuerde der Agent bei available=true einen halben Tag als
// frei anbieten.
function calendarPromptBlock(settings = {}, appointmentMode = '') {
  if (appointmentMode !== 'direct') return '';
  if (!settings.feature_enabled || !settings.active_provider) return '';
  const duration = Number(settings.appointment_duration_minutes || 30);
  const timezone = String(settings.timezone || 'Europe/Zurich');
  return [
    '## KALENDER & DIREKTE TERMINBUCHUNG',
    'Direkte Termine sind freigeschaltet. Verwende das Tool manage_voxera_calendar für jeden konkreten Terminwunsch.',
    '1. Kläre Datum, Uhrzeit, Anliegen und falls nötig die Kontaktdaten.',
    '2. Verwende die Zeitzone ' + timezone + '. Jeder Termin dauert genau ' + duration + ' Minuten -- eine andere Dauer ist nicht buchbar, auch nicht auf Wunsch.',
    '3. Prüfe den gewünschten Zeitraum immer zuerst mit action=availability, mit vollständigem start und end. Erfinde keine freien Zeiten.',
    '4. Ein Zeitraum darf höchstens 8 Stunden umfassen — ein ganzer Arbeitstag ist oft länger. Nennt jemand einen ganzen Tag, eine Woche oder "irgendwann", frage nach einem Halbtag und prüfe Vormittag und Nachmittag getrennt.',
    '5. Die Antwort zerlegt den geprüften Zeitraum in einzelne Termine. In free_slots stehen die tatsächlich buchbaren Anfangszeiten, in free_slots_total ihre Gesamtzahl. Nur diese Zeiten sind buchbar. available=true heisst nicht, dass der ganze geprüfte Zeitraum frei ist.',
    '6. Steht etwas in free_slots: Nenne höchstens drei dieser Zeiten als Vorschlag. Gibt es mehr, sage das, ohne alle aufzuzählen. Wiederhole zur gewählten Zeit Datum, Uhrzeit und Dauer und hole eine ausdrückliche Bestätigung ein.',
    '7. Ist free_slots leer: Sage nur, dass in diesem Zeitraum nichts frei ist, und frage nach einer Alternative — zum Beispiel nach dem anderen Halbtag oder einem anderen Tag.',
    '8. Buche erst nach dieser Bestätigung mit action=book, und zwar genau eine Zeit aus free_slots. Erfinde keine anderen Zeiten.',
    '9. Bestätige einen Termin erst, wenn das Tool ok=true zurückgibt.',
    '10. Verwende reschedule oder cancel nur mit einer echten external_event_id aus einer früheren Voxera-Buchung. Erfinde diese ID niemals.',
    '11. Antwortet das Tool nicht mit ok=true, sprich nie über den Fehler, das Werkzeug oder den Kalender. Sage, dass du den Termin nicht selbst bestätigen kannst, und nimm eine vollständige Rückrufanfrage auf. Die Wörter Fehler, System, Tool, Schnittstelle und Kalender kommen dabei nicht vor.'
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
  findWorkspaceToolId,
  agentToolIds,
  calendarPromptBlock,
  resetCache,
  _test: { elevenLabsRequest, listAll, llmProperty, dynamicProperty }
};
