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

// Historie: gebucht, verschoben, abgesagt, plus ein vergangener Termin.
const HISTORIE = [
  { external_event_id: 'evt_alt', connection_id: 'conn_1', action: 'book', created_at: '2026-08-01T10:00:00Z',
    details: { response: { start: '2026-08-05T08:00:00.000Z', end: '2026-08-05T08:30:00.000Z' } } },
  { external_event_id: 'evt_a', connection_id: 'conn_1', action: 'book', created_at: '2026-08-02T10:00:00Z',
    details: { response: { start: '2027-08-10T06:00:00.000Z', end: '2027-08-10T06:30:00.000Z' } } },
  { external_event_id: 'evt_b', connection_id: 'conn_1', action: 'book', created_at: '2026-08-03T10:00:00Z',
    details: { response: { start: '2027-08-11T06:00:00.000Z', end: '2027-08-11T06:30:00.000Z' } } },
  { external_event_id: 'evt_b', connection_id: 'conn_1', action: 'reschedule', created_at: '2026-08-04T10:00:00Z',
    details: { response: { start: '2027-08-12T09:00:00.000Z', end: '2027-08-12T09:30:00.000Z' } } },
  { external_event_id: 'evt_weg', connection_id: 'conn_1', action: 'book', created_at: '2026-08-05T10:00:00Z',
    details: { response: { start: '2027-08-13T06:00:00.000Z', end: '2027-08-13T06:30:00.000Z' } } },
  { external_event_id: 'evt_weg', connection_id: 'conn_1', action: 'cancel', created_at: '2026-08-06T10:00:00Z',
    details: { response: { cancelled: true } } },
  // Codex-Befund vom 13.08. (P1): Buchungen aus einer frueheren Verbindung oder
  // von einem anderen Kalender sind heute nicht mehr absagbar.
  { external_event_id: 'evt_fremde_verbindung', action: 'book', created_at: '2026-08-07T10:00:00Z',
    connection_id: 'conn_alt',
    details: { response: { start: '2027-08-14T06:00:00.000Z', end: '2027-08-14T06:30:00.000Z' } } },
  { external_event_id: 'evt_fremder_kalender', action: 'book', created_at: '2026-08-08T10:00:00Z',
    connection_id: 'conn_1', calendar_id: 'cal_anderer',
    details: { response: { start: '2027-08-15T06:00:00.000Z', end: '2027-08-15T06:30:00.000Z' },
               calendar_id: 'cal_anderer' } }
];

const mitHistorie = () => ({
  ...antworten(),
  calendar_booking_audit: (ops) => {
    if (ops.some((op) => op.name === 'insert')) return { data: { id: 'audit_1' }, error: null };
    if (ops.some((op) => op.name === 'order')) return { data: HISTORIE, error: null };
    if (ops.some((op) => op.name === 'limit')) return { data: [{ id: 'audit_alt' }], error: null };
    return { data: null, error: null };
  }
});

await check('lookup liefert anstehende Termine ohne jede Zeitangabe', async () => {
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ action: 'lookup', agent_id: 'agent_1' })
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
    body: JSON.stringify({ action: 'lookup', agent_id: 'agent_1' })
  });
  const zeilen = auditZeilen(supabase);
  assert.equal(zeilen.length, 1, `erwartet 1 Zeile, geschrieben: ${zeilen.length}`);
  assert.equal(zeilen[0].row.action, 'lookup');
  assert.equal(zeilen[0].row.details.appointment_count, 2);
  assert.equal(Object.hasOwn(zeilen[0].row.details, 'appointments'), false);
});

await check('lookup braucht keine request_id', async () => {
  const supabase = makeSupabase({ answers: mitHistorie() });
  aktuellerClient = supabase.client;
  const response = await handler({
    httpMethod: 'POST', headers: { Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ action: 'lookup', agent_id: 'agent_1' })
  });
  assert.equal(response.statusCode, 200);
  assert.notEqual(JSON.parse(response.body).error, 'calendar_request_id_required');
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
