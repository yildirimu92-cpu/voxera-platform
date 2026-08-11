'use strict';

// Die SMS-Benachrichtigung an Team und Anrufer.
//
// Was hier festgehalten wird, sind nicht Implementierungsdetails, sondern die
// Zusagen, an denen der Pilot haengt:
//
//   * Eine Nachricht bleibt ein Segment. Zwei Segmente kosten bei fuenf
//     Empfaengern das Doppelte, und ein einziges typografisches Zeichen
//     genuegt, um das auszuloesen.
//   * Ein Fehlschlag bei einem Empfaenger reisst die uebrigen nicht mit.
//   * Der Anrufer bekommt keine Bestaetigung, wenn das Team nichts bekommen
//     hat. Eine Zusage, hinter der niemand steht, ist schlimmer als keine.
//   * Ein Festnetzanrufer laesst den Versand nicht scheitern, sondern wird
//     uebersprungen.
//   * Keine Nachricht bittet um eine Antwort -- der Absender ist einweg.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'netlify', 'functions', '_lib');
const vorlagen = require(path.join(LIB, 'sms-templates.js'));
const transport = require(path.join(LIB, 'sms-transport.js'));
const callSms = require(path.join(LIB, 'call-sms.js'));

const ZEIT = new Date('2026-08-11T01:14:00Z');

// ───────────────────────────────────────────────────────────────────────────
// Kodierung und Segmente
// ───────────────────────────────────────────────────────────────────────────

test('Umlaute bleiben GSM-7 und damit ein Segment', () => {
  const m = vorlagen.segmenteBerechnen('Ueberfuehrung ae oe ue: äöüÄÖÜ à é è ß');
  assert.equal(m.segmente, 1);
  assert.equal(m.kodierung, 'GSM-7');
});

test('typografische Zeichen werden ersetzt statt die Nachricht zu verdoppeln', () => {
  const { text, entferntZeichen } = vorlagen.toGsm7('Er sagte „los“ – dann … Ende');
  assert.equal(text, 'Er sagte "los" - dann ... Ende');
  assert.equal(entferntZeichen, 0);
});

test('Emoji wird entfernt und gezaehlt, statt auf UCS-2 zu kippen', () => {
  const { text, entferntZeichen } = vorlagen.toGsm7('Panne 🚗 A1');
  assert.equal(entferntZeichen, 1);
  assert.equal(vorlagen.segmenteBerechnen(text).segmente, 1);
});

test('Akzente ausserhalb GSM-7 werden auf den Grundbuchstaben zurueckgefuehrt', () => {
  assert.equal(vorlagen.toGsm7('Zoë Ćurić').text, 'Zoe Curic');
});

test('Segmentgrenze liegt bei 160, danach 153 je Segment', () => {
  assert.equal(vorlagen.segmenteBerechnen('x'.repeat(160)).segmente, 1);
  assert.equal(vorlagen.segmenteBerechnen('x'.repeat(161)).segmente, 2);
  assert.equal(vorlagen.segmenteBerechnen('x'.repeat(306)).segmente, 2);
  assert.equal(vorlagen.segmenteBerechnen('x'.repeat(307)).segmente, 3);
});

test('Erweiterungszeichen zaehlen doppelt', () => {
  assert.equal(vorlagen.gsm7Laenge('€'), 2);
  assert.equal(vorlagen.gsm7Laenge('['), 2);
  assert.equal(vorlagen.gsm7Laenge('a'), 1);
});

// ───────────────────────────────────────────────────────────────────────────
// Team-Vorlage
// ───────────────────────────────────────────────────────────────────────────

test('Team-SMS bleibt ein Segment, auch bei ueberlanger Zusammenfassung', () => {
  const m = vorlagen.buildTeamSms({
    anlass: 'Abschlepp-Anfrage',
    rueckrufnummer: '+41791234567',
    ort: 'A1 Richtung Bern, kurz nach Ausfahrt Muri',
    zusammenfassung: 'x'.repeat(400),
    anruferName: 'M. Keller',
    zeitpunkt: ZEIT
  });
  assert.equal(m.segmente, 1);
  assert.ok(m.laenge <= 160, `laenge ${m.laenge}`);
});

test('Team-SMS nennt Rueckrufnummer und Ort vor der Zusammenfassung', () => {
  const m = vorlagen.buildTeamSms({
    anlass: 'Abschlepp-Anfrage',
    rueckrufnummer: '+41791234567',
    ort: 'A1 Ri. Bern',
    zusammenfassung: 'PW nicht fahrbereit',
    zeitpunkt: ZEIT
  });
  const iNummer = m.text.indexOf('+41791234567');
  const iOrt = m.text.indexOf('A1 Ri. Bern');
  const iText = m.text.indexOf('PW nicht fahrbereit');
  assert.ok(iNummer > -1 && iOrt > -1 && iText > -1);
  assert.ok(iNummer < iOrt, 'Rueckrufnummer vor Ort');
  assert.ok(iOrt < iText, 'Ort vor Zusammenfassung');
});

test('fehlende Rueckrufnummer wird benannt, nicht verschwiegen', () => {
  const m = vorlagen.buildTeamSms({ anlass: 'Anruf', zusammenfassung: 'Panne', zeitpunkt: ZEIT });
  assert.match(m.text, /keine Nummer uebermittelt/);
});

test('fehlender Ort laesst die Zeile weg statt sie leer zu zeigen', () => {
  const m = vorlagen.buildTeamSms({ anlass: 'Anruf', rueckrufnummer: '+41791234567', zusammenfassung: 'Panne', zeitpunkt: ZEIT });
  assert.doesNotMatch(m.text, /Ort:/);
});

// ───────────────────────────────────────────────────────────────────────────
// Anrufer-Vorlage
// ───────────────────────────────────────────────────────────────────────────

test('Anrufer-SMS bleibt ein Segment, auch bei sehr langem Firmennamen', () => {
  const m = vorlagen.buildCallerSms({
    firma: 'Abschlepp- und Pannendienst Gebrueder Muster Zuerich Oerlikon AG',
    rueckrufnummer: '+41448005050',
    notfallnummer: '144',
    teamInformiert: true,
    zeitpunkt: ZEIT
  });
  assert.equal(m.segmente, 1);
  assert.ok(m.laenge <= 160, `laenge ${m.laenge}`);
});

test('Anrufer-SMS traegt die Rueckrufnummer, weil der Absender einweg ist', () => {
  const m = vorlagen.buildCallerSms({ firma: 'Meier AG', rueckrufnummer: '+41448005050', notfallnummer: '144', teamInformiert: true, zeitpunkt: ZEIT });
  assert.match(m.text, /\+41448005050/);
});

test('Anrufer-SMS verspricht keine Zeit', () => {
  const m = vorlagen.buildCallerSms({ firma: 'Meier AG', rueckrufnummer: '+41448005050', teamInformiert: true, zeitpunkt: ZEIT });
  assert.doesNotMatch(m.text, /Minute|Stunde|in \d+/i);
});

test('"Das Team ist informiert" steht nur, wenn es zutrifft', () => {
  const mit = vorlagen.buildCallerSms({ firma: 'Meier AG', teamInformiert: true, zeitpunkt: ZEIT });
  const ohne = vorlagen.buildCallerSms({ firma: 'Meier AG', teamInformiert: false, zeitpunkt: ZEIT });
  assert.match(mit.text, /Team ist informiert/);
  assert.doesNotMatch(ohne.text, /Team ist informiert/);
  assert.match(ohne.text, /aufgenommen/);
});

test('keine Vorlage bittet um eine Antwort oder bietet STOP an', () => {
  const beide = [
    vorlagen.buildTeamSms({ anlass: 'Anruf', rueckrufnummer: '+41791234567', zusammenfassung: 'Panne', zeitpunkt: ZEIT }).text,
    vorlagen.buildCallerSms({ firma: 'Meier AG', rueckrufnummer: '+41448005050', notfallnummer: '144', teamInformiert: true, zeitpunkt: ZEIT }).text
  ];
  for (const text of beide) {
    assert.doesNotMatch(text, /\bSTOP\b/i);
    assert.doesNotMatch(text, /antworten Sie|Antwort auf diese/i);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Absenderkennung
// ───────────────────────────────────────────────────────────────────────────

test('Absender faellt auf Voxera zurueck und gilt als alphanumerisch', () => {
  const r = transport.resolveSender({});
  assert.equal(r.sender, 'Voxera');
  assert.equal(r.alphanumerisch, true);
  assert.equal(r.error, null);
});

test('Absender ueber elf Zeichen wird abgewiesen, nicht an Twilio durchgereicht', () => {
  const r = transport.resolveSender({ TWILIO_SMS_FROM: 'VoxeraSchweizAG' });
  assert.equal(r.sender, null);
  assert.match(r.error, /hoechstens 11/);
});

test('unzulaessige Zeichen im Absender werden abgewiesen', () => {
  assert.match(transport.resolveSender({ TWILIO_SMS_FROM: 'Voxera!' }).error, /unzulaessige Zeichen/);
});

test('eine numerische Konfiguration wird als Nummer durchgelassen', () => {
  const r = transport.resolveSender({ TWILIO_SMS_FROM: '+41445052800' });
  assert.equal(r.sender, '+41445052800');
  assert.equal(r.alphanumerisch, false);
});

// ───────────────────────────────────────────────────────────────────────────
// Fehlereinordnung -- daran haengt der Festnetz-Fall
// ───────────────────────────────────────────────────────────────────────────

function twilioAntwort(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
}

const ENV = { TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 'token', TWILIO_SMS_FROM: 'Voxera' };

test('21614 (Festnetz) gilt als permanent', async () => {
  const r = await transport.sendSmsViaTwilio({
    to: '+41445052800', body: 'x', env: ENV,
    fetchImpl: twilioAntwort(400, { code: 21614, message: "'To' number is not a valid mobile number" })
  });
  assert.equal(r.ok, false);
  assert.equal(r.permanent, true);
});

test('Guthaben- und Kontofehler gelten NICHT als permanent', async () => {
  for (const code of [21606, 20005]) {
    const r = await transport.sendSmsViaTwilio({
      to: '+41791234567', body: 'x', env: ENV,
      fetchImpl: twilioAntwort(400, { code, message: 'account issue' })
    });
    assert.equal(r.permanent, false, `code ${code} darf nicht permanent sein`);
    assert.match(r.error, /Guthaben pruefen/);
  }
});

test('429 und 5xx bleiben wiederholbar', async () => {
  for (const status of [429, 500, 503]) {
    const r = await transport.sendSmsViaTwilio({
      to: '+41791234567', body: 'x', env: ENV,
      fetchImpl: twilioAntwort(status, { message: 'later' })
    });
    assert.equal(r.permanent, false, `status ${status}`);
  }
});

test('Netzwerkfehler ist wiederholbar, nicht endgueltig', async () => {
  const r = await transport.sendSmsViaTwilio({
    to: '+41791234567', body: 'x', env: ENV,
    fetchImpl: async () => { throw new Error('ECONNRESET'); }
  });
  assert.equal(r.ok, false);
  assert.equal(r.permanent, false);
});

test('Erfolg liefert die Twilio-SID zurueck', async () => {
  const r = await transport.sendSmsViaTwilio({
    to: '+41791234567', body: 'x', env: ENV,
    fetchImpl: twilioAntwort(201, { sid: 'SM123' })
  });
  assert.equal(r.ok, true);
  assert.equal(r.sid, 'SM123');
});

// ───────────────────────────────────────────────────────────────────────────
// Orchestrierung: Reihenfolge, Mehrempfaenger, Fehlerfall
// ───────────────────────────────────────────────────────────────────────────

/**
 * Minimaler Supabase-Ersatz. Deckt genau die Aufrufketten ab, die call-sms.js
 * und sms-delivery.js benutzen.
 */
function fakeSb({ customer, addons = [], empfaenger = [] }) {
  const outbox = [];
  const bauKette = (tabelle) => {
    const kette = {
      _tabelle: tabelle,
      select() { return kette; },
      eq() { return kette; },
      order() { return kette; },
      limit() { return kette; },
      maybeSingle: async () => {
        if (tabelle === 'customers') return { data: customer, error: null };
        if (tabelle === 'outbox_events') return { data: outbox[outbox.length - 1] || null, error: null };
        return { data: null, error: null };
      },
      single: async () => ({ data: outbox[outbox.length - 1], error: null }),
      insert(row) {
        const zeile = { id: `ob_${outbox.length + 1}`, retry_count: 0, ...row };
        outbox.push(zeile);
        return kette;
      },
      update() { return kette; },
      then(resolve) {
        if (tabelle === 'customer_addons') return resolve({ data: addons, error: null });
        if (tabelle === 'customer_notification_recipients') return resolve({ data: empfaenger, error: null });
        return resolve({ data: [], error: null });
      }
    };
    return kette;
  };
  return { from: bauKette, _outbox: outbox };
}

const KUNDE_VOLL = {
  id: 'cust_1', customer_name: 'Meier AG', customer_display_name: 'Abschleppdienst Meier',
  tel_nr: '+41448005050', voxera_number: '+41445052800',
  sms_notify_enabled: true, sms_notify_trigger: 'all',
  sms_caller_enabled: true, sms_caller_trigger: 'all',
  notfallnummer_lebensgefahr: '144'
};
const ADDONS_BEIDE = [
  { addon_code: 'sms_notify', status: 'active', active: true, valid_until: null },
  { addon_code: 'sms_endkunde', status: 'active', active: true, valid_until: null }
];
const DREI_EMPFAENGER = [
  { id: 'r1', phone_e164: '+41791111111', name: 'Ruedi', sort_order: 0 },
  { id: 'r2', phone_e164: '+41792222222', name: 'Anna', sort_order: 1 },
  { id: 'r3', phone_e164: '+41793333333', name: 'Beat', sort_order: 2 }
];
const ANRUF = {
  caller_name: 'M. Keller', caller_phone: '+41794444444',
  call_summary_short: 'PW nicht fahrbereit', callback_requested: false,
  category: 'inbound', zeitpunkt: ZEIT
};

/** Faengt alle Twilio-Aufrufe ab und beantwortet sie nach Empfaengernummer. */
function stubFetch(antwortFuer) {
  const gesendet = [];
  global.fetch = async (url, opts) => {
    const params = new URLSearchParams(opts.body.toString());
    const to = params.get('To');
    gesendet.push({ to, from: params.get('From'), body: params.get('Body') });
    const a = antwortFuer(to);
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => JSON.stringify(a.body) };
  };
  return gesendet;
}

const echtesFetch = global.fetch;
test.afterEach(() => { global.fetch = echtesFetch; });

test('alle Team-Empfaenger bekommen die SMS, der Anrufer danach', async () => {
  process.env.TWILIO_ACCOUNT_SID = 'AC_test';
  process.env.TWILIO_AUTH_TOKEN = 'token';
  const gesendet = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({ customer: KUNDE_VOLL, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_1', customerId: 'cust_1', call: ANRUF });

  assert.equal(r.team.versucht, 3);
  assert.equal(r.team.angenommen, 3);
  assert.equal(r.anrufer.angenommen, true);
  assert.equal(gesendet.length, 4, 'drei Team plus ein Anrufer');
  assert.equal(gesendet[3].to, '+41794444444', 'Anrufer zuletzt');
  assert.ok(gesendet.every(g => g.from === 'Voxera'));
});

test('ein fehlgeschlagener Empfaenger reisst die uebrigen nicht mit', async () => {
  const gesendet = stubFetch(to => to === '+41792222222'
    ? { status: 500, body: { message: 'boom' } }
    : { status: 201, body: { sid: 'SM1' } });
  const sb = fakeSb({ customer: KUNDE_VOLL, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_2', customerId: 'cust_1', call: ANRUF });

  assert.equal(r.team.versucht, 3, 'Schleife laeuft zu Ende');
  assert.equal(r.team.angenommen, 2);
  assert.equal(r.team.fehlgeschlagen, 1);
  assert.ok(gesendet.some(g => g.to === '+41793333333'), 'der Empfaenger NACH dem Fehler wurde erreicht');
});

test('scheitert das ganze Team, bekommt der Anrufer KEINE Bestaetigung', async () => {
  const gesendet = stubFetch(() => ({ status: 500, body: { message: 'boom' } }));
  const sb = fakeSb({ customer: KUNDE_VOLL, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_3', customerId: 'cust_1', call: ANRUF });

  assert.equal(r.team.angenommen, 0);
  assert.equal(r.anrufer.versucht, false);
  assert.equal(r.anrufer.uebersprungen, true);
  assert.equal(r.anrufer.reason, 'team_nicht_erreicht');
  assert.ok(!gesendet.some(g => g.to === '+41794444444'), 'keine SMS an den Anrufer');
});

test('eine einzige angenommene Team-SMS genuegt fuer die Anrufer-Bestaetigung', async () => {
  // Nur der erste Team-Empfaenger kommt durch; die Anrufernummer soll
  // erreichbar bleiben, damit der Test wirklich die Sperre prueft und nicht
  // nebenbei am Anrufer-Versand scheitert.
  stubFetch(to => (to === '+41791111111' || to === '+41794444444')
    ? { status: 201, body: { sid: 'SM1' } }
    : { status: 500, body: { message: 'boom' } });
  const sb = fakeSb({ customer: KUNDE_VOLL, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_4', customerId: 'cust_1', call: ANRUF });

  assert.equal(r.team.angenommen, 1);
  assert.equal(r.team.fehlgeschlagen, 2);
  assert.equal(r.anrufer.angenommen, true);
});

test('unterdrueckte Rufnummer ueberspringt den Anrufer, ohne zu scheitern', async () => {
  const gesendet = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({ customer: KUNDE_VOLL, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER });

  const r = await callSms.sendCallSms(sb, {
    callRowId: 'call_5', customerId: 'cust_1',
    call: { ...ANRUF, caller_phone: null }
  });

  assert.equal(r.team.angenommen, 3, 'das Team bekommt seine SMS trotzdem');
  assert.equal(r.anrufer.uebersprungen, true);
  assert.equal(r.anrufer.reason, 'keine_anrufernummer');
  assert.equal(r.error, null, 'kein Fehler');
  assert.equal(gesendet.length, 3);
});

test('Festnetznummer des Anrufers wird uebersprungen, nicht als Fehler gewertet', async () => {
  stubFetch(to => to === '+41794444444'
    ? { status: 400, body: { code: 21614, message: "'To' number is not a valid mobile number" } }
    : { status: 201, body: { sid: 'SM1' } });
  const sb = fakeSb({ customer: KUNDE_VOLL, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_6', customerId: 'cust_1', call: ANRUF });

  assert.equal(r.team.angenommen, 3);
  assert.equal(r.anrufer.versucht, true);
  assert.equal(r.anrufer.angenommen, false);
  assert.equal(r.anrufer.uebersprungen, true);
  assert.equal(r.anrufer.reason, 'twilio_21614');
  assert.equal(r.error, null);
});

test('ohne gebuchte Erweiterung wird nichts versendet', async () => {
  const gesendet = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({ customer: KUNDE_VOLL, addons: [], empfaenger: DREI_EMPFAENGER });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_7', customerId: 'cust_1', call: ANRUF });

  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'nicht_aktiviert');
  assert.equal(gesendet.length, 0);
});

test('abgelaufene Erweiterung zaehlt nicht als gebucht', async () => {
  const gesendet = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({
    customer: KUNDE_VOLL,
    addons: [{ addon_code: 'sms_notify', status: 'active', active: true, valid_until: '2020-01-01' }],
    empfaenger: DREI_EMPFAENGER
  });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_8', customerId: 'cust_1', call: ANRUF });
  assert.equal(r.skipped, true);
  assert.equal(gesendet.length, 0);
});

test('callback_only sendet nur bei Rueckrufwunsch', async () => {
  const kunde = { ...KUNDE_VOLL, sms_notify_trigger: 'callback_only', sms_caller_enabled: false };

  const ohne = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  let r = await callSms.sendCallSms(
    fakeSb({ customer: kunde, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER }),
    { callRowId: 'call_9', customerId: 'cust_1', call: { ...ANRUF, callback_requested: false } });
  assert.equal(r.skipped, true);
  assert.equal(ohne.length, 0);

  const mit = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  r = await callSms.sendCallSms(
    fakeSb({ customer: kunde, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER }),
    { callRowId: 'call_10', customerId: 'cust_1', call: { ...ANRUF, callback_requested: true } });
  assert.equal(r.team.angenommen, 3);
  assert.equal(mit.length, 3);
});

test('unbekannter Ausloeser faellt auf callback_only, nicht auf "alles senden"', () => {
  assert.equal(callSms.ausloeserTrifftZu('quatsch', false, 'cust_1', 'test'), false);
  assert.equal(callSms.ausloeserTrifftZu('quatsch', true, 'cust_1', 'test'), true);
  assert.equal(callSms.ausloeserTrifftZu('all', false, 'cust_1', 'test'), true);
  assert.equal(callSms.ausloeserTrifftZu('none', true, 'cust_1', 'test'), false);
});

test('doppelte Nummer in der Empfaengerliste wird nur einmal angeschrieben', async () => {
  const gesendet = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({
    customer: { ...KUNDE_VOLL, sms_caller_enabled: false },
    addons: ADDONS_BEIDE,
    empfaenger: [
      { id: 'r1', phone_e164: '+41791111111', name: 'Ruedi', sort_order: 0 },
      { id: 'r2', phone_e164: '0791111111', name: 'Ruedi nochmal', sort_order: 1 }
    ]
  });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_11', customerId: 'cust_1', call: ANRUF });
  assert.equal(r.team.versucht, 1, 'dieselbe Nummer in anderer Schreibweise zaehlt einmal');
  assert.equal(gesendet.length, 1);
});

test('der Doppelversand-Schluessel unterscheidet Empfaenger', async () => {
  stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({ customer: { ...KUNDE_VOLL, sms_caller_enabled: false }, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER });

  await callSms.sendCallSms(sb, { callRowId: 'call_12', customerId: 'cust_1', call: ANRUF });

  const schluessel = sb._outbox.map(z => z.dedupe_key);
  assert.equal(new Set(schluessel).size, 3, 'drei verschiedene Schluessel');
  assert.ok(schluessel.every(k => k.startsWith('sms_team_notification:call_12:')));
});

// ───────────────────────────────────────────────────────────────────────────
// Die beiden Kopien duerfen nicht auseinanderlaufen
// ───────────────────────────────────────────────────────────────────────────

test('sms-transport.js ist in beiden Funktionsverzeichnissen identisch', () => {
  const a = fs.readFileSync(path.join(LIB, 'sms-transport.js'), 'utf8');
  const b = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin-panel', 'netlify', 'functions', '_lib', 'sms-transport.js'),
    'utf8'
  );
  assert.equal(a, b, 'Die Kopien sind auseinandergelaufen. Beide Dateien gleich halten.');
});

test('der Retry-Worker kennt beide SMS-Ereignistypen', () => {
  const worker = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin-panel', 'netlify', 'functions', 'outbox-retry-worker.js'),
    'utf8'
  );
  assert.match(worker, /isSmsEventType/, 'sonst fallen SMS-Zeilen in "unsupported event_type"');
  assert.match(worker, /delivery\.permanent/, 'permanente Fehler duerfen das Wiederholungsbudget nicht aufbrauchen');
});
