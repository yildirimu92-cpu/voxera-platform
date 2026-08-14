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
  "CANCEL_TOOL_NAME = 'cancel_voxera_appointment'",
  "LOOKUP_TOOL_NAME = 'find_voxera_appointments'",
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
  // #951: Mehrzahl. Der Entzugspfad muss BEIDE Kalenderwerkzeuge abhaengen
  // koennen -- bliebe das Absagewerkzeug haengen, waere der Terminmodus wieder
  // ein Schalter mit nur einer Richtung.
  'ensureWorkspaceTools()',
  'agentToolIds(agentId, calendarToolIds, { attach: true })',
  'agentToolIds(agentId, calendarToolIds, { attach: false })',
  'findWorkspaceToolIds()',
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
  'agentToolIds(agentId, calendarToolIds, { attach })',
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
  'if (!claimedAuditId && customerId && providerBekannt)',
  'let customerId = null;'
]) {
  if (!source.core.includes(token)) failures.push('Calendar tool audit missing: ' + token);
}

// Codex-Befund P2 auf #951: availability schrieb ZWEI Erfolgszeilen. Die neue
// Zeile stand vor dem generischen Nachlauf, und der pruefte `claimedAuditId` --
// ein Signal, das availability nie setzt, weil die Aktion keine request_id
// fuehrt. Ein eigener Marker loest das; diese Pruefung haelt ihn fest.
for (const token of [
  'let auditGeschrieben = false;',
  'auditGeschrieben = true;',
  '} else if (!auditGeschrieben) {'
]) {
  if (!source.core.includes(token)) failures.push('Doppelte Audit-Zeile nicht verhindert: ' + token);
}

// Codex-Befund P2 auf #951: der Fehlerpfad liess `provider` auf den Vorgabewert
// google zurueckfallen. Bei unbekanntem Anbieter ist das ein erfundener
// Diagnosesatz -- in genau dem Pfad, der Beweise sichern soll. Ein Ersatzwert
// wie unknown geht nicht: die Spalte traegt CHECK (provider IN
// ('google','microsoft')), der INSERT wuerde scheitern und die Zeile still
// verschwinden.
//
// Der Test sucht den Rueckfall-Operator, nicht das Wort -- damit er auch eine
// umformulierte Variante faengt und nicht an einem Kommentar haengenbleibt.
if (/\|\|\s*'(google|microsoft)'/.test(source.core)) {
  failures.push('Fehlerpfad raet wieder einen Anbieter (Rueckfall auf einen festen Wert)');
}
for (const token of [
  'const providerBekannt =',
  'audit_uebersprungen_anbieter_unbekannt'
]) {
  if (!source.core.includes(token)) failures.push('Anbieter-Rateverbot fehlt: ' + token);
}

// #951 P1: availability antwortet mit einzelnen Terminen statt binaer fuer den
// ganzen Block. Die Slot-Zerlegung selbst prueft verify-calendar-slots.mjs;
// hier steht nur, dass das Werkzeug sie auch benutzt und die Antwort die Felder
// traegt, auf die der Prompt den Agenten verweist.
for (const token of [
  "require('./_lib/calendar-slots')",
  'bookableSlots(startIso, endIso, settings, openingHours, blockingUpdates)',
  'freeSlots(plan.slots, busy, settings)',
  'free_slots:',
  'free_slots_total:',
  'whole_window_free:'
]) {
  if (!source.core.includes(token)) failures.push('Slot-Zerlegung fehlt im Werkzeug: ' + token);
}

// Die alte binaere Antwort. Kommt sie zurueck, ist der P1 rueckgaengig gemacht.
if (/available: result\.available/.test(source.core)) {
  failures.push('availability antwortet wieder binaer fuer den ganzen Zeitraum');
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
  assert.equal(typeof helper.findWorkspaceToolIds, 'function');
  assert.equal(helper.mergedAgentToolIds, undefined,
    'Die additive Vorgaengerfunktion darf nicht daneben bestehen bleiben');
  // Die Einzahl-Varianten duerfen nicht daneben bestehen bleiben: ein Aufrufer,
  // der sie erwischt, haengt nur das Buchungswerkzeug ab und laesst das
  // Absagewerkzeug am Agenten.
  assert.equal(helper.ensureWorkspaceTool, undefined,
    'Die Einzahl-Variante von ensureWorkspaceTools darf nicht bestehen bleiben');
  assert.equal(helper.findWorkspaceToolId, undefined,
    'Die Einzahl-Variante von findWorkspaceToolIds darf nicht bestehen bleiben');

  // agentToolIds haengt beide Werkzeuge zugleich an und wieder ab, ohne fremde
  // Werkzeuge des Agenten anzufassen.
  const agentAntwort = { conversation_config: { agent: { prompt: { tool_ids: ['fremd_1', 'cal_alt'] } } } };
  const echtesFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(agentAntwort), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
  try {
    assert.deepEqual(await helper.agentToolIds('agent_1', ['cal_1', 'cal_2'], { attach: true }),
      ['fremd_1', 'cal_alt', 'cal_1', 'cal_2']);
    assert.deepEqual(await helper.agentToolIds('agent_1', ['cal_alt', 'cal_2'], { attach: false }),
      ['fremd_1'], 'Der Entzug nimmt jedes uebergebene Kalenderwerkzeug weg');
    assert.deepEqual(await helper.agentToolIds('agent_1', [], { attach: false }),
      ['fremd_1', 'cal_alt'], 'Ohne IDs bleibt die Liste unveraendert');
  } finally {
    globalThis.fetch = echtesFetch;
  }

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

  // ── #951 P1: der Halbtag ist teilbar ──────────────────────────────────────
  //
  // Die Zerlegung im Werkzeug nuetzt nichts, wenn der Prompt weiter von einem
  // "belegten Zeitraum" spricht. Beides gehoert zusammen: das Werkzeug liefert
  // free_slots, der Agent muss angewiesen sein, daraus vorzulesen.
  assert.match(block, /free_slots/, 'Der Prompt kennt die Einzeltermine nicht');
  assert.match(block, /höchstens drei/, 'Es fehlt die Begrenzung der vorgelesenen Vorschläge');

  // Der gefaehrlichste Satz: `available` heisst seit dem 2026-08-12 "es gibt
  // mindestens einen buchbaren Termin", nicht "der ganze Zeitraum ist frei".
  // Ohne diesen Hinweis bietet der Agent bei available=true einen halben Tag an.
  assert.match(block, /available=true heisst nicht/,
    'Der Prompt erklärt die neue Bedeutung von available nicht');

  // Der alte Wortlaut hat den Halbtag als Ganzes abgelehnt. Kommt er zurueck,
  // ist der Fix im Prompt rueckgaengig gemacht, auch wenn das Werkzeug noch
  // zerlegt.
  assert.ok(!/Bei belegtem Zeitraum/.test(block),
    'Der Prompt behandelt den Zeitraum wieder als unteilbaren Block');
  assert.match(body.properties.action.description, /free_slots/,
    'Die Feldbeschreibung nennt das Ergebnis von availability nicht');

  // ── #951: cancel hat ein eigenes Werkzeug ─────────────────────────────────
  //
  // Ein ElevenLabs-Webhook-Werkzeug hat genau ein request_body_schema, und
  // `required` gilt darin fuer alle Aktionen zugleich. Solange cancel im selben
  // Schema stand, musste das Modell fuer eine Absage zwei Zeitstempel liefern,
  // die der Server gar nicht auswertet -- eine Pflichtangabe ohne Bedeutung, im
  // selben Prompt, der "erfinde nichts" sagt.
  const cancel = helper.buildCancelToolConfig('secret_1');
  assert.equal(cancel.name, 'cancel_voxera_appointment');
  assert.equal(cancel.api_schema.url, config.api_schema.url,
    'Beide Werkzeuge zeigen auf denselben Endpunkt');
  assert.equal(cancel.api_schema.request_headers.Authorization.secret_id, 'secret_1');

  const cancelBody = cancel.api_schema.request_body_schema;
  assert.equal(Object.hasOwn(cancelBody.properties, 'start'), false, 'Das Absageschema kennt start');
  assert.equal(Object.hasOwn(cancelBody.properties, 'end'), false, 'Das Absageschema kennt end');
  assert.ok(!cancelBody.required.includes('start'), 'start ist bei cancel weiterhin Pflicht');
  assert.ok(!cancelBody.required.includes('end'), 'end ist bei cancel weiterhin Pflicht');
  assert.ok(cancelBody.required.includes('external_event_id'),
    'Die Termin-ID ist bei cancel nicht verbindlich');
  assert.deepEqual(cancelBody.properties.action.enum, ['cancel'],
    'Das Absagewerkzeug laesst mehr als cancel zu');
  assert.deepEqual(cancelBody.properties.agent_id, { type: 'string', dynamic_variable: 'system__agent_id' });
  assert.deepEqual(cancelBody.properties.conversation_id,
    { type: 'string', dynamic_variable: 'system__conversation_id' });
  // Der Adapter leitet die request_id aus conversation_id und agent_turns ab.
  // Ohne agent_turns wuerden zwei Absagen im selben Gespraech denselben
  // Schluessel tragen.
  assert.deepEqual(cancelBody.properties.agent_turns,
    { type: 'number', dynamic_variable: 'system__agent_turns' });

  // Und `cancel` steht im Buchungswerkzeug ABSICHTLICH noch drin.
  //
  // Codex-Befund (P1) vom 12.08.: das Werkzeug ist arbeitsbereichsweit geteilt.
  // Ein PATCH nimmt `cancel` sofort allen Agenten weg, das Absagewerkzeug haengt
  // aber immer nur an dem einen Agenten, der gerade synchronisiert wird. Wird
  // beides in derselben Auslieferung gemacht, haben alle uebrigen
  // Direktbuchungs-Agenten bis zu ihrem naechsten Sync GAR KEINEN Absageweg.
  //
  // Diese Zusicherung ist deshalb bewusst herum: sie haelt Schritt 1 der
  // zweistufigen Umstellung fest. Wer sie umdreht, macht Schritt 2 -- und muss
  // vorher belegen, dass jeder betroffene Agent das neue Werkzeug traegt.
  assert.ok(body.properties.action.enum.includes('cancel'),
    'cancel ist aus dem geteilten Werkzeug entfernt, bevor alle Agenten das Absagewerkzeug haben');
  assert.match(body.properties.action.description, /bevorzugt/,
    'Die Feldbeschreibung lenkt nicht auf das eigene Absagewerkzeug');
  assert.match(body.properties.start.description, /cancel_voxera_appointment/,
    'Die start-Beschreibung nennt den Weg ohne Zeitangaben nicht');

  // Codex-Befund vom 12.08.: dieselbe Auslieferung, die `cancel` aus der
  // Aufzaehlung von manage_voxera_calendar nimmt, legt das Absagewerkzeug erst
  // an. Lief das PATCH auf manage zuerst und scheiterte danach das POST fuer
  // cancel, war der Absageweg weg, ohne dass der Ersatz existierte -- und das
  // Werkzeug ist arbeitsbereichsweit geteilt, der Ausfall haette also alle
  // Agenten getroffen.
  {
    const aufrufe = [];
    const echtesFetch2 = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const pfad = String(url);
      aufrufe.push({ pfad, method: options.method || 'GET', body: options.body });
      const antwort = (payload) => new Response(JSON.stringify(payload), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
      if (pfad.includes('/secrets')) return antwort({ secrets: [], secret_id: 'sec_1' });
      // manage existiert bereits, cancel noch nicht -- genau die Lage aus dem
      // Befund.
      if (pfad.endsWith('/tools?page_size=100')) {
        return antwort({ tools: [{ id: 'tool_manage', tool_config: { name: 'manage_voxera_calendar' } }] });
      }
      // Die ID richtet sich nach dem GESENDETEN Werkzeugnamen.
      //
      // Codex-Befund vom 14.08. (P2): vorher lieferte der Ersatz fuer alles,
      // was nicht manage war, dieselbe ID 'tool_cancel' -- und die Zusicherung
      // unten nahm ['tool_manage','tool_cancel','tool_cancel'] ausdruecklich
      // hin. Damit blieb der Test genau in dem Fehlerfall gruen, in dem das
      // Nachschlagewerkzeug unter der ID des Absagewerkzeugs gefuehrt wird:
      // agentToolIds() entdoppelt die Liste, und der Agent haette gar kein
      // Nachschlagewerkzeug.
      const gesendet = options.body ? JSON.parse(String(options.body))?.tool_config?.name : '';
      const idFuer = {
        manage_voxera_calendar: 'tool_manage',
        cancel_voxera_appointment: 'tool_cancel',
        find_voxera_appointments: 'tool_lookup'
      };
      return antwort({ id: idFuer[gesendet] || 'tool_unbekannt' });
    };
    try {
      helper.resetCache();
      const ids = await helper.ensureWorkspaceTools();
      const schreibend = aufrufe
        .filter((call) => ['POST', 'PATCH'].includes(call.method) && call.pfad.includes('/tools'))
        // Der NAME im Rumpf entscheidet, nicht ein Vorkommen der Zeichenkette:
        // die Beschreibung des Buchungswerkzeugs nennt das Absagewerkzeug
        // selbst, eine Teilstringsuche waere hier blind.
        .map((call) => JSON.parse(String(call.body)).tool_config.name);
      assert.equal(schreibend.at(-1), 'manage_voxera_calendar',
        'Das geteilte Buchungswerkzeug wird geaendert, bevor seine Ersatzwerkzeuge existieren');
      assert.ok(schreibend.includes('cancel_voxera_appointment'));
      assert.ok(schreibend.includes('find_voxera_appointments'));
      // Zurueckgegeben wird in der Reihenfolge der Werkzeugliste, nicht in der
      // Anlegereihenfolge -- und mit DREI verschiedenen IDs. Faellt eine mit
      // einer anderen zusammen, entdoppelt agentToolIds() sie weg und dem
      // Agenten fehlt ein Werkzeug.
      assert.deepEqual(ids, ['tool_manage', 'tool_cancel', 'tool_lookup']);
      assert.equal(new Set(ids).size, 3, 'zwei Kalenderwerkzeuge teilen sich eine ID');
    } finally {
      globalThis.fetch = echtesFetch2;
      helper.resetCache();
    }
  }

  // ── Nachschlagewerkzeug (13.08.) ──────────────────────────────────────────
  //
  // Der Agent konnte die external_event_id eines Termins aus einem FRUEHEREN
  // Gespraech nicht finden -- Absagen war in einem neuen Anruf prinzipiell
  // unmoeglich. Das Werkzeug verlangt bewusst GAR KEINE Angabe zum Termin:
  // alles, was hier stuende, muesste das Modell raten.
  const lookup = helper.buildLookupToolConfig('secret_1');
  assert.equal(lookup.name, 'find_voxera_appointments');
  assert.equal(lookup.api_schema.url, config.api_schema.url);
  const lookupBody = lookup.api_schema.request_body_schema;
  for (const feld of ['start', 'end', 'external_event_id']) {
    assert.equal(Object.hasOwn(lookupBody.properties, feld), false,
      `Das Nachschlageschema verlangt ${feld} -- genau das weiss der Anrufende nicht`);
  }
  assert.deepEqual(lookupBody.required, ['action', 'agent_id', 'conversation_id']);
  assert.deepEqual(lookupBody.properties.action.enum, ['lookup']);

  // Der Server muss die Aktion auch annehmen.
  assert.match(source.core, /'lookup'/, 'Das Werkzeug kennt die Aktion lookup nicht');
  assert.match(source.core, /loadAppointmentHistory/, 'Die Nachschlage-Abfrage fehlt');
  assert.match(source.core, /upcomingAppointments\(/, 'Die Begrenzung auf anstehende Termine fehlt');

  // Prompt: der Weg ueber das Nachschlagen, und das Verbot der Fehldeutung.
  assert.match(block, /find_voxera_appointments/, 'Der Prompt nennt das Nachschlagewerkzeug nicht');
  assert.match(block, /Ein freier Zeitraum ist kein Termin/,
    'Der Prompt verbietet nicht, eine freie Zeit als gefundenen Termin auszugeben');
  assert.match(block, /Mehrere Termine: lies sie vor/,
    'Der Prompt regelt den Mehrfachfall nicht');
  assert.match(block, /Rate nie, welcher gemeint ist/,
    'Der Prompt erlaubt weiterhin zu raten, welcher Termin gemeint ist');

  // Und der Prompt muss den Agenten auf das neue Werkzeug verweisen.
  assert.match(block, /cancel_voxera_appointment/, 'Der Prompt nennt das Absagewerkzeug nicht');
  // Wortlaut seit dem 13.08. beim Nachschlagen statt beim Absagen -- dort wird
  // die Zeitangabe tatsaechlich erspart, die Absage bekommt die ID von dort.
  assert.match(block, /keine Zeitangabe/,
    'Der Prompt sagt nicht, dass der Weg ohne Zeitangabe auskommt');
  assert.match(block, /Frage nicht nach Datum oder Uhrzeit/,
    'Der Prompt laesst den Agenten weiterhin nach der Uhrzeit des Termins fragen');

  // ── Anrufer-Bindung (14.08.) ──────────────────────────────────────────────
  //
  // Bis hierher lieferte `lookup` die anstehenden Termine des KUNDEN, also des
  // Betriebs -- an jeden, der anrief, samt Termin-IDs und damit samt der
  // Moeglichkeit, fremde Termine abzusagen.
  //
  // Gebunden wird an die Anrufernummer, mit der Terminnummer als Rueckfall.
  // Die Nummer kommt von ElevenLabs als system__caller_id.
  for (const [name, schema] of [
    ['manage', body],
    ['cancel', cancelBody],
    ['lookup', lookupBody]
  ]) {
    assert.deepEqual(schema.properties.caller_id, { type: 'string', dynamic_variable: 'system__caller_id' },
      `${name}: die Anrufernummer wird nicht als dynamische Variable gesetzt`);
    // KEINE Pflichtangabe. system__caller_id gibt es nur bei
    // Telefongespraechen; im Widget-Testchat ist sie leer. Stuende sie in
    // `required`, waere das Werkzeug dort unbenutzbar -- und der Testkanal ist
    // genau der, auf dem wir sie am wenigsten haben.
    assert.ok(!schema.required.includes('caller_id'),
      `${name}: caller_id ist Pflicht -- ohne Telefonkanal bricht das Werkzeug damit`);
    assert.ok(!schema.required.includes('booking_reference'),
      `${name}: die Terminnummer ist Pflicht, obwohl die meisten sie nicht zur Hand haben`);
    // Das Modell darf die Anrufernummer nicht selbst befuellen: eine
    // Beschreibung macht aus dem Feld eine LLM-Eingabe, und dann kann der
    // Agent sich seine Zuordnung erfinden.
    assert.equal(Object.hasOwn(schema.properties.caller_id, 'description'), false,
      `${name}: caller_id traegt eine Beschreibung und wird damit vom Modell befuellbar`);
  }
  // Der Rueckfall muss dort stehen, wo er gebraucht wird: beim Nachschlagen und
  // beim Absagen.
  assert.match(lookupBody.properties.booking_reference.description, /Terminnummer/,
    'Das Nachschlagewerkzeug kennt die Terminnummer nicht');
  assert.match(cancelBody.properties.booking_reference.description, /Terminnummer/,
    'Das Absagewerkzeug kennt die Terminnummer nicht');
  assert.match(lookupBody.properties.booking_reference.description, /[Nn]iemals erfinden/,
    'Die Terminnummer darf geraten werden');

  // Server: die Bindung, ihre beiden Richtungen, und die Filterung.
  for (const token of [
    "require('./_lib/caller-identity')",
    'identityFromBody(body)',
    'matchAppointments(anstehende, identitaet)',
    'ownershipConflict(',
    'caller_reference:',
    'booking_reference:'
  ]) {
    if (!source.core.includes(token)) failures.push('Anrufer-Bindung fehlt im Werkzeug: ' + token);
  }

  // Prompt: die Terminnummer wird vorgelesen, und der Nicht-Zuordnungsfall
  // fuehrt zur Frage danach -- nicht in die Rueckrufaufnahme und erst recht
  // nicht in eine Suche mit availability.
  assert.match(block, /booking_reference/, 'Der Prompt kennt die Terminnummer nicht');
  // Zwei Gründe, zwei verschiedene Sätze. In der ersten Fassung fielen sie
  // zusammen -- und genau dadurch war der Rückfall auf die Terminnummer für
  // Anrufe von einer anderen Nummer unerreichbar (Codex-P1).
  assert.match(block, /calendar_appointment_unmatched/,
    'Der Prompt behandelt den Fall "nicht zugeordnet" nicht');
  assert.match(block, /calendar_booking_reference_unknown/,
    'Der Prompt behandelt eine falsch verstandene Terminnummer nicht');
  for (const grund of ['calendar_appointment_unmatched', 'calendar_booking_reference_unknown']) {
    if (!source.core.includes(grund)) failures.push('Der Grund fehlt im Werkzeug: ' + grund);
  }

  // Und der dritte darf NICHT zurückkommen. Er meldete betriebsweiten Zustand
  // an einen beliebigen Anrufer -- und behauptete dabei etwas, das die Zahl
  // gar nicht deckte (Altbestand und fremde Kalender fehlen darin).
  if (source.core.includes('calendar_no_upcoming_appointment')) {
    failures.push('Der Grund "kein anstehender Termin" ist zurück -- er verrät betriebsweiten Zustand');
  }
  // Der alte Wortlaut von Schritt 16, wörtlich. Kommt er zurück, behauptet der
  // Agent wieder etwas über fremde Termine.
  assert.ok(!/steht überhaupt kein Termin an/.test(block),
    'Der Prompt behauptet wieder, es gebe keinen Termin — das wissen wir nicht');
  assert.match(block, /Sage dabei nie, es gebe keinen Termin/,
    'Dem Agenten ist nicht verboten, "Sie haben keinen Termin" zu sagen');

  // Die Terminnummer wird gezogen, BEVOR der Anbieter etwas ändert.
  //
  // Codex-Befund vom 14.08. (P2): die Ziehung kann bei erschöpftem Nummernraum
  // abbrechen. Steht sie hinter dem Anbieteraufruf, ist der Termin angelegt
  // bzw. verschoben, die Antwort lautet 503, und keine Erfolgszeile hält fest,
  // was im Kalender passiert ist.
  //
  // Am laufenden Handler ist das nicht prüfbar — der Abbruch verlangt einen
  // erschöpften Nummernraum, den ein Test nicht herstellen kann. Geprüft wird
  // deshalb die Reihenfolge im Quelltext. Das ist schwächer als ein Fall, aber
  // es fängt genau die Änderung, die den Befund zurückbrächte.
  for (const [zweig, anbieteraufruf] of [['book', 'createEvent('], ['reschedule', 'updateEvent(']]) {
    const start = source.core.indexOf(`action === '${zweig}'`);
    const ende = zweig === 'book'
      ? source.core.indexOf("action === 'reschedule'", start)
      : source.core.indexOf('\n    } else {', start);
    const abschnitt = source.core.slice(start, ende > start ? ende : undefined);
    const ziehung = abschnitt.indexOf('bookingReference(');
    const aenderung = abschnitt.indexOf(anbieteraufruf);
    assert.ok(ziehung >= 0 && aenderung >= 0,
      `${zweig}: Ziehung oder Anbieteraufruf nicht gefunden`);
    assert.ok(ziehung < aenderung,
      `${zweig}: die Terminnummer wird erst nach ${anbieteraufruf} gezogen — ein Abbruch liesse den Kalender geändert zurück`);
  }

  // GRENZE: eine Anrufernummer ist keine Authentifizierung. Sie ist faelschbar.
  // Der Prompt darf sie nirgends als Schutz darstellen -- ein Satz wie "nur Sie
  // koennen Ihren Termin absagen" waere ein Versprechen ohne Deckung.
  assert.ok(!/[Ss]icherheit|[Aa]uthentifiz|[Ii]dentität bestätig|[Vv]erifizier|zu Ihrem Schutz|nur Sie können/.test(block),
    'Der Prompt stellt die Anrufernummer als Sicherheitsmerkmal dar');
  // Und die Grenze muss im Code stehen, nicht nur im Ticket.
  assert.match(fs.readFileSync('customer-dashboard/netlify/functions/_lib/caller-identity.js', 'utf8'),
    /KEINE AUTHENTIFIZIERUNG/,
    'Die Grenze der Anrufernummer ist im Code nicht benannt');
} catch (error) {
  failures.push('Provisioning helper contract failed: ' + error.message);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('ElevenLabs calendar tool provisioning verification passed.');
