'use strict';

const ELEVENLABS_CONVAI_BASE = 'https://api.elevenlabs.io/v1/convai';
const TOOL_NAME = 'manage_voxera_calendar';
// Absagen sind ein eigenes Werkzeug, seit dem 2026-08-12.
//
// Ein ElevenLabs-Webhook-Werkzeug hat GENAU EIN request_body_schema, und
// `required` gilt darin fuer alle Aktionen zugleich. Seit #930 Schritt C sind
// start und end verbindlich -- richtig fuer availability, book und reschedule,
// wo ein fehlender Zeitraum genau der Fehler war, der den Testanruf vom 12.08.
// zum Scheitern brachte. Fuer cancel sind sie fachlich bedeutungslos: der
// Server wertet sie nicht aus, die Termin-ID sagt bereits alles.
//
// Der Zwischenstand war, das Modell zwei Zeitstempel mitschicken zu lassen und
// in der Beschreibung zu erklaeren, dass sie ignoriert werden. Das ist die
// schlechtere Loesung: derselbe Prompt sagt an mehreren Stellen "erfinde
// nichts", und eine Pflichtangabe ohne Bedeutung ist eine Einladung, genau das
// zu tun. Ein zweites Werkzeug mit eigenem Schema loest das, ohne die
// Verbindlichkeit fuer die anderen drei Aktionen aufzugeben.
const CANCEL_TOOL_NAME = 'cancel_voxera_appointment';
// Nachschlagen ist ein drittes Werkzeug, seit dem 2026-08-13.
//
// Testanruf vom 13.08.: ein Kunde, der absagen will, kennt die Uhrzeit seines
// Termins selten. Der Agent hatte keine Moeglichkeit, die `external_event_id`
// eines Termins aus einem FRUEHEREN Gespraech zu finden -- sie existiert nur im
// Kontext des Buchungsgespraechs. Absagen in einem neuen Anruf war damit
// prinzipiell unmoeglich.
//
// Der Versuch, den Termin ueber availability zu suchen, scheiterte zweimal: ein
// ganzer Tag ueberschreitet die 8-Stunden-Grenze, und eine freie Zeit ist kein
// Beleg fuer einen Termin.
const LOOKUP_TOOL_NAME = 'find_voxera_appointments';
const SECRET_NAME = 'voxera_calendar_authorization';
const DEFAULT_TOOL_URL = 'https://dashboard.voxera.ch/.netlify/functions/calendar-agent-tool';

// Name -> Werkzeug-ID. Vorher eine einzelne Variable; mit zwei Werkzeugen
// braucht der Zwischenspeicher einen Schluessel.
const cachedToolIds = new Map();
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

// Die Anrufernummer, gesetzt von ElevenLabs -- das Modell waehlt sie nicht.
//
// `system__caller_id` gibt es NUR bei Telefongespraechen. Im Widget-Testchat
// und bei jedem anderen Kanal ist die Variable leer. Sie steht deshalb in
// KEINEM der drei Werkzeuge in `required`: eine Pflichtangabe, die auf einem
// ganzen Kanal nicht existiert, macht das Werkzeug dort unbenutzbar.
//
// GRENZE: eine Anrufernummer ist keine Authentifizierung. Sie ist faelschbar
// und teilbar; ElevenLabs schreibt das ueber die eigene Variable selbst. Sie
// ordnet einen Termin einer Person zu, sie weist nichts nach. Die ausfuehrliche
// Begruendung steht in
// customer-dashboard/netlify/functions/_lib/caller-identity.js.
const CALLER_ID_PROPERTY = () => dynamicProperty('string', 'system__caller_id');

// Der Rueckfall, wenn keine Anrufernummer vorliegt oder von einem anderen
// Anschluss angerufen wird. Anders als caller_id kommt sie vom Modell -- die
// anrufende Person liest sie vor.
const BOOKING_REFERENCE_PROPERTY = () => llmProperty('string', 'Terminnummer aus der Buchungsbestätigung, sechs Ziffern. Nur angeben, wenn die anrufende Person sie von sich aus nennt oder auf Nachfrage vorliest. Niemals erfinden und niemals raten.');

// Gemeinsame Huelle beider Werkzeuge: gleiche URL, gleiches Geheimnis, gleiche
// Kopfzeilen. Nur Name, Beschreibung und Rumpfschema unterscheiden sich.
function toolEnvelope(secretId, { name, description, requestBodySchema }) {
  const toolUrl = String(process.env.CALENDAR_AGENT_TOOL_URL || DEFAULT_TOOL_URL).trim();
  if (!/^https:\/\//i.test(toolUrl)) throw new Error('calendar_agent_tool_url_invalid');
  if (!String(secretId || '').trim()) throw new Error('elevenlabs_calendar_secret_id_missing');

  return {
    type: 'webhook',
    name,
    description,
    api_schema: {
      url: toolUrl,
      method: 'POST',
      path_params_schema: {},
      request_body_schema: requestBodySchema,
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

function buildToolConfig(secretId) {
  return toolEnvelope(secretId, {
    name: TOOL_NAME,
    description: 'Verwaltet den kundenspezifischen Voxera-Kalender. Nur verwenden, wenn der Systemprompt direkte Kalenderbuchungen ausdrücklich erlaubt. Vor jeder Buchung zuerst availability aufrufen. Eine Buchung oder Verschiebung erst nach erfolgreicher Tool-Antwort bestätigen. Für Absagen gibt es das eigene Werkzeug ' + CANCEL_TOOL_NAME + '.',
    requestBodySchema: {
        type: 'object',
        description: 'Kalenderaktion für den aktuell sprechenden Voxera-Agenten.',
        properties: {
          // `cancel` steht hier noch, obwohl es ein eigenes Werkzeug hat.
          //
          // Codex-Befund vom 12.08. (P1): dieses Werkzeug ist
          // ARBEITSBEREICHSWEIT geteilt. Ein PATCH nimmt `cancel` sofort allen
          // Agenten weg -- das Absagewerkzeug haengt aber immer nur an dem
          // einen Agenten, der gerade synchronisiert wird (agentToolIds() im
          // Sync). Zwischen dem ersten Kundensync und dem letzten haetten alle
          // uebrigen Direktbuchungs-Agenten also GAR KEINEN Absageweg mehr.
          //
          // Deshalb in zwei Schritten: jetzt beide Wege nebeneinander, der
          // Prompt schickt das Modell zum eigenen Werkzeug. Entfernt wird
          // `cancel` hier erst, wenn jeder betroffene Agent das neue Werkzeug
          // traegt -- siehe Nachtrag N9 im PR-Text. Bis dahin ist der alte Weg
          // ein funktionierender Rueckfall und kein Widerspruch.
          action: llmProperty('string', 'Aktion: availability prüft einen Zeitraum und liefert in free_slots die buchbaren Anfangszeiten darin, book erstellt einen bestätigten Termin, reschedule verschiebt einen von Voxera erstellten Termin. Für Absagen gibt es das eigene Werkzeug ' + CANCEL_TOOL_NAME + ' — verwende bevorzugt dieses.', {
            enum: ['availability', 'book', 'reschedule', 'cancel']
          }),
          agent_id: dynamicProperty('string', 'system__agent_id'),
          conversation_id: dynamicProperty('string', 'system__conversation_id'),
          agent_turns: dynamicProperty('number', 'system__agent_turns'),
          caller_id: CALLER_ID_PROPERTY(),
          booking_reference: BOOKING_REFERENCE_PROPERTY(),
          start: llmProperty('string', 'Beginn als vollständiger ISO-8601-Zeitstempel mit Schweizer Offset, zum Beispiel 2026-08-05T10:00:00+02:00. Der Zeitraum start bis end darf höchstens 8 Stunden umfassen; frage sonst nach einem Halbtag. Für Absagen ' + CANCEL_TOOL_NAME + ' verwenden, das ohne Zeitangaben auskommt.'),
          end: llmProperty('string', 'Ende als vollständiger ISO-8601-Zeitstempel mit Schweizer Offset. Bei book und reschedule ist es genau die konfigurierte Termindauer nach start.'),
          title: llmProperty('string', 'Kurzer Kalendertitel für book oder reschedule.'),
          description: llmProperty('string', 'Optionale sachliche Terminbeschreibung mit Name, Telefonnummer und Anliegen.'),
          attendees: llmProperty('array', 'Optionale Liste bestätigter E-Mail-Adressen für Einladungen.', {
            items: llmProperty('string', 'Bestätigte E-Mail-Adresse eines Teilnehmers.')
          }),
          external_event_id: llmProperty('string', 'Von Voxera zurückgegebene Kalendertermin-ID. Für reschedule zwingend; niemals erfinden.')
        },
        // #930 Schritt C: start und end sind verbindlich.
        //
        // Vorher standen sie nur in der Beschreibungsprosa ("Erforderlich fuer
        // availability, book und reschedule"). Das Modell durfte availability
        // also ohne Zeitraum aufrufen -- `new Date(null)` ergibt fuer start und
        // end denselben Zeitpunkt, `end <= start` greift, und der Anrufende
        // hoerte eine Fehlermeldung. Prosa ist fuer ein Schema keine Vorgabe.
        //
        // Die Aktion, fuer die das nicht passte, ist seit dem 2026-08-12 nicht
        // mehr hier: `cancel` hat ein eigenes Werkzeug mit eigenem Schema. Die
        // Verbindlichkeit gilt damit fuer alle drei verbliebenen Aktionen ohne
        // Ausnahme -- und keine davon muss einen Wert erfinden.
        required: ['action', 'agent_id', 'conversation_id', 'start', 'end']
    }
  });
}

// Das Nachschlagewerkzeug. Es verlangt GAR KEINE Angaben zum Termin -- weder
// Zeit noch ID. Genau das ist der Punkt: der Anrufende weiss beides meistens
// nicht, und alles, was das Modell hier angeben muesste, muesste es raten.
function buildLookupToolConfig(secretId) {
  return toolEnvelope(secretId, {
    name: LOOKUP_TOOL_NAME,
    description: 'Listet die anstehenden von Voxera gebuchten Termine der anrufenden Person auf, mit ihren Termin-IDs. Verwenden, bevor ein Termin abgesagt oder verschoben wird, und immer dann, wenn jemand seinen Termin nicht genau benennen kann. Verlangt keine Zeitangaben. Zugeordnet wird über die Anrufernummer; ist keine vorhanden, kann die Terminnummer aus der Buchungsbestätigung angegeben werden.',
    requestBodySchema: {
      type: 'object',
      description: 'Nachschlagen der anstehenden Termine für den aktuell sprechenden Voxera-Agenten.',
      properties: {
        action: llmProperty('string', 'Immer lookup. Dieses Werkzeug kann nichts anderes.', {
          enum: ['lookup']
        }),
        agent_id: dynamicProperty('string', 'system__agent_id'),
        conversation_id: dynamicProperty('string', 'system__conversation_id'),
        agent_turns: dynamicProperty('number', 'system__agent_turns'),
        caller_id: CALLER_ID_PROPERTY(),
        booking_reference: BOOKING_REFERENCE_PROPERTY()
      },
      required: ['action', 'agent_id', 'conversation_id']
    }
  });
}

// Das Absagewerkzeug. Bewusst so klein wie moeglich: eine Termin-ID und die
// beiden Kennungen, die ElevenLabs ohnehin einsetzt. Kein start, kein end,
// keine Dauer -- nichts, was das Modell erfinden koennte.
//
// `action` bleibt im Rumpf, weil der Server (calendar-tool.js) danach
// verzweigt; die Aufzaehlung laesst genau einen Wert zu, das Modell waehlt hier
// also nichts aus.
function buildCancelToolConfig(secretId) {
  return toolEnvelope(secretId, {
    name: CANCEL_TOOL_NAME,
    description: 'Storniert einen von Voxera gebuchten Termin. Nur verwenden, wenn der Systemprompt direkte Kalenderbuchungen ausdrücklich erlaubt und eine echte Termin-ID aus einer früheren Voxera-Buchung vorliegt. Verlangt keine Zeitangaben. Eine Absage erst nach erfolgreicher Tool-Antwort bestätigen.',
    requestBodySchema: {
      type: 'object',
      description: 'Absage eines von Voxera gebuchten Termins für den aktuell sprechenden Voxera-Agenten.',
      properties: {
        action: llmProperty('string', 'Immer cancel. Dieses Werkzeug kann nichts anderes.', {
          enum: ['cancel']
        }),
        agent_id: dynamicProperty('string', 'system__agent_id'),
        conversation_id: dynamicProperty('string', 'system__conversation_id'),
        agent_turns: dynamicProperty('number', 'system__agent_turns'),
        caller_id: CALLER_ID_PROPERTY(),
        booking_reference: BOOKING_REFERENCE_PROPERTY(),
        external_event_id: llmProperty('string', 'Von Voxera zurückgegebene Kalendertermin-ID des abzusagenden Termins. Niemals erfinden — ohne echte ID keine Absage.')
      },
      required: ['action', 'agent_id', 'conversation_id', 'external_event_id']
    }
  });
}

const TOOL_NAMES = Object.freeze([TOOL_NAME, CANCEL_TOOL_NAME, LOOKUP_TOOL_NAME]);

// Angelegt wird in der umgekehrten Reihenfolge: erst das Absagewerkzeug, dann
// das Buchungswerkzeug.
//
// Codex-Befund vom 12.08.: dieselbe Auslieferung, die `cancel` aus der
// Aufzaehlung von manage_voxera_calendar nimmt, legt das Absagewerkzeug erst
// an. In der alten Reihenfolge lief zuerst das PATCH auf manage -- und
// scheiterte danach das POST fuer cancel, war der Absageweg weg, ohne dass der
// Ersatz existierte. Das Werkzeug ist arbeitsbereichsweit geteilt, der Ausfall
// haette also alle Agenten getroffen, bis ein spaeterer Sync durchlaeuft.
//
// Andersherum ist die Zwischenzeit harmlos: dann gibt es beide Wege kurz
// gleichzeitig, und das Modell kann in dieser Spanne noch ueber manage
// absagen.
const PROVISION_ORDER = Object.freeze([CANCEL_TOOL_NAME, LOOKUP_TOOL_NAME, TOOL_NAME]);

function toolConfigFor(name, secretId) {
  if (name === CANCEL_TOOL_NAME) return buildCancelToolConfig(secretId);
  if (name === LOOKUP_TOOL_NAME) return buildLookupToolConfig(secretId);
  return buildToolConfig(secretId);
}

// Legt beide Kalenderwerkzeuge an oder bringt sie auf den aktuellen Stand und
// gibt ihre IDs zurueck.
//
// Hiess bis zum 2026-08-12 ensureWorkspaceTool() und lieferte eine einzelne ID.
// Die Mehrzahl ist kein Schoenheitsfehler: der Entzugspfad muss BEIDE
// Werkzeuge abhaengen koennen. Bliebe das Absagewerkzeug am Agenten haengen,
// waere der Terminmodus wieder ein Schalter mit nur einer Richtung -- derselbe
// Befund, den agentToolIds() schon einmal behoben hat.
async function ensureWorkspaceTools() {
  if (TOOL_NAMES.every((name) => cachedToolIds.has(name))) {
    return TOOL_NAMES.map((name) => cachedToolIds.get(name));
  }
  const secretId = await ensureWorkspaceSecret();
  const tools = await listAll('/tools', 'tools');
  for (const name of PROVISION_ORDER) {
    if (cachedToolIds.has(name)) continue;
    const existing = tools.find((item) => item?.tool_config?.name === name);
    const result = existing
      ? await elevenLabsRequest('/tools/' + encodeURIComponent(existing.id), {
          method: 'PATCH',
          body: { tool_config: toolConfigFor(name, secretId) }
        })
      : await elevenLabsRequest('/tools', {
          method: 'POST',
          body: { tool_config: toolConfigFor(name, secretId) }
        });
    const id = String(result.id || existing?.id || '').trim();
    if (!id) throw new Error('elevenlabs_calendar_tool_id_missing');
    cachedToolIds.set(name, id);
  }
  // Angelegt wird in PROVISION_ORDER, zurueckgegeben in TOOL_NAMES -- die
  // Reihenfolge der Rueckgabe ist die der Werkzeugliste am Agenten und soll
  // von der Anlegereihenfolge unabhaengig bleiben.
  return TOOL_NAMES.map((name) => cachedToolIds.get(name));
}

// Sucht die Werkzeuge, ohne sie anzulegen. Gebraucht fuer den Entzugspfad: um
// sie einem Agenten zu nehmen, braucht man ihre IDs -- aber kein
// ensureWorkspaceTools(), das sie bei dieser Gelegenheit erst erzeugen wuerde.
//
// Was es im Arbeitsbereich nicht gibt, kann auch an keinem Agenten haengen und
// faellt deshalb still weg.
async function findWorkspaceToolIds() {
  if (TOOL_NAMES.every((name) => cachedToolIds.has(name))) {
    return TOOL_NAMES.map((name) => cachedToolIds.get(name));
  }
  const tools = await listAll('/tools', 'tools');
  return TOOL_NAMES
    .map((name) => String(tools.find((item) => item?.tool_config?.name === name)?.id || '').trim())
    .filter(Boolean);
}

// Setzt die Werkzeugliste des Agenten so, dass die Kalender-Werkzeuge entweder
// dran sind oder nicht -- und laesst alle uebrigen Werkzeuge unberuehrt.
//
// Hiess bis zum 2026-08-10 mergedAgentToolIds() und konnte nur hinzufuegen.
// Damit blieb das Werkzeug am Agenten haengen, sobald es einmal dran war, auch
// wenn die Direktbuchung wieder abgewaehlt wurde. Ein Terminmodus, der nur in
// eine Richtung wirkt, ist kein Schalter.
//
// Nimmt seit dem 2026-08-12 eine Liste. Eine einzelne ID wird weiterhin
// angenommen -- ein Aufrufer, der sie noch uebergibt, soll nicht still die
// falsche Liste bekommen, sondern dasselbe Ergebnis wie vorher.
async function agentToolIds(agentId, calendarToolIds, { attach }) {
  const calendarIds = (Array.isArray(calendarToolIds) ? calendarToolIds : [calendarToolIds]).filter(Boolean);
  const current = await elevenLabsRequest('/agents/' + encodeURIComponent(agentId));
  const existing = current?.conversation_config?.agent?.prompt?.tool_ids;
  const others = (Array.isArray(existing) ? existing : []).filter((id) => id && !calendarIds.includes(id));
  return attach ? [...new Set([...others, ...calendarIds])] : others;
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
//
// Schritte 10, 14 und 15 gehoeren seit dem 2026-08-14 zur Anrufer-Bindung. Das
// Nachschlagen liefert nur noch Termine, die der anrufenden Person zugeordnet
// sind -- vorher las es jedem Anrufer die anstehenden Termine ALLER Kunden des
// Betriebs vor, samt Termin-IDs. Zugeordnet wird ueber die Anrufernummer, mit
// der Terminnummer als Rueckfall.
//
// Der Prompt stellt das ausdruecklich NICHT als Schutz dar, und Schritt 10
// begruendet die Terminnummer mit dem Wiederfinden, nicht mit Sicherheit. Eine
// Anrufernummer ist faelschbar; ein Satz wie "nur Sie koennen Ihren Termin
// absagen" waere ein Versprechen, das wir nicht halten koennen. Siehe
// customer-dashboard/netlify/functions/_lib/caller-identity.js.
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
    '10. Nenne nach jeder Buchung die booking_reference aus der Tool-Antwort als Terminnummer, Ziffer für Ziffer, und bitte darum, sie zu notieren. Sag dazu, dass sie hilft, den Termin wiederzufinden, falls später von einer anderen Nummer aus angerufen wird. Erfinde diese Nummer nie — nenne nur, was das Tool zurückgegeben hat.',
    '11. Verwende reschedule nur mit einer echten external_event_id. Erfinde diese ID niemals — hol sie dir mit ' + LOOKUP_TOOL_NAME + '. Hast du beim Nachschlagen nach der Terminnummer gefragt, gib dieselbe booking_reference auch beim Verschieben mit, sonst wird es abgelehnt.',
    '12. Ein freier Zeitraum ist kein Termin. Meldet availability available=true oder ein leeres busy, heisst das: dort ist NICHTS gebucht. Sage niemals, du habest einen Termin gefunden, weil eine Zeit frei war. availability beantwortet nur, was buchbar ist — nie, ob jemand einen Termin hat.',
    '13. Will jemand einen bestehenden Termin absagen oder verschieben, rufe zuerst ' + LOOKUP_TOOL_NAME + ' auf. Es braucht keine Zeitangabe und liefert die anstehenden Termine mit ihren IDs. Frage nicht nach Datum oder Uhrzeit — die meisten Menschen wissen das nicht mehr, und du brauchst es nicht.',
    '14. Meldet die Antwort reason=calendar_appointment_unmatched, konnte das Werkzeug den Anruf keinem Termin zuordnen — das ist der Normalfall, wenn jemand von einer anderen Nummer anruft. Frage dann nach der sechsstelligen Terminnummer aus der Buchungsbestätigung und rufe ' + LOOKUP_TOOL_NAME + ' erneut auf, diesmal mit booking_reference. Sage dabei nie, es gebe keinen Termin — du weisst das nicht. Wird keine Nummer genannt, nimm eine Rückrufanfrage auf.',
    '15. Meldet die Antwort reason=calendar_booking_reference_unknown, hat die genannte Terminnummer keinen Termin zugeordnet. Lies sie einmal zur Kontrolle Ziffer für Ziffer zurück und frage, ob du sie richtig verstanden hast. Stimmt sie, nimm eine Rückrufanfrage auf.',
    '16. Genau ein Termin in der Antwort: nenne ihn mit Datum und Uhrzeit und lass ihn bestätigen. Mehrere Termine: lies höchstens die drei nächsten vor und lass die anrufende Person wählen; gibt es mehr, sage das, ohne alle aufzuzählen. Rate nie, welcher gemeint ist.',
    '17. Für die Absage verwende dann ' + CANCEL_TOOL_NAME + ' mit der external_event_id aus der Antwort von ' + LOOKUP_TOOL_NAME + ' — und mit derselben booking_reference, falls du danach gefragt hast.',
    '18. Antwortet das Tool nicht mit ok=true, sprich nie über den Fehler, das Werkzeug oder den Kalender. Sage, dass du den Termin nicht selbst bestätigen kannst, und nimm eine vollständige Rückrufanfrage auf. Die Wörter Fehler, System, Tool, Schnittstelle und Kalender kommen dabei nicht vor.'
  ].join('\n');
}

function resetCache() {
  cachedToolIds.clear();
  cachedSecretId = null;
}

module.exports = {
  TOOL_NAME,
  CANCEL_TOOL_NAME,
  LOOKUP_TOOL_NAME,
  TOOL_NAMES,
  SECRET_NAME,
  configured,
  buildToolConfig,
  buildCancelToolConfig,
  buildLookupToolConfig,
  ensureWorkspaceSecret,
  ensureWorkspaceTools,
  findWorkspaceToolIds,
  agentToolIds,
  calendarPromptBlock,
  resetCache,
  _test: { elevenLabsRequest, listAll, llmProperty, dynamicProperty, toolEnvelope }
};
