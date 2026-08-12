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

stubs.set('@supabase/supabase-js', { createClient: () => aktuellerClient });
stubs.set('./_lib/calendar-providers', {
  ensureAccessToken: async () => ({ accessToken: 'token', connection: {} }),
  checkAvailability: async () => {
    if (providerFehler) throw providerFehler;
    return verfuegbarkeit;
  },
  createEvent: async () => ({ id: 'evt_1', htmlLink: 'https://example.invalid/evt_1' }),
  updateEvent: async () => ({ id: 'evt_1' }),
  deleteEvent: async () => ({ deleted: true })
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
