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

test('Team-SMS bleibt ein Segment', () => {
  const m = vorlagen.buildTeamSms({
    dringlichkeit: 'hoch',
    rueckrufnummer: '+41791234567',
    dashboardUrl: callSms.dashboardLinkFuerAnruf("call_1"),
    zeitpunkt: ZEIT
  });
  assert.equal(m.segmente, 1);
  assert.ok(m.laenge <= 160, `laenge ${m.laenge}`);
});

test('Team-SMS traegt Rueckrufnummer, Dringlichkeit und Link -- sonst nichts', () => {
  const m = vorlagen.buildTeamSms({
    dringlichkeit: 'hoch',
    rueckrufnummer: '+41791234567',
    dashboardUrl: 'https://dashboard.voxera.ch/?tab=requests',
    zeitpunkt: ZEIT
  });
  assert.match(m.text, /\+41791234567/);
  assert.match(m.text, /Dringlichkeit: hoch/);
  assert.match(m.text, /dashboard\.voxera\.ch/);
  assert.match(m.text, /Neuer Anruf/);
});

test('die Vorlage nimmt Anliegen-Felder gar nicht mehr entgegen', () => {
  // Wer sie wieder hineinschreiben will, muss die Signatur aendern -- und
  // stoesst dabei auf die Begruendung im Kopf von sms-templates.js.
  const m = vorlagen.buildTeamSms({
    rueckrufnummer: '+41791234567',
    dashboardUrl: 'https://dashboard.voxera.ch/?tab=requests',
    zeitpunkt: ZEIT,
    // Alles Folgende wird ignoriert:
    zusammenfassung: 'PW nach Panne nicht fahrbereit',
    anruferName: 'M. Keller',
    ort: 'A1 Ri. Bern, Ausf. Muri',
    anlass: 'Abschlepp-Anfrage'
  });
  assert.doesNotMatch(m.text, /Panne|fahrbereit/i);
  assert.doesNotMatch(m.text, /Keller/i);
  assert.doesNotMatch(m.text, /A1|Muri/);
  assert.doesNotMatch(m.text, /Abschlepp/i);
});

test('fehlende Rueckrufnummer wird benannt, nicht verschwiegen', () => {
  const m = vorlagen.buildTeamSms({ dashboardUrl: 'https://d.example/?tab=requests', zeitpunkt: ZEIT });
  assert.match(m.text, /keine Nummer uebermittelt/);
});

test('die Dringlichkeit steht IMMER da, notfalls als "unbekannt"', () => {
  // Pflichtzeile, seit die Nachricht kein Anliegen mehr traegt: sie
  // beantwortet als einzige "jetzt oder morgen". Eine fehlende Zeile liest
  // sich wie "nicht dringend" -- genau diese Lesart darf nicht entstehen.
  const ohne = vorlagen.buildTeamSms({ rueckrufnummer: '+41791234567', zeitpunkt: ZEIT });
  assert.match(ohne.text, /Dringlichkeit: unbekannt/);

  const mit = vorlagen.buildTeamSms({ dringlichkeit: 'hoch', rueckrufnummer: '+41791234567', zeitpunkt: ZEIT });
  assert.match(mit.text, /Dringlichkeit: hoch/);
});

test('nur eingestufte Dringlichkeiten gehen mit', () => {
  assert.equal(callSms.dringlichkeitAusAnruf({ urgency: 'hoch' }), 'hoch');
  assert.equal(callSms.dringlichkeitAusAnruf({ urgency: 'MITTEL' }), 'mittel');
  assert.equal(callSms.dringlichkeitAusAnruf({ urgency: null }), '');
  assert.equal(callSms.dringlichkeitAusAnruf({ urgency: 'Kunde will Termin' }), '',
    'ein Freitext darf nicht als Dringlichkeit durchrutschen');
});

test('der Link zeigt auf genau diesen Anruf', () => {
  const id = '8c101866-94bb-4081-8b75-f879e3d46744';
  assert.equal(callSms.dashboardLinkFuerAnruf(id), `https://dashboard.voxera.ch/#call/${id}`);
});

test('ohne Anruf-Kennung faellt der Link auf die Anfragenliste zurueck', () => {
  // Ein Link auf nichts waere schlimmer als ein Link auf die Liste.
  assert.match(callSms.dashboardLinkFuerAnruf(''), /\?tab=requests$/);
  assert.match(callSms.dashboardLinkFuerAnruf(null), /\?tab=requests$/);
});

test('die Team-SMS bleibt auch im laengsten Fall ein Segment', () => {
  // Schlimmster realistischer Fall: nicht eingestufte Dringlichkeit (das ist
  // heute die Mehrheit), volle UUID im Link, lange Rufnummer. Ein zweites
  // Segment kostet bei fuenf Empfaengern fuenffach.
  const m = vorlagen.buildTeamSms({
    dringlichkeit: '',
    rueckrufnummer: '+491701234567890',
    dashboardUrl: callSms.dashboardLinkFuerAnruf('8c101866-94bb-4081-8b75-f879e3d46744'),
    zeitpunkt: ZEIT
  });
  assert.equal(m.segmente, 1, `laenge ${m.laenge}: ${m.text}`);
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

// Der Standardwert im Code und der in Netlify eingetragene Wert sind beide
// 'Voxera'. Ohne quelle waeren die beiden Faelle am Ergebnis nicht zu
// unterscheiden -- und damit die Frage "kommt die Variable in der Function an"
// nur noch aus der Netlify-Oberflaeche zu beantworten, nicht aus dem
// Zielsystem.
test('quelle unterscheidet gesetzte Variable vom gleichlautenden Standardwert', () => {
  const ausEnv = transport.resolveSender({ TWILIO_SMS_FROM: 'Voxera' });
  const ausFallback = transport.resolveSender({});

  assert.equal(ausEnv.sender, ausFallback.sender, 'Voraussetzung des Tests: beide ergeben denselben Absender');
  assert.equal(ausEnv.quelle, 'env');
  assert.equal(ausFallback.quelle, 'standardwert');
});

test('quelle steht auch dann fest, wenn der Absender abgewiesen wird', () => {
  const r = transport.resolveSender({ TWILIO_SMS_FROM: 'VoxeraSchweizAG' });
  assert.equal(r.sender, null);
  assert.equal(r.quelle, 'env', 'sonst waere bei Fehlkonfiguration nicht erkennbar, wer den Wert gesetzt hat');
});

test('Leerzeichen allein zaehlen nicht als gesetzte Variable', () => {
  assert.equal(transport.resolveSender({ TWILIO_SMS_FROM: '   ' }).quelle, 'standardwert');
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
function fakeSb({ customer, addons = [], empfaenger = [], empfaengerError = null, outbox = [] }) {
  const updates = [];

  const bauKette = (tabelle) => {
    const f = { eqs: {}, neu: null, kollision: false };
    const kette = {
      _tabelle: tabelle,
      select() { return kette; },
      eq(spalte, wert) { f.eqs[spalte] = wert; return kette; },
      order() { return kette; },
      limit() { return kette; },

      insert(row) {
        // Der Unique-Index uq_outbox_events_type_dedupe_key existiert seit
        // 20260809142631 in Produktion. Zwei Zeilen mit demselben
        // (event_type, dedupe_key) kollidieren -- genau das passiert, wenn
        // Tool-Call- und Post-Call-Pfad denselben Anruf verarbeiten.
        const vorhanden = outbox.find(z =>
          z.dedupe_key && z.dedupe_key === row.dedupe_key && z.event_type === row.event_type);
        if (vorhanden) f.kollision = true;
        else {
          f.neu = { id: `ob_${outbox.length + 1}`, retry_count: 0, status: 'pending', ...row };
          outbox.push(f.neu);
        }
        return kette;
      },

      update(payload) { updates.push({ tabelle, payload, filter: f }); return kette; },

      single: async () => f.kollision
        ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        : { data: f.neu, error: null },

      maybeSingle: async () => {
        if (tabelle === 'customers') return { data: customer, error: null };
        if (tabelle === 'outbox_events') {
          if (f.eqs.dedupe_key) return { data: outbox.find(z => z.dedupe_key === f.eqs.dedupe_key) || null, error: null };
          if (f.eqs.id) return { data: outbox.find(z => z.id === f.eqs.id) || null, error: null };
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },

      then(resolve) {
        if (tabelle === 'customer_addons') return resolve({ data: addons, error: null });
        if (tabelle === 'customer_notification_recipients') {
          return resolve(empfaengerError ? { data: null, error: empfaengerError } : { data: empfaenger, error: null });
        }
        return resolve({ data: [], error: null });
      }
    };
    return kette;
  };

  return { from: bauKette, _outbox: outbox, _updates: updates };
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

test('die versendete Team-SMS enthaelt kein Inhaltsdatum', async () => {
  // Der Regressionsschutz fuer die Datenresidenz-Entscheidung vom 2026-08-11:
  // Twilio bewahrt den Nachrichtentext 400 Tage in den USA auf, die eigene
  // Frist betraegt 90 Tage. Was hier hineinrutscht, laesst sich nachtraeglich
  // nicht mehr einsammeln.
  const gesendet = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({
    customer: { ...KUNDE_VOLL, sms_caller_enabled: false },
    addons: ADDONS_BEIDE,
    empfaenger: DREI_EMPFAENGER
  });

  await callSms.sendCallSms(sb, {
    callRowId: 'call_dsg', customerId: 'cust_1',
    call: {
      ...ANRUF,
      caller_name: 'Martina Kellerhals',
      call_summary: 'Anruferin steht mit Motorschaden auf der A1 bei Muri und braucht sofort einen Abschleppwagen.',
      call_summary_short: 'Motorschaden A1, Abschleppwagen noetig',
      caller_location: 'A1 Richtung Bern, Ausfahrt Muri',
      category: 'notfall',
      urgency: 'hoch'
    }
  });

  assert.ok(gesendet.length > 0);
  for (const { body } of gesendet) {
    assert.doesNotMatch(body, /Kellerhals|Martina/i, 'Name des Anrufers');
    assert.doesNotMatch(body, /Motorschaden|Abschlepp/i, 'Anliegen');
    assert.doesNotMatch(body, /A1|Muri|Bern/, 'Ort');
    assert.doesNotMatch(body, /notfall/i, 'Kategorie');
    // Was drinstehen darf und muss:
    assert.match(body, /\+41794444444/, 'Rueckrufnummer');
    assert.match(body, /Dringlichkeit: hoch/);
    assert.match(body, /dashboard\.voxera\.ch/);
  }
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
// Doppelversand, Fehlkonfiguration, fehlende Migration
// ───────────────────────────────────────────────────────────────────────────

test('ein erneut zugestellter Webhook loest keinen zweiten Versand aus', async () => {
  // Tool-Call- und Post-Call-Pfad feuern beide fuer dasselbe Gespraech, und
  // ElevenLabs stellt denselben Webhook bei Bedarf erneut zu. Ohne Auswertung
  // der Outbox-Kollision bekaeme ein vierkoepfiges Team dieselbe Nachricht
  // zweimal -- nachts, und zum doppelten Preis.
  const geteilteOutbox = [];
  const kunde = { ...KUNDE_VOLL, sms_caller_enabled: false };

  const ersterLauf = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const r1 = await callSms.sendCallSms(
    fakeSb({ customer: kunde, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER, outbox: geteilteOutbox }),
    { callRowId: 'call_dup', customerId: 'cust_1', call: ANRUF });
  assert.equal(r1.team.angenommen, 3);
  assert.equal(ersterLauf.length, 3);

  const zweiterLauf = stubFetch(() => ({ status: 201, body: { sid: 'SM2' } }));
  const r2 = await callSms.sendCallSms(
    fakeSb({ customer: kunde, addons: ADDONS_BEIDE, empfaenger: DREI_EMPFAENGER, outbox: geteilteOutbox }),
    { callRowId: 'call_dup', customerId: 'cust_1', call: ANRUF });

  assert.equal(zweiterLauf.length, 0, 'zweiter Lauf darf nichts an Twilio schicken');
  assert.equal(r2.team.angenommen, 0);
  assert.equal(r2.team.uebersprungen, 3);
  assert.equal(geteilteOutbox.length, 3, 'keine zusaetzlichen Outbox-Zeilen');
});

test('ein permanenter Fehler kommt sofort auf "dead", nicht auf "failed"', async () => {
  // Sonst holt der Retry-Worker die Zeile noch einmal und schickt einen
  // weiteren Request an Twilio, bevor er selbst merkt, dass es zwecklos ist.
  stubFetch(() => ({ status: 400, body: { code: 21614, message: 'not a mobile number' } }));
  const sb = fakeSb({
    customer: { ...KUNDE_VOLL, sms_caller_enabled: false },
    addons: ADDONS_BEIDE,
    empfaenger: [DREI_EMPFAENGER[0]]
  });

  await callSms.sendCallSms(sb, { callRowId: 'call_perm', customerId: 'cust_1', call: ANRUF });

  const status = sb._updates.filter(u => u.tabelle === 'outbox_events').map(u => u.payload.status);
  assert.ok(status.includes('dead'), `erwartet 'dead', erhalten: ${JSON.stringify(status)}`);
  assert.ok(!status.includes('failed'), 'kein Zwischenschritt ueber failed');
});

test('leere Empfaengerliste unterdrueckt die Anrufer-Bestaetigung', async () => {
  // Gebucht, eingeschaltet, niemand eingetragen: der Kunde glaubt sein Team
  // abgedeckt. Der Anrufer duerfte dann keine Bestaetigung bekommen.
  const gesendet = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({ customer: KUNDE_VOLL, addons: ADDONS_BEIDE, empfaenger: [] });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_leer', customerId: 'cust_1', call: ANRUF });

  assert.equal(r.team.versucht, 0);
  assert.equal(r.anrufer.versucht, false);
  assert.equal(r.anrufer.uebersprungen, true);
  assert.equal(r.anrufer.reason, 'team_ohne_empfaenger');
  assert.equal(gesendet.length, 0);
});

test('fehlende Empfaengertabelle bricht den Pfad nicht ab', async () => {
  // AGENTS.md: Code und Migration duerfen nicht getrennt gemergt werden --
  // hier gilt die zweite Option, der Code kommt ohne die Migration aus.
  const gesendet = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({
    customer: KUNDE_VOLL,
    addons: ADDONS_BEIDE,
    empfaengerError: { code: '42P01', message: 'relation "customer_notification_recipients" does not exist' }
  });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_migr', customerId: 'cust_1', call: ANRUF });

  assert.equal(r.error, null, 'kein Absturz');
  assert.equal(r.team.versucht, 0);
  assert.equal(r.anrufer.uebersprungen, true);
  assert.equal(r.anrufer.reason, 'team_tabelle_fehlt');
  assert.equal(gesendet.length, 0);
});

test('bei nicht gebuchtem Team-SMS geht die Anrufer-Bestaetigung trotzdem raus', async () => {
  // Der Unterschied zum Fall darueber: Der Team-Kanal ist gar nicht
  // eingeschaltet, benachrichtigt wurde per E-Mail. Kein Fehlschlag -- die
  // Nachricht traegt nur die schwaechere Aussage.
  const gesendet = stubFetch(() => ({ status: 201, body: { sid: 'SM1' } }));
  const sb = fakeSb({
    customer: { ...KUNDE_VOLL, sms_notify_enabled: false },
    addons: [{ addon_code: 'sms_endkunde', status: 'active', active: true, valid_until: null }],
    empfaenger: []
  });

  const r = await callSms.sendCallSms(sb, { callRowId: 'call_nurendk', customerId: 'cust_1', call: ANRUF });

  assert.equal(r.anrufer.angenommen, true);
  assert.equal(gesendet.length, 1);
  assert.doesNotMatch(gesendet[0].body, /Team ist informiert/);
  assert.match(gesendet[0].body, /aufgenommen/);
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

test('die Herkunft des Absenders wird protokolliert, nicht nur der Absender', () => {
  // Ohne from_quelle ist die Frage "kommt TWILIO_SMS_FROM in der Function an"
  // aus dem Zielsystem nicht beantwortbar: gesetzter Wert und Standardwert
  // sind beide 'Voxera' und ergeben denselben Versand.
  const src = fs.readFileSync(path.join(LIB, 'sms-delivery.js'), 'utf8');
  assert.match(src, /from_quelle:\s*senderQuelle/,
    'from_quelle fehlt in der Outbox-Nutzlast');
  const iErfolg = src.indexOf("'sms_send_succeeded'");
  assert.ok(iErfolg > -1);
  assert.match(src.slice(iErfolg, iErfolg + 240), /from_quelle/,
    'die Erfolgszeile im Log nennt die Herkunft des Absenders nicht');
});

test('die Migration definiert set_updated_at, bevor sie den Trigger anlegt', () => {
  // Die Funktion existiert in Produktion, ist aber in keiner Migrationsdatei
  // definiert -- sie wurde seinerzeit direkt auf der Datenbank angelegt. Eine
  // frisch aus den Migrationen aufgebaute Umgebung braeuchte sie hier, sonst
  // bricht CREATE TRIGGER ab und rollt die Tabelle zurueck.
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260811210000_sms_notification_recipients.sql'),
    'utf8'
  );
  const iDefinition = sql.indexOf('create function public.set_updated_at');
  const iTrigger = sql.indexOf('create trigger trg_customer_notification_recipients_updated_at');
  assert.ok(iDefinition > -1, 'set_updated_at wird nicht nachgetragen');
  assert.ok(iTrigger > -1);
  assert.ok(iDefinition < iTrigger, 'die Definition muss vor dem Trigger stehen');
  assert.doesNotMatch(sql, /create or replace function public\.set_updated_at/,
    'die bestehende Funktion darf nicht ersetzt werden -- an ihr haengen sieben weitere Tabellen');
});

test('die Dringlichkeits-Beschreibung traegt den Folgen-Massstab, nicht die Signalbedingung', () => {
  // Die Team-SMS traegt kein Anliegen mehr; die Dringlichkeit ist die einzige
  // Angabe, die "jetzt oder morgen" beantwortet. Sie entsteht in der
  // strukturierten Auswertung, und die liest NICHT den Gespraechsprompt,
  // sondern diese Beschreibung. Faellt sie auf "nur aus Anrufer-Aussagen"
  // zurueck, bleibt das Feld wieder auf 58 % leer -- und die SMS verliert
  // ihren einzigen Entscheidungsgehalt.
  const cfg = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin-panel', 'netlify', 'functions', '_lib', 'elevenlabs-agent-config.js'),
    'utf8'
  );
  const block = cfg.split('urgency: {')[1].split('},')[0];

  assert.doesNotMatch(block, /Nur aus Anrufer-Aussagen ableiten/,
    'die Signalbedingung ist zurueck -- sie war die Ursache der 58 % leeren Felder');
  assert.match(block, /FOLGE DES WARTENS/, 'der Massstab fehlt');
  assert.match(block, /Autobahn/, 'Grenzfall Fahrzeug fehlt');
  assert.match(block, /Eimer/, 'Grenzfall Wasser fehlt');
  assert.match(block, /Stufe IMMER ein/, 'die Rueckfallregel fehlt');
  assert.match(block, /Ohne verwertbare Information: niedrig/,
    'die Rueckfallregel muss "niedrig" sagen, nicht "leer lassen"');

  // Kein enum -- bewusst. lead_quality hat keines und erreicht 29 von 33; der
  // Hebel ist die Rueckfallregel. Ein enum waere eine zweite Aenderung an
  // derselben Stelle, die den Testanruf nicht mehr zuordenbar macht.
  assert.doesNotMatch(block, /enum:/, 'enum ist bewusst nicht Teil dieser Aenderung');
});

test('jede der drei Stufen traegt ein Beispiel', () => {
  const cfg = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin-panel', 'netlify', 'functions', '_lib', 'elevenlabs-agent-config.js'),
    'utf8'
  );
  const block = cfg.split('urgency: {')[1].split('},')[0];
  // Eine Definition ohne Beispiel ist die Form, an der Einstufungen scheitern.
  assert.equal((block.match(/Beispiel:/g) || []).length, 3,
    'jede Stufe braucht genau ein Beispiel');
});

test('der isolierte Test bleibt isoliert: kein gleichzeitiger Prompt-Eingriff', () => {
  // Der Testanruf misst genau eine Aenderung. Kommt eine Migration auf
  // prompt_master_l1 dazu, bevor gemessen wurde, ist das Ergebnis nicht mehr
  // zuordenbar -- und die Architekturfrage bleibt offen, obwohl ein Testanruf
  // verbraucht wurde.
  const migrationen = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  const treffer = fs.readdirSync(migrationen).filter(f => {
    if (!f.endsWith('.sql')) return false;
    const inhalt = fs.readFileSync(path.join(migrationen, f), 'utf8');
    return /update\s+public\.system_config[\s\S]{0,400}prompt_master_l1/i.test(inhalt);
  });
  assert.deepEqual(treffer, [],
    'Eine Migration aendert prompt_master_l1. Erst messen, dann den Prompt anfassen: ' + treffer.join(', '));
});

test('der Retry-Worker kennt beide SMS-Ereignistypen', () => {
  const worker = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin-panel', 'netlify', 'functions', 'outbox-retry-worker.js'),
    'utf8'
  );
  assert.match(worker, /isSmsEventType/, 'sonst fallen SMS-Zeilen in "unsupported event_type"');
  assert.match(worker, /delivery\.permanent/, 'permanente Fehler duerfen das Wiederholungsbudget nicht aufbrauchen');
});

test('der Retry-Worker belegt die Absenderherkunft seiner eigenen Site', () => {
  // voxera-admin ist die einzige Stelle, an der TWILIO_SMS_FROM aus DIESEM
  // Projekt gelesen wird, und der Worker laeuft nur im Fehlerfall an. Ohne
  // diese Logzeile bliebe die zweite Umgebung dauerhaft unbelegt -- Test 8 des
  // Testplans haette dann kein Ergebnis, sondern nur eine Beobachtung.
  const worker = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin-panel', 'netlify', 'functions', 'outbox-retry-worker.js'),
    'utf8'
  );
  assert.match(worker, /resolveSender/, 'der Worker liest seine eigene Absenderkonfiguration nicht');
  assert.match(worker, /'retry_sms_absender'/, 'die Herkunft wird nicht protokolliert');
  assert.match(worker, /site: 'voxera-admin'/,
    'ohne Site-Kennung ist die Zeile im Logbestand nicht von der Dashboard-Site zu trennen');
  // Der Payload darf beim Nachliefern nicht veraendert werden: er traegt die
  // Herkunft des ERSTVERSANDS, und der Text muss der von damals bleiben.
  assert.doesNotMatch(worker, /payload\.from_quelle\s*=/,
    'der Worker darf die Nutzlast des Erstversands nicht ueberschreiben');
});
