// Prueft den Audit-Pfad von calendar-tool.js am laufenden Handler.
//
// Die uebrigen Kalender-Checks lesen den Quelltext nach Merkmalen ab. Fuer die
// Frage "wie viele Zeilen schreibt ein availability-Aufruf" reicht das nicht:
// der Codex-Befund vom 12.08. war, dass ZWEI Erfolgszeilen entstanden, weil der
// generische Nachlauf `claimedAuditId` als Signal "es gibt schon eine Zeile"
// benutzte -- ein Signal, das availability nie setzt, weil die Aktion keine
// request_id fuehrt. Beide Zeilen sind einzeln betrachtet korrekt; falsch ist
// erst ihre Anzahl. Eine Zeichenkettensuche kann das nicht sehen.
//
// Supabase und die Kalenderanbieter sind hier gestellt. Geprueft wird die
// Verdrahtung im Werkzeug, nicht die Fremdsysteme.

import assert from 'node:assert/strict';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let failed = 0;
function check(name, fn) {
  return fn().then(
    () => console.log('PASS ' + name),
    (error) => { failed += 1; console.error('FAIL ' + name + ': ' + error.message); }
  );
}

// ── Gestellte Supabase-Kette ────────────────────────────────────────────────
//
// Der echte Client kettet .select().eq().maybeSingle() und ist am Ende
// awaitbar. Dieser Ersatz nimmt jeden Methodenaufruf entgegen, merkt ihn sich
// und fragt beim Aufloesen eine Tabelle von Antworten.
const KETTENGLIEDER = ['select', 'eq', 'in', 'lt', 'gt', 'limit', 'maybeSingle', 'order', 'neq'];

function makeSupabase({ answers = {} } = {}) {
  const inserts = [];
  const updates = [];

  function chain(table) {
    const ops = [];
    const self = {
      // Awaitbar: erst beim Aufloesen wird die Antworttabelle gefragt, und zwar
      // mit der gesammelten Aufrufkette -- so kann ein Testfall zwischen
      // "insert" und "select" auf derselben Tabelle unterscheiden.
      then(resolve, reject) {
        const answer = answers[table];
        try {
          const result = typeof answer === 'function' ? answer(ops) : (answer ?? { data: null, error: null });
          return Promise.resolve(result).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      }
    };
    for (const name of KETTENGLIEDER) {
      self[name] = (...args) => { ops.push({ name, args }); return self; };
    }
    self.insert = (row) => {
      ops.push({ name: 'insert', args: [row] });
      inserts.push({ table, row });
      return self;
    };
    self.update = (patch) => {
      ops.push({ name: 'update', args: [patch] });
      updates.push({ table, patch });
      return self;
    };
    return self;
  }

  return { client: { from: chain }, inserts, updates };
}

// ── Modulersatz ─────────────────────────────────────────────────────────────
const stubs = new Map();
const echtesLoad = Module._load;
Module._load = function (request, parent, isMain) {
  for (const [key, value] of stubs) {
    if (request === key || request.endsWith(key)) return value;
  }
  return echtesLoad.call(this, request, parent, isMain);
};

let aktuellerClient = null;
let verfuegbarkeit = { available: true, busy: [] };
let providerFehler = null;
// Wie `verfuegbarkeit`: eine Modulvariable, KEINE Eigenschaft am Stub-Objekt.
// calendar-tool.js destrukturiert die Anbieterfunktionen beim Require -- eine
// spaetere Zuweisung an stubs.get(...).deleteEvent erreicht die Bindung nicht
// mehr und der Fall waere still gruen.
let loeschErgebnis = { deleted: true, already_missing: false };

stubs.set('@supabase/supabase-js', { createClient: () => aktuellerClient });
stubs.set('./_lib/calendar-providers', {
  ensureAccessToken: async () => ({ accessToken: 'token', connection: {} }),
  checkAvailability: async () => {
    if (providerFehler) throw providerFehler;
    return verfuegbarkeit;
  },
  createEvent: async () => ({ id: 'evt_1', htmlLink: 'https://example.invalid/evt_1' }),
  updateEvent: async () => ({ id: 'evt_1' }),
  deleteEvent: async () => loeschErgebnis
});

process.env.CALENDAR_INTEGRATION_ENABLED = 'true';
process.env.CALENDAR_TOOL_WEBHOOK_SECRET = 'test-secret';
process.env.CALENDAR_ROLLOUT_CUSTOMER_IDS = '*';
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { handler } = require('../customer-dashboard/netlify/functions/calendar-tool.js');

const WOCHE = { mon: [['08:00', '17:00']], tue: [['08:00', '17:00']], wed: [['08:00', '17:00']], thu: [['08:00', '17:00']], fri: [['08:00', '17:00']], sat: [], sun: [] };
const SETTINGS = {
  feature_enabled: true,
  active_provider: 'google',
  timezone: 'Europe/Zurich',
  appointment_duration_minutes: 30,
  business_hours: WOCHE,
  minimum_notice_minutes: 0,
  booking_horizon_days: 3650
};
const CONNECTION = { id: 'conn_1', provider: 'google', selected_calendar_id: 'cal_1', status: 'connected' };

// Weit in der Zukunft und ein Dienstag, damit Mindestvorlauf und Wochentag
// nicht mit hineinspielen: 2027-08-10 ist ein Dienstag.
const DI = (zeit) => `2027-08-10T${zeit}:00+02:00`;

function antworten({ settings = SETTINGS, connection = CONNECTION } = {}) {
  return {
    customers: (ops) => (ops.some((op) => op.name === 'select' && String(op.args[0]).includes('ai_opening_hours'))
      ? { data: { ai_opening_hours: WOCHE }, error: null }
      : { data: { id: 'cust_1', elevenlabs_agent_id: 'agent_1' }, error: null }),
    calendar_settings: { data: settings, error: null },
    calendar_connections: { data: connection, error: null },
    customer_operational_updates: { data: [], error: null },
    calendar_booking_audit: (ops) => (ops.some((op) => op.name === 'insert')
      ? { data: { id: 'audit_1' }, error: null }
      : { data: null, error: null })
  };
}

async function ruf(body, optionen = {}) {
  const supabase = makeSupabase({ answers: antworten(optionen) });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify(body)
  });
  return { response, payload: JSON.parse(response.body), supabase };
}

const auditZeilen = (supabase) => supabase.inserts.filter((entry) => entry.table === 'calendar_booking_audit');

// ── Punkt 3: eine Zeile je availability-Aufruf ──────────────────────────────

await check('availability schreibt genau EINE Audit-Zeile', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  const { payload, supabase } = await ruf({
    action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00')
  });
  assert.equal(payload.ok, true, JSON.stringify(payload));
  const zeilen = auditZeilen(supabase);
  assert.equal(zeilen.length, 1, `erwartet 1 Zeile, geschrieben: ${zeilen.length}`);
  assert.equal(zeilen[0].row.status, 'success');
  assert.equal(zeilen[0].row.action, 'availability');
  assert.equal(zeilen[0].row.provider, 'google');
  // Die Zeile bleibt schlank: kein busy-Array, keine Rohantwort, keine
  // Zeitstempel der freien Termine -- sie soll den Kalender des Kunden nicht in
  // unsere Audit-Tabelle spiegeln.
  assert.equal(Object.hasOwn(zeilen[0].row.details, 'busy'), false);
  assert.equal(Object.hasOwn(zeilen[0].row.details, 'response'), false);
  assert.equal(zeilen[0].row.details.free_slot_count, 8);
});

await check('availability schreibt auch im Fehlerfall genau EINE Zeile', async () => {
  providerFehler = Object.assign(new Error('calendar_provider_api_failed'), { status: 502 });
  try {
    const { response, payload, supabase } = await ruf({
      action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00')
    });
    assert.equal(payload.ok, false);
    assert.equal(response.statusCode, 502);
    const zeilen = auditZeilen(supabase);
    assert.equal(zeilen.length, 1, `erwartet 1 Zeile, geschrieben: ${zeilen.length}`);
    assert.equal(zeilen[0].row.status, 'failed');
    assert.equal(zeilen[0].row.provider, 'google');
  } finally { providerFehler = null; }
});

// ── Punkt 1 am Handler: der Halbtag ist teilbar ─────────────────────────────

await check('Ein belegter Termin nimmt dem Halbtag nicht die Verfuegbarkeit', async () => {
  verfuegbarkeit = { available: false, busy: [{ id: 'e1', start: DI('09:00'), end: DI('09:30') }] };
  const { payload } = await ruf({
    action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00')
  });
  // Der Kern des Befunds: der Anbieter meldet available:false fuer den Block,
  // das Werkzeug antwortet trotzdem mit buchbaren Zeiten.
  assert.equal(payload.available, true);
  assert.equal(payload.whole_window_free, false);
  assert.equal(payload.free_slots_total, 7);
  assert.equal(payload.free_slots.length, 3, 'hoechstens drei Vorschlaege');
  assert.equal(payload.free_slots[0].start, new Date(DI('08:00')).toISOString());
  assert.ok(!payload.free_slots.some((slot) => slot.start === new Date(DI('09:00')).toISOString()));
  assert.equal(Object.hasOwn(payload, 'reason'), false);
});

// Codex-Befund vom 12.08.: `whole_window_free` wurde aus der Kandidatenzahl
// abgeleitet. Die Kandidaten decken das Fenster nur bis zum letzten vollen
// Termin ab -- ein Eintrag im angebrochenen Rest liess alle Kandidaten frei und
// haette "ganzer Zeitraum frei" behauptet, wo die alte Antwort "belegt" hiess.
await check('Ein Termin im angebrochenen Rest nimmt whole_window_free weg', async () => {
  verfuegbarkeit = { available: false, busy: [{ id: 'e1', start: DI('12:20'), end: DI('12:25') }] };
  const { payload } = await ruf({
    action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:29')
  });
  // Acht volle Termine passen hinein, alle frei -- der belegte Eintrag liegt im
  // Rest zwischen 12:00 und 12:29.
  assert.equal(payload.free_slots_total, 8);
  assert.equal(payload.available, true);
  assert.equal(payload.whole_window_free, false,
    'whole_window_free behauptet mehr, als geprueft wurde');
});

await check('whole_window_free gilt nur mit befragtem Kalender', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  // Samstag: kein Buchungsfenster, also keine Abfrage -- und damit auch keine
  // Aussage darueber, ob der Zeitraum frei ist.
  const { payload } = await ruf({
    action: 'availability', agent_id: 'agent_1',
    start: '2027-08-14T08:00:00+02:00', end: '2027-08-14T12:00:00+02:00'
  });
  assert.equal(payload.whole_window_free, false);
});

await check('Ein wirklich freier Zeitraum meldet whole_window_free', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  const { payload } = await ruf({
    action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00')
  });
  assert.equal(payload.whole_window_free, true);
  assert.equal(payload.free_slots_total, 8);
});

await check('Ein voll belegter Halbtag antwortet mit Begruendung', async () => {
  verfuegbarkeit = { available: false, busy: [{ id: 'e1', start: DI('08:00'), end: DI('12:00') }] };
  const { payload } = await ruf({
    action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00')
  });
  assert.equal(payload.available, false);
  assert.deepEqual(payload.free_slots, []);
  assert.equal(payload.reason, 'calendar_no_free_slot');
});

await check('Ein geschlossener Tag fragt den Kalender gar nicht erst', async () => {
  let gefragt = false;
  verfuegbarkeit = { available: true, busy: [] };
  const vorher = stubs.get('./_lib/calendar-providers').checkAvailability;
  stubs.get('./_lib/calendar-providers').checkAvailability = async () => { gefragt = true; return verfuegbarkeit; };
  try {
    // 2027-08-14 ist ein Samstag, an dem keine Buchungszeiten liegen.
    const { payload } = await ruf({
      action: 'availability', agent_id: 'agent_1',
      start: '2027-08-14T08:00:00+02:00', end: '2027-08-14T12:00:00+02:00'
    });
    assert.equal(payload.available, false);
    assert.equal(payload.reason, 'calendar_closed_on_this_day');
    assert.equal(gefragt, false, 'Der Kalender wurde ohne Not befragt');
  } finally { stubs.get('./_lib/calendar-providers').checkAvailability = vorher; }
});

await check('Ein Fenster kuerzer als die Termindauer meldet das eigens', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  const { payload } = await ruf({
    action: 'availability', agent_id: 'agent_1', start: DI('10:00'), end: DI('10:15')
  });
  assert.equal(payload.available, false);
  assert.equal(payload.reason, 'calendar_time_window_shorter_than_appointment');
});

// Codex-Befund (P1) vom 12.08.: der Mindestvorlauf galt fuer den Fensteranfang
// und warf. "Heute" landete damit im FEHLERPFAD -- der Anrufende hoerte die
// Rueckruf-Formel statt "so kurzfristig geht es nicht". Jetzt eine Antwort mit
// Grund, und spaetere Termine desselben Halbtags bleiben buchbar.
await check('Zu kurzfristig ist eine Antwort, kein Werkzeugfehler', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  // Fester Dienstag innerhalb der Buchungszeiten, damit nur der Vorlauf greift
  // und nicht das Wochenraster -- ein Fenster relativ zur echten Uhrzeit waere
  // je nach Laufzeitpunkt aus einem anderen Grund abgelehnt worden. Der Vorlauf
  // ist absichtlich laenger als der Abstand bis zum Testdatum.
  const { response, payload } = await ruf({
    action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00')
  }, { settings: { ...SETTINGS, minimum_notice_minutes: 5000000 } });
  assert.equal(response.statusCode, 200, 'der Vorlauf erzeugt weiterhin einen Fehler');
  assert.equal(payload.ok, true);
  assert.equal(payload.available, false);
  assert.equal(payload.reason, 'calendar_minimum_notice_not_met');
  assert.deepEqual(payload.free_slots, []);
});

// Codex-Befund vom 12.08., direkt nach dem Verschieben des Vorlaufs: ein
// Fenster, das IM Vorlauf beginnt und darueber hinausreicht, behaelt seine
// spaeteren Termine -- und meldete "ganzer Zeitraum frei", obwohl der Anfang
// nicht buchbar ist. Die alte Fassung haette die Anfrage ganz abgelehnt.
await check('Ein Vorlauf mitten im Fenster nimmt whole_window_free weg', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  // Der Vorlauf wird so gewaehlt, dass die Grenze auf 09:59 des Testtags
  // faellt -- unabhaengig davon, wann der Test laeuft.
  const bisKurzVorZehn = Math.round((new Date(DI('10:00')).getTime() - Date.now()) / 60000) - 1;
  const { payload } = await ruf({
    action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00')
  }, { settings: { ...SETTINGS, minimum_notice_minutes: bisKurzVorZehn } });
  assert.equal(payload.available, true, 'die spaeteren Termine muessen buchbar bleiben');
  assert.equal(payload.free_slots_total, 4, 'erwartet 10:00, 10:30, 11:00, 11:30');
  assert.equal(payload.whole_window_free, false,
    'whole_window_free behauptet den ganzen Zeitraum, obwohl der Anfang im Vorlauf liegt');
});

// ── Punkt 2 am Handler: Absage ohne Zeitangaben ─────────────────────────────

await check('cancel kommt ohne start und end durch', async () => {
  const supabase = makeSupabase({
    answers: {
      ...antworten(),
      // Der Termin muss als von Voxera verwaltet nachweisbar sein.
      calendar_booking_audit: (ops) => {
        if (ops.some((op) => op.name === 'insert')) return { data: { id: 'audit_1' }, error: null };
        if (ops.some((op) => op.name === 'limit')) return { data: [{ id: 'audit_alt' }], error: null };
        return { data: null, error: null };
      }
    }
  });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({
      action: 'cancel', agent_id: 'agent_1', request_id: 'req_1', external_event_id: 'evt_1'
    })
  });
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true, JSON.stringify(payload));
  assert.equal(payload.cancelled, true);
  // Genau eine Zeile: der claim. Der Abschluss ist ein update darauf.
  assert.equal(auditZeilen(supabase).length, 1);
  assert.equal(auditZeilen(supabase)[0].row.status, 'processing');
  assert.ok(supabase.updates.some((entry) => entry.patch.status === 'success'));
});

// ── Einrichtungsfehler hinterlassen ebenfalls eine Spur ─────────────────────
//
// Codex-Befund vom 12.08.: die beiden Ausgaenge fuer "nicht freigeschaltet" und
// "Verbindung nicht bereit" verliessen den Handler mit `return`, ohne den catch
// zu beruehren -- also ohne Audit-Zeile. Es sind aber gerade die
// Einrichtungsfehler, bei denen die Spur gebraucht wird.

await check('Nicht freigeschalteter Kalender schreibt eine Zeile', async () => {
  const supabase = makeSupabase({
    answers: { ...antworten(), calendar_settings: { data: { ...SETTINGS, feature_enabled: false }, error: null } }
  });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00') })
  });
  // Antwortform und Statuscode bleiben, was sie waren.
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { ok: false, error: 'calendar_not_enabled_for_customer' });
  const zeilen = auditZeilen(supabase);
  assert.equal(zeilen.length, 1, 'der Einrichtungsfehler hinterlaesst keine Spur');
  assert.equal(zeilen[0].row.status, 'failed');
  assert.equal(zeilen[0].row.details.error, 'calendar_not_enabled_for_customer');
});

await check('Nicht bereite Verbindung schreibt eine Zeile', async () => {
  const supabase = makeSupabase({
    answers: { ...antworten(), calendar_connections: { data: { ...CONNECTION, selected_calendar_id: null }, error: null } }
  });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00') })
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { ok: false, error: 'calendar_connection_not_ready' });
  const zeilen = auditZeilen(supabase);
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0].row.status, 'failed');
  // Der Anbieter ist hier aus settings.active_provider immer bekannt, die
  // Zeile entsteht also verlaesslich und nicht nur manchmal.
  assert.equal(zeilen[0].row.provider, 'google');
});

// Codex-Befund vom 12.08.: der Rollout-Ausgang kehrte vor allem anderen zurueck
// -- weder Audit-Zeile noch Logzeile. Es ist der Fall "Werkzeug haengt am
// Agenten, Kunde aber nicht freigeschaltet", und der fiel voellig lautlos aus.
await check('Ein nicht freigeschalteter Kunde hinterlaesst wenigstens eine Logzeile', async () => {
  const geloggt = [];
  const echtesError = console.error;
  const vorher = process.env.CALENDAR_ROLLOUT_CUSTOMER_IDS;
  console.error = (...args) => geloggt.push(args);
  process.env.CALENDAR_ROLLOUT_CUSTOMER_IDS = 'ein-anderer-kunde';
  try {
    const supabase = makeSupabase({ answers: antworten() });
    aktuellerClient = supabase.client;
    const response = await handler({
      httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({ action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00') })
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(JSON.parse(response.body), { ok: false, error: 'calendar_customer_not_enabled' });
    // Eine Audit-ZEILE geht hier nicht: der Anbieter ist noch unbekannt und die
    // Spalte laesst keinen Ersatzwert zu. Die laute Logzeile muss aber da sein.
    assert.deepEqual(auditZeilen(supabase), []);
    assert.ok(geloggt.some((args) => String(args[0]).includes('audit_uebersprungen_anbieter_unbekannt')),
      'der Rollout-Ausgang faellt weiterhin lautlos aus');
  } finally {
    console.error = echtesError;
    process.env.CALENDAR_ROLLOUT_CUSTOMER_IDS = vorher;
  }
});

// ── Nachschlagen: anstehende Termine aus unserer eigenen Tabelle ────────────
//
// Anlass: Testanruf vom 13.08. Der Agent kann die external_event_id eines
// Termins aus einem FRUEHEREN Gespraech nicht finden -- Absagen war in einem
// neuen Anruf prinzipiell unmoeglich.

// Zwei Anrufende beim selben Betrieb. Bis zum 14.08. las das Nachschlagen
// jedem von beiden die Termine des anderen vor, samt Termin-IDs.
const ANRUFER_A = '+41791234567';
const ANRUFER_B = '+41799999999';
const BELEG_B = '654321';

// Historie: gebucht, verschoben, abgesagt, plus ein vergangener Termin.
//
// `calendar_id` steht seit dem 14.08. in jeder Zeile, die im Nachschlagen
// auftauchen soll -- eine Zeile ohne ihn gilt nicht mehr als "gehoert zum
// aktuellen Kalender" (Codex-P2, siehe evt_ohne_kalender unten).
const HISTORIE = [
  { external_event_id: 'evt_alt', connection_id: 'conn_1', action: 'book', created_at: '2026-08-01T10:00:00Z',
    details: { caller_reference: ANRUFER_A, calendar_id: 'cal_1', response: { start: '2026-08-05T08:00:00.000Z', end: '2026-08-05T08:30:00.000Z' } } },
  { external_event_id: 'evt_a', connection_id: 'conn_1', action: 'book', created_at: '2026-08-02T10:00:00Z',
    details: { caller_reference: ANRUFER_A, booking_reference: '111111', calendar_id: 'cal_1',
               response: { start: '2027-08-10T06:00:00.000Z', end: '2027-08-10T06:30:00.000Z' } } },
  { external_event_id: 'evt_b', connection_id: 'conn_1', action: 'book', created_at: '2026-08-03T10:00:00Z',
    details: { caller_reference: ANRUFER_A, booking_reference: '222222', calendar_id: 'cal_1',
               response: { start: '2027-08-11T06:00:00.000Z', end: '2027-08-11T06:30:00.000Z' } } },
  { external_event_id: 'evt_b', connection_id: 'conn_1', action: 'reschedule', created_at: '2026-08-04T10:00:00Z',
    details: { caller_reference: ANRUFER_A, booking_reference: '222222', calendar_id: 'cal_1',
               response: { start: '2027-08-12T09:00:00.000Z', end: '2027-08-12T09:30:00.000Z' } } },
  { external_event_id: 'evt_weg', connection_id: 'conn_1', action: 'book', created_at: '2026-08-05T10:00:00Z',
    details: { caller_reference: ANRUFER_A, calendar_id: 'cal_1', response: { start: '2027-08-13T06:00:00.000Z', end: '2027-08-13T06:30:00.000Z' } } },
  { external_event_id: 'evt_weg', connection_id: 'conn_1', action: 'cancel', created_at: '2026-08-06T10:00:00Z',
    details: { caller_reference: ANRUFER_A, calendar_id: 'cal_1', response: { cancelled: true } } },
  // Codex-Befund vom 13.08. (P1): Buchungen aus einer frueheren Verbindung oder
  // von einem anderen Kalender sind heute nicht mehr absagbar.
  { external_event_id: 'evt_fremde_verbindung', action: 'book', created_at: '2026-08-07T10:00:00Z',
    connection_id: 'conn_alt',
    details: { caller_reference: ANRUFER_A, calendar_id: 'cal_1', response: { start: '2027-08-14T06:00:00.000Z', end: '2027-08-14T06:30:00.000Z' } } },
  { external_event_id: 'evt_fremder_kalender', action: 'book', created_at: '2026-08-08T10:00:00Z',
    connection_id: 'conn_1',
    details: { caller_reference: ANRUFER_A, response: { start: '2027-08-15T06:00:00.000Z', end: '2027-08-15T06:30:00.000Z' },
               calendar_id: 'cal_anderer' } },
  // Codex-Befund vom 14.08. (P2): `select_calendar` setzt selected_calendar_id
  // auf der BESTEHENDEN Verbindungszeile um -- die connection_id bleibt gleich.
  // Eine Altbuchung ohne Kalender-ID kam deshalb durch die Verbindungspruefung
  // und liess sich danach nur im 409-Rueckfall absagen.
  { external_event_id: 'evt_ohne_kalender', connection_id: 'conn_1', action: 'book', created_at: '2026-08-08T12:00:00Z',
    details: { caller_reference: ANRUFER_A, booking_reference: '333333',
               response: { start: '2027-08-16T06:00:00.000Z', end: '2027-08-16T06:30:00.000Z' } } },
  // Der Termin einer ANDEREN anrufenden Person. Bewusst der frueheste der
  // anstehenden -- leckt die Filterung, steht er ganz oben in der Liste.
  { external_event_id: 'evt_fremd', connection_id: 'conn_1', action: 'book', created_at: '2026-08-09T10:00:00Z',
    details: { caller_reference: ANRUFER_B, booking_reference: BELEG_B, calendar_id: 'cal_1',
               response: { start: '2027-08-09T06:00:00.000Z', end: '2027-08-09T06:30:00.000Z' } } },
  // Altbestand: vor dem 14.08. gebucht, traegt deshalb keine Bindung.
  { external_event_id: 'evt_ohne_bindung', connection_id: 'conn_1', action: 'book', created_at: '2026-08-10T10:00:00Z',
    details: { calendar_id: 'cal_1', response: { start: '2027-08-08T06:00:00.000Z', end: '2027-08-08T06:30:00.000Z' } } }
];

// Ein Betrieb ohne jeden anstehenden Termin -- gebraucht fuer die
// Unterscheidung "kein Termin" gegen "nicht zugeordnet".
const HISTORIE_LEER = [
  { external_event_id: 'evt_vorbei', connection_id: 'conn_1', action: 'book', created_at: '2026-08-01T10:00:00Z',
    details: { caller_reference: ANRUFER_A, calendar_id: 'cal_1', response: { start: '2026-08-05T08:00:00.000Z', end: '2026-08-05T08:30:00.000Z' } } }
];

const mitHistorie = (zeilen = HISTORIE) => ({
  ...antworten(),
  calendar_booking_audit: (ops) => {
    if (ops.some((op) => op.name === 'insert')) return { data: { id: 'audit_1' }, error: null };
    if (ops.some((op) => op.name === 'order')) return { data: zeilen, error: null };
    if (ops.some((op) => op.name === 'limit')) return { data: [{ id: 'audit_alt' }], error: null };
    return { data: null, error: null };
  }
});

await check('lookup liefert anstehende Termine ohne jede Zeitangabe', async () => {
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ action: 'lookup', agent_id: 'agent_1', caller_id: ANRUFER_A })
  });
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true, JSON.stringify(payload));
  const ids = payload.appointments.map((termin) => termin.external_event_id);
  assert.ok(ids.includes('evt_a'), 'die offene Buchung fehlt');
  assert.ok(ids.includes('evt_b'), 'der verschobene Termin fehlt');
  assert.ok(!ids.includes('evt_weg'), 'ein abgesagter Termin wird weiterhin angeboten');
  assert.ok(!ids.includes('evt_alt'), 'ein vergangener Termin wird angeboten');
  assert.ok(!ids.includes('evt_fremde_verbindung'),
    'ein Termin aus einer frueheren Verbindung wird angeboten -- er ist heute nicht absagbar');
  assert.ok(!ids.includes('evt_fremder_kalender'),
    'ein Termin von einem anderen Kalender wird angeboten -- das DELETE liefe ins Leere');
  assert.equal(payload.appointment_count, 2);
  // Der verschobene Termin traegt die NEUE Zeit, nicht die der Buchung.
  const b = payload.appointments.find((termin) => termin.external_event_id === 'evt_b');
  assert.equal(b.start, '2027-08-12T09:00:00.000Z');
  // Aufsteigend sortiert.
  assert.deepEqual(ids, ['evt_a', 'evt_b']);
});

await check('lookup schreibt genau eine Audit-Zeile und nennt keine Termine darin', async () => {
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ action: 'lookup', agent_id: 'agent_1', caller_id: ANRUFER_A })
  });
  const zeilen = auditZeilen(supabase);
  assert.equal(zeilen.length, 1, `erwartet 1 Zeile, geschrieben: ${zeilen.length}`);
  assert.equal(zeilen[0].row.action, 'lookup');
  assert.equal(zeilen[0].row.details.appointment_count, 2);
  assert.equal(Object.hasOwn(zeilen[0].row.details, 'appointments'), false);
  // Ohne diese drei Felder liesse sich "warum fand er meinen Termin nicht"
  // spaeter nicht beantworten: die blosse Null unterscheidet nicht zwischen
  // "kein Termin" und "Zuordnung danebengegangen".
  assert.equal(zeilen[0].row.details.identified_by, 'caller_id');
  assert.equal(zeilen[0].row.details.caller_reference, ANRUFER_A);
  assert.equal(zeilen[0].row.details.upcoming_total, 4);
});

await check('lookup braucht keine request_id', async () => {
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ action: 'lookup', agent_id: 'agent_1', caller_id: ANRUFER_A })
  });
  assert.equal(response.statusCode, 200);
  assert.notEqual(JSON.parse(response.body).error, 'calendar_request_id_required');
});

// ── Anrufer-Bindung (14.08.) ───────────────────────────────────────────────
//
// Vorher lieferte lookup die anstehenden Termine des KUNDEN -- also des
// Betriebs -- an jeden, der anrief. Mit Termin-ID, und damit mit der
// Moeglichkeit, den Termin einer fremden Person abzusagen.
//
// GRENZE: die Anrufernummer ist eine Zuordnung, kein Nachweis. Sie ist
// faelschbar. Diese Pruefungen halten fest, dass die Zuordnung greift -- nicht,
// dass sie jemanden aussperrt, der es darauf anlegt.

const lookupRuf = (body, zeilen = HISTORIE) => {
  const supabase = makeSupabase({ answers: mitHistorie(zeilen) });
  aktuellerClient = supabase.client;
  return handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ action: 'lookup', agent_id: 'agent_1', ...body })
  }).then((response) => ({ response, payload: JSON.parse(response.body), supabase }));
};

await check('lookup nennt keine Termine fremder Anrufender', async () => {
  const { payload } = await lookupRuf({ caller_id: ANRUFER_A });
  const ids = payload.appointments.map((termin) => termin.external_event_id);
  assert.ok(!ids.includes('evt_fremd'),
    'der Termin einer anderen anrufenden Person wird vorgelesen -- samt Termin-ID');
  assert.equal(payload.appointment_count, 2);
  assert.equal(payload.identified_by, 'caller_id');
});

await check('Ohne Anrufernummer und ohne Terminnummer gibt es nichts zu hoeren', async () => {
  const { payload } = await lookupRuf({});
  assert.deepEqual(payload.appointments, []);
  assert.equal(payload.appointment_count, 0);
  assert.equal(payload.identified_by, 'none');
  // Eigener Grund: er fuehrt im Prompt zur Frage nach der Terminnummer und
  // nicht in die Rueckrufaufnahme.
  assert.equal(payload.reason, 'calendar_appointment_unmatched');
});

// Codex-Befund vom 14.08. (P1): der Rueckfall auf die Terminnummer war
// UNERREICHBAR. Wer von einem anderen Anschluss anruft, hat eine gueltige
// Anrufernummer -- die erste Fassung leitete daraus "kein Termin vorhanden" ab
// und liess den Agenten eine Rueckrufanfrage aufnehmen, statt nach der Nummer
// zu fragen. Genau der Fall, fuer den Rueckfall B gebaut wurde; Abnahmepunkt 13
// waere daran gescheitert.
await check('Ein Anruf von einer anderen Nummer fuehrt zur Terminnummer', async () => {
  const { payload } = await lookupRuf({ caller_id: '+41780000000' });
  assert.equal(payload.appointment_count, 0);
  assert.equal(payload.identified_by, 'caller_id');
  assert.equal(payload.reason, 'calendar_appointment_unmatched',
    'der Anruf von einer anderen Nummer landet in der Rueckrufaufnahme statt bei der Terminnummer');
});

await check('Eine unbekannte Terminnummer wird nicht als "kein Termin" abgetan', async () => {
  const { payload } = await lookupRuf({ booking_reference: '999999' });
  assert.equal(payload.appointment_count, 0);
  assert.equal(payload.identified_by, 'booking_reference');
  assert.equal(payload.reason, 'calendar_booking_reference_unknown',
    'die falsch verstandene Nummer laesst sich nicht mehr zurueckfragen');
});

await check('Die Terminnummer ist der Rueckfall ohne Anrufernummer', async () => {
  const { payload } = await lookupRuf({ booking_reference: BELEG_B });
  assert.deepEqual(payload.appointments.map((termin) => termin.external_event_id), ['evt_fremd']);
  assert.equal(payload.identified_by, 'booking_reference');
  assert.equal(Object.hasOwn(payload, 'reason'), false);
});

await check('Eine gesprochene Terminnummer wird auf ihre Ziffern reduziert', async () => {
  const { payload } = await lookupRuf({ booking_reference: 'Nummer 654-321.' });
  assert.deepEqual(payload.appointments.map((termin) => termin.external_event_id), ['evt_fremd']);
});

await check('Eine unterdrueckte Nummer gilt nicht als Kennung', async () => {
  // Telefonieanbieter setzen statt einer Nummer Werte wie "anonymous". Geht ein
  // solcher Wert als Kennung durch, teilen sich alle anonymen Anrufer eine
  // Identitaet -- und der erste, der bucht, oeffnet sie fuer alle weiteren.
  const { payload } = await lookupRuf({ caller_id: 'anonymous' });
  assert.equal(payload.identified_by, 'none');
  assert.equal(payload.reason, 'calendar_appointment_unmatched');
});

// Der Fall, den die Gegenprobe erst sichtbar gemacht hat: bei 'anonymous' ist
// die Zeile oben gruen, weil die Telefonnummer-Normalisierung alles Buchstaben-
// hafte verwirft -- die Platzhalter-Liste wird dafuer gar nicht gebraucht. Ein
// numerischer Platzhalter kommt dagegen sauber durch die Normalisierung.
await check('Ein numerischer Platzhalter gilt nicht als Kennung', async () => {
  // +266696687 ist ANONYMOUS auf der Telefontastatur und eine gueltige
  // E.164-Nummer. Ohne eigene Sperre waere sie eine gemeinsame Kennung fuer
  // alle anonymen Anrufenden.
  const { payload } = await lookupRuf({ caller_id: '+266696687' });
  assert.equal(payload.identified_by, 'none');
  assert.equal(payload.reason, 'calendar_appointment_unmatched');
});

// Und die Gegenrichtung: der Platzhalter darf keine echte Nummer mitreissen.
await check('Eine echte Nummer bleibt eine Kennung', async () => {
  const { payload } = await lookupRuf({ caller_id: ANRUFER_A });
  assert.equal(payload.identified_by, 'caller_id');
});

// Nur wenn im ganzen Betrieb nichts ansteht, ist die Frage nach der
// Terminnummer sinnlos -- dann und nur dann sagt der Agent "kein Termin".
await check('Ohne anstehende Termine im Betrieb wird nicht nach der Nummer gefragt', async () => {
  const { payload } = await lookupRuf({ caller_id: '+41780000000' }, HISTORIE_LEER);
  assert.equal(payload.appointment_count, 0);
  assert.equal(payload.reason, 'calendar_no_upcoming_appointment',
    '"kein Termin" ist nicht dasselbe wie "nicht zugeordnet"');
});

await check('Altbestand ohne Bindung wird nicht vorgelesen', async () => {
  const { payload } = await lookupRuf({ caller_id: ANRUFER_A });
  assert.ok(!payload.appointments.some((termin) => termin.external_event_id === 'evt_ohne_bindung'),
    'ein Termin ohne hinterlegte Bindung wird jedem beliebigen Anrufer angeboten');
});

await check('Eine Buchung ohne Kalender-ID gilt nicht als Termin des aktuellen Kalenders', async () => {
  const { payload } = await lookupRuf({ caller_id: ANRUFER_A });
  assert.ok(!payload.appointments.some((termin) => termin.external_event_id === 'evt_ohne_kalender'),
    'eine Altbuchung ohne Kalender-ID wird vorgelesen -- ihre Absage kann nur im 409-Rueckfall enden');
});

// Die nationale Schreibweise ist dieselbe Nummer. Ohne Normalisierung waere ein
// Anrufer je nach Signalisierung mal er selbst und mal ein Fremder.
await check('Die Anrufernummer wird normalisiert verglichen', async () => {
  const { payload } = await lookupRuf({ caller_id: '079 123 45 67' });
  assert.equal(payload.appointment_count, 2);
});

// Codex-Befund vom 14.08. (P2): `created_at` ist der Zeitpunkt des Claims, nicht
// der der erfolgreichen Kalenderaenderung. Ueberlappen sich zwei Verschiebungen,
// kann die zuerst beanspruchte zuletzt fertig werden -- dann ist SIE der
// Kalenderstand, und die Wiedergabe nach Anlage meldet die veraltete Zeit.
const HISTORIE_UEBERLAPPEND = [
  { external_event_id: 'evt_x', connection_id: 'conn_1', action: 'book', created_at: '2026-08-01T10:00:00Z',
    details: { caller_reference: ANRUFER_A, calendar_id: 'cal_1', completed_at: '2026-08-01T10:00:05Z',
               response: { start: '2027-09-01T06:00:00.000Z', end: '2027-09-01T06:30:00.000Z' } } },
  // Zuerst beansprucht (10:00:00), zuletzt fertig (10:00:30) -- das ist der
  // Stand, der im Kalender steht.
  { external_event_id: 'evt_x', connection_id: 'conn_1', action: 'reschedule', created_at: '2026-08-02T10:00:00Z',
    details: { caller_reference: ANRUFER_A, calendar_id: 'cal_1', completed_at: '2026-08-02T10:00:30Z',
               response: { start: '2027-09-03T06:00:00.000Z', end: '2027-09-03T06:30:00.000Z' } } },
  // Spaeter beansprucht (10:00:10), aber frueher fertig (10:00:20).
  { external_event_id: 'evt_x', connection_id: 'conn_1', action: 'reschedule', created_at: '2026-08-02T10:00:10Z',
    details: { caller_reference: ANRUFER_A, calendar_id: 'cal_1', completed_at: '2026-08-02T10:00:20Z',
               response: { start: '2027-09-02T06:00:00.000Z', end: '2027-09-02T06:30:00.000Z' } } }
];

await check('Ueberlappende Verschiebungen zaehlen nach Abschluss, nicht nach Anlage', async () => {
  const { payload } = await lookupRuf({ caller_id: ANRUFER_A }, HISTORIE_UEBERLAPPEND);
  assert.equal(payload.appointment_count, 1);
  assert.equal(payload.appointments[0].start, '2027-09-03T06:00:00.000Z',
    'die Wiedergabe folgt der Claim-Reihenfolge und meldet eine veraltete Zeit');
});

// Die Kollisionssperre der Terminnummer laesst sich am Handler nicht scharf
// pruefen: eine zufaellige Ziehung trifft eine bestimmte Nummer praktisch nie,
// der Fall waere also auch ohne Sperre gruen. Geprueft wird deshalb direkt an
// der Ziehung.
const { bookingReference } = require('../customer-dashboard/netlify/functions/_lib/caller-identity.js');

await check('Eine belegte Terminnummer wird neu gezogen', async () => {
  let gefragt = 0;
  // Die ersten fuenf Kandidaten gelten als belegt.
  const teilweiseVergeben = { has: () => (gefragt++ < 5) };
  const nummer = bookingReference(teilweiseVergeben);
  assert.match(nummer, /^\d{6}$/);
  assert.equal(gefragt, 6, 'die Ziehung wiederholt bei einer Kollision nicht');
});

await check('Ist alles belegt, bricht die Buchung ab statt doppelt zu vergeben', async () => {
  // Eine kollidierende Nummer still auszugeben hiesse, dass zwei Personen den
  // Termin der jeweils anderen absagen koennen -- schlimmer als eine
  // gescheiterte Buchung.
  assert.throws(() => bookingReference({ has: () => true }),
    /calendar_booking_reference_exhausted/);
});

const cancelRuf = (body) => {
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  return handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ action: 'cancel', agent_id: 'agent_1', ...body })
  }).then((response) => ({ response, payload: JSON.parse(response.body), supabase }));
};

await check('Der Termin einer fremden Person laesst sich nicht absagen', async () => {
  const { response, payload } = await cancelRuf({
    request_id: 'req_fremd', external_event_id: 'evt_fremd', caller_id: ANRUFER_A
  });
  assert.equal(response.statusCode, 403);
  assert.equal(payload.error, 'calendar_appointment_not_yours');
});

await check('Der eigene Termin laesst sich absagen', async () => {
  const { response, payload } = await cancelRuf({
    request_id: 'req_eigen', external_event_id: 'evt_a', caller_id: ANRUFER_A
  });
  assert.equal(response.statusCode, 200, JSON.stringify(payload));
  assert.equal(payload.cancelled, true);
});

await check('Die Terminnummer reicht auch fuers Absagen', async () => {
  const { response, payload } = await cancelRuf({
    request_id: 'req_beleg', external_event_id: 'evt_fremd', booking_reference: BELEG_B
  });
  assert.equal(response.statusCode, 200, JSON.stringify(payload));
  assert.equal(payload.cancelled, true);
});

// Bewusst NACHSICHTIG, anders als beim Nachschlagen: das Nachschlagen GIBT eine
// Termin-ID heraus, das Absagen VERLANGT sie. Wer sie hat, hat sie aus einer
// Voxera-Antwort. Ein Altbestand ohne Bindung bliebe sonst fuer immer
// unabsagbar.
await check('Altbestand ohne Bindung bleibt absagbar', async () => {
  const { response, payload } = await cancelRuf({
    request_id: 'req_alt', external_event_id: 'evt_ohne_bindung', caller_id: ANRUFER_A
  });
  assert.equal(response.statusCode, 200, JSON.stringify(payload));
  assert.equal(payload.cancelled, true);
});

await check('Die abgewiesene Absage hinterlaesst, wer es versucht hat', async () => {
  const { supabase } = await cancelRuf({
    request_id: 'req_fremd2', external_event_id: 'evt_fremd', caller_id: ANRUFER_A
  });
  const zeilen = auditZeilen(supabase);
  assert.equal(zeilen.length, 1, `erwartet 1 Zeile, geschrieben: ${zeilen.length}`);
  assert.equal(zeilen[0].row.status, 'failed');
  assert.equal(zeilen[0].row.details.error, 'calendar_appointment_not_yours');
  assert.equal(zeilen[0].row.details.caller_reference, ANRUFER_A);
});

await check('Eine Buchung nennt eine Terminnummer und schreibt die Bindung mit', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({
      action: 'book', agent_id: 'agent_1', request_id: 'req_buch',
      start: DI('10:00'), end: DI('10:30'), caller_id: ANRUFER_A
    })
  });
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true, JSON.stringify(payload));
  assert.match(String(payload.booking_reference), /^\d{6}$/,
    'die Buchung nennt keine vorlesbare Terminnummer');
  const abschluss = supabase.updates.find((entry) => entry.patch.status === 'success');
  assert.equal(abschluss.patch.details.caller_reference, ANRUFER_A);
  assert.equal(abschluss.patch.details.booking_reference, payload.booking_reference);
});

// Verschieben darf den Eigentuemer nicht wechseln -- sonst waere es genau der
// Weg an der Pruefung vorbei, den sie verhindern soll.
await check('Verschieben schreibt die Bindung fort statt sie neu zu setzen', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({
      action: 'reschedule', agent_id: 'agent_1', request_id: 'req_schieb',
      external_event_id: 'evt_fremd', booking_reference: BELEG_B,
      start: DI('10:00'), end: DI('10:30')
    })
  });
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true, JSON.stringify(payload));
  const abschluss = supabase.updates.find((entry) => entry.patch.status === 'success');
  assert.equal(abschluss.patch.details.caller_reference, ANRUFER_B,
    'das Verschieben hat den Termin still uebernommen');
  assert.equal(abschluss.patch.details.booking_reference, BELEG_B,
    'die Terminnummer aendert sich beim Verschieben');
});

await check('Verschieben traegt beim Altbestand eine Bindung nach', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({
      action: 'reschedule', agent_id: 'agent_1', request_id: 'req_schieb_alt',
      external_event_id: 'evt_ohne_bindung', caller_id: ANRUFER_A,
      start: DI('10:00'), end: DI('10:30')
    })
  });
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true, JSON.stringify(payload));
  const abschluss = supabase.updates.find((entry) => entry.patch.status === 'success');
  assert.equal(abschluss.patch.details.caller_reference, ANRUFER_A);
  assert.match(String(abschluss.patch.details.booking_reference), /^\d{6}$/);
});

await check('Ein fremder Termin laesst sich auch nicht verschieben', async () => {
  verfuegbarkeit = { available: true, busy: [] };
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({
      action: 'reschedule', agent_id: 'agent_1', request_id: 'req_schieb_fremd',
      external_event_id: 'evt_fremd', caller_id: ANRUFER_A,
      start: DI('10:00'), end: DI('10:30')
    })
  });
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, 'calendar_appointment_not_yours');
});

// Die Audit-Zeile trug zuerst nur Zahlen. Am 13.08. liess sich damit nicht
// klaeren, welcher Slot weggefallen war -- zwei verschiedene Termine ergeben
// dieselbe Slot-Anzahl.
await check('Die Audit-Zeile traegt die Grenzen der Belegung, keine Titel', async () => {
  verfuegbarkeit = { available: false, busy: [{ id: 'e1', start: DI('09:30'), end: DI('10:00'), summary: 'Zahnarzt' }] };
  const { supabase } = await ruf({
    action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00')
  });
  const details = auditZeilen(supabase)[0].row.details;
  assert.deepEqual(details.busy_windows, [{ start: DI('09:30'), end: DI('10:00') }]);
  const alsText = JSON.stringify(details);
  assert.ok(!alsText.includes('Zahnarzt'), 'der Termintitel landet in der Audit-Zeile');
  assert.ok(!alsText.includes('e1'), 'die Kalender-ID landet in der Audit-Zeile');
});

// Codex-Befund vom 13.08. (P1): deleteEvent() behandelt 404 als Erfolg und
// meldet already_missing -- der Rueckgabewert wurde verworfen und
// `cancelled: true` fest verdrahtet. Ein DELETE auf den falschen Kalender
// bestaetigte damit eine Absage, die nicht stattgefunden hat.
await check('Ein nicht gefundener Termin bestaetigt keine Absage', async () => {
  loeschErgebnis = { deleted: true, already_missing: true };
  try {
    const supabase = makeSupabase({
      answers: {
        ...antworten(),
        calendar_booking_audit: (ops) => {
          if (ops.some((op) => op.name === 'insert')) return { data: { id: 'audit_1' }, error: null };
          if (ops.some((op) => op.name === 'limit')) return { data: [{ id: 'audit_alt' }], error: null };
          return { data: null, error: null };
        }
      }
    });
    aktuellerClient = supabase.client;
    const response = await handler({
      httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({ action: 'cancel', agent_id: 'agent_1', request_id: 'req_404', external_event_id: 'evt_1' })
    });
    const payload = JSON.parse(response.body);
    assert.equal(payload.ok, false, 'ein 404 wird weiterhin als Absage bestaetigt');
    assert.equal(payload.error, 'calendar_event_already_missing');
    assert.notEqual(payload.cancelled, true);
  } finally { loeschErgebnis = { deleted: true, already_missing: false }; }
});

// ── Punkt 4: kein geratener Anbieter im Fehlerpfad ──────────────────────────

await check('Ohne bekannten Anbieter wird kein Anbieter erfunden', async () => {
  const geloggt = [];
  const echtesError = console.error;
  console.error = (...args) => geloggt.push(args);
  try {
    // Die Einstellungen fehlen -> der Anbieter ist an keiner Stelle bekannt.
    const supabase = makeSupabase({
      answers: { ...antworten(), calendar_settings: () => { throw new Error('settings_kaputt'); } }
    });
    aktuellerClient = supabase.client;
    const response = await handler({
      httpMethod: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({ action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00') })
    });
    assert.equal(JSON.parse(response.body).ok, false);
    // Keine Zeile mit geratenem Anbieter -- und erst recht keine mit 'google'.
    assert.deepEqual(auditZeilen(supabase), []);
    assert.ok(geloggt.some((args) => String(args[0]).includes('audit_uebersprungen_anbieter_unbekannt')),
      'Der uebersprungene Audit-Eintrag wird nicht protokolliert');
  } finally { console.error = echtesError; }
});

await check('Bei bekanntem Anbieter traegt die Fehlerzeile ihn', async () => {
  const supabase = makeSupabase({
    answers: {
      ...antworten(),
      calendar_connections: { data: { ...CONNECTION, provider: 'microsoft' }, error: null }
    }
  });
  aktuellerClient = supabase.client;
  providerFehler = new Error('calendar_provider_api_failed');
  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({ action: 'availability', agent_id: 'agent_1', start: DI('08:00'), end: DI('12:00') })
    });
    assert.equal(JSON.parse(response.body).ok, false);
    const zeilen = auditZeilen(supabase);
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].row.provider, 'microsoft', 'Der Fehlerpfad raet wieder google');
  } finally { providerFehler = null; }
});

Module._load = echtesLoad;

if (failed) { console.error(`calendar tool audit verification failed: ${failed}`); process.exit(1); }
console.log('calendar tool audit verified.');
