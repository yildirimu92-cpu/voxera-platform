#!/usr/bin/env node
/**
 * Prueft die Migration der Anruf-Benachrichtigung von Make-Szenario 01 auf die
 * zentrale Mail-Engine (_lib/mail-delivery.js + outbox_events).
 *
 * Der Kern ist die Regression, an der Szenario 01 tagelang scheiterte: ein
 * leerer called_number im Webhook-Payload. Szenario 01 schickte den Wert an
 * call-intake-resolve-customer, der ihn mit HTTP 400 abwies - keine Mail, kein
 * Protokoll, kein Retry. Der neue Pfad nimmt den Kunden aus der bereits
 * gematchten calls-Zeile und darf deshalb auch ohne Nummer zustellen.
 *
 * Laeuft ohne Netz und ohne Datenbank: Supabase wird durch einen Doubles-Client
 * ersetzt, der Abfragen protokolliert. MAKE_MAIL_WEBHOOK bleibt bewusst leer,
 * damit deliverMail vor dem fetch abbricht - geprueft wird, was bis dahin
 * passiert (Aufloesung, Gating, Dedupe, Outbox-Zeile), nicht Make selbst.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Vor dem Laden der Bibliothek: kein Mail-Hook konfiguriert, damit kein
// Netzwerkaufruf entstehen kann, egal wie der Test endet.
delete process.env.MAKE_MAIL_WEBHOOK;
delete process.env.MAKE_CALL_INTAKE_WEBHOOK;

const libPath = path.join(root, 'customer-dashboard', 'netlify', 'functions', '_lib', 'call-notification.js');
const { decideMail, buildPayload, sendCallNotification, CALL_MAIL_TYPE, CALLBACK_MAIL_TYPE } = require(libPath);

const failures = [];
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

async function checkAsync(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

// ─── Supabase-Double ────────────────────────────────────────────────────────
// Nur so viel Query-Builder, wie call-notification.js und webhook-outbox.js
// tatsaechlich benutzen: select/eq/not/limit/maybeSingle/single und insert.
function makeSupabaseDouble({ customers = [], outboxRows = [], calls = [] } = {}) {
  const log = { inserts: [], selects: [] };

  function builder(table) {
    const state = { table, filters: {}, limit: null };

    const api = {
      select() { return api; },
      eq(column, value) { state.filters[column] = value; return api; },
      not() { return api; },
      is() { return api; },
      gte() { return api; },
      order() { return api; },
      limit(value) { state.limit = value; return api; },
      insert(row) {
        log.inserts.push({ table, row });
        state.inserted = { id: `outbox_${log.inserts.length}`, ...row };
        return api;
      },
      update() { return api; },
      maybeSingle() { return Promise.resolve(resolveRows(true)); },
      single() { return Promise.resolve(resolveRows(true)); },
      then(onFulfilled, onRejected) { return Promise.resolve(resolveRows(false)).then(onFulfilled, onRejected); }
    };

    function resolveRows(singleRow) {
      if (state.inserted) return { data: state.inserted, error: null };
      log.selects.push({ table, filters: { ...state.filters } });

      const source = table === 'customers' ? customers
        : table === 'outbox_events' ? outboxRows
        : table === 'calls' ? calls
        : [];
      const matched = source.filter(row =>
        Object.entries(state.filters).every(([column, value]) => row[column] === value)
      );
      if (singleRow) return { data: matched[0] || null, error: null };
      return { data: matched, error: null };
    }

    return api;
  }

  return { from: builder, __log: log };
}

const ACTIVE_CUSTOMER = {
  id: 'cust_test_1',
  customer_name: 'E2E Test AG',
  contact_name: 'Testperson',
  email: 'test@example.invalid',
  voxera_number: '+41445052800',
  notification_active: true,
  notification_mode: 'all_calls',
  new_log_email_active: true,
  missed_call_email_active: true
};

// ─── Gating: Paritaet zu den beiden Router-Filtern in Szenario 01 ───────────
console.log('\nGating (Paritaet zu Make-Szenario 01):');

check('Rueckruf + notification_active -> callback_request_email', () => {
  assert.equal(decideMail(ACTIVE_CUSTOMER, true).mailType, CALLBACK_MAIL_TYPE);
});

check('Normaler Anruf + new_log_email_active -> call_notification_email', () => {
  assert.equal(decideMail(ACTIVE_CUSTOMER, false).mailType, CALL_MAIL_TYPE);
});

check('Rueckruf bei notification_active=false wird nicht verschickt', () => {
  const result = decideMail({ ...ACTIVE_CUSTOMER, notification_active: false }, true);
  assert.equal(result.mailType, null);
  assert.equal(result.reason, 'notification_active_off');
});

check('Normaler Anruf bei new_log_email_active=false wird nicht verschickt', () => {
  const result = decideMail({ ...ACTIVE_CUSTOMER, new_log_email_active: false }, false);
  assert.equal(result.mailType, null);
  assert.equal(result.reason, 'new_log_email_active_off');
});

check('Die beiden Schalter sind nicht vertauscht', () => {
  // Szenario 01 gated den Rueckruf ueber notification_active und den normalen
  // Anruf ueber new_log_email_active. Ein Vertauschen faellt sonst nicht auf,
  // weil beim Testkunden beide Schalter an sind.
  const callbackOnly = { ...ACTIVE_CUSTOMER, notification_active: true, new_log_email_active: false };
  assert.equal(decideMail(callbackOnly, true).mailType, CALLBACK_MAIL_TYPE);
  assert.equal(decideMail(callbackOnly, false).mailType, null);
});

check('Kunde ohne E-Mail bekommt keine Mail', () => {
  const result = decideMail({ ...ACTIVE_CUSTOMER, email: '' }, false);
  assert.equal(result.mailType, null);
  assert.equal(result.reason, 'customer_without_email');
});

check('Unaufgeloester Kunde bekommt keine Mail', () => {
  assert.equal(decideMail(null, false).reason, 'customer_not_resolved');
});

// ─── Payload: Feldnamen aus Szenario 01 bleiben erhalten ───────────────────
console.log('\nPayload-Vertrag:');

check('Payload traegt die Feldnamen der Szenario-01-Vorlagen', () => {
  const payload = buildPayload({
    customer: ACTIVE_CUSTOMER,
    call: {
      caller_name: 'Umut Yildirim',
      caller_phone: '+41799268933',
      call_summary: 'Testanruf.',
      call_summary_short: 'Testanruf',
      category: 'Sonstiges',
      lead_quality: 'cold',
      duration_seconds: 21,
      elevenlabs_conversation_id: 'conv_test'
    },
    calledNumber: '+41445052800',
    callbackRequested: false
  });
  // Diese Namen referenzieren die HTML-Vorlagen als {{1.<name>}}. Aendert sich
  // einer, rendert die Mail in Make leere Felder.
  for (const field of [
    'caller_name', 'caller_phone', 'call_summary', 'category',
    'lead_quality', 'duration_seconds', 'callback_requested'
  ]) {
    assert.ok(field in payload, `Feld ${field} fehlt im Payload`);
  }
  assert.equal(payload.recipient_email, ACTIVE_CUSTOMER.email);
  assert.equal(payload.customer_id, ACTIVE_CUSTOMER.id);
  assert.equal(payload.duration_seconds, 21);
});

check('Fehlende Dauer wird zu null, nicht zu NaN', () => {
  const payload = buildPayload({
    customer: ACTIVE_CUSTOMER, call: {}, calledNumber: '', callbackRequested: false
  });
  assert.equal(payload.duration_seconds, null);
});

// ─── Die Regression selbst ──────────────────────────────────────────────────
console.log('\nRegression (leerer called_number):');

await checkAsync('Leerer called_number verhindert die Mail nicht mehr', async () => {
  const sb = makeSupabaseDouble({ customers: [ACTIVE_CUSTOMER] });
  const result = await sendCallNotification(sb, {
    callRowId: 'call_row_1',
    customerId: ACTIVE_CUSTOMER.id,
    calledNumber: '', // genau der Zustand, der Szenario 01 mit HTTP 400 abwies
    call: { caller_phone: '+41799268933', callback_requested: false }
  });
  assert.equal(result.skipped, false, 'Die Mail wurde uebersprungen');
  assert.equal(result.mail_type, CALL_MAIL_TYPE);
  const outboxInsert = sb.__log.inserts.find(entry => entry.table === 'outbox_events');
  assert.ok(outboxInsert, 'Keine Outbox-Zeile geschrieben');
  assert.equal(outboxInsert.row.event_type, CALL_MAIL_TYPE);
  assert.equal(outboxInsert.row.dedupe_key, `${CALL_MAIL_TYPE}:call_row_1`);
});

await checkAsync('Ohne customer_id wird der Kunde aus der calls-Zeile nachgelesen', async () => {
  // Der schlimmste realistische Fall im Tool-Call-Pfad: called_number leer UND
  // die customer_id des Aufrufers nicht ermittelt. Die Zeile kennt den Kunden
  // trotzdem, weil der Twilio-Stub ihn beim Anruf gesetzt hat.
  const sb = makeSupabaseDouble({
    customers: [ACTIVE_CUSTOMER],
    calls: [{ id: 'call_row_5', customer_id: ACTIVE_CUSTOMER.id }]
  });
  const result = await sendCallNotification(sb, {
    callRowId: 'call_row_5',
    customerId: null,
    calledNumber: '',
    call: { callback_requested: false }
  });
  assert.equal(result.skipped, false, 'Die Mail wurde uebersprungen');
  assert.equal(result.mail_type, CALL_MAIL_TYPE);
});

await checkAsync('Ohne customer_id greift der Rueckfall ueber die Voxera-Nummer', async () => {
  const sb = makeSupabaseDouble({ customers: [ACTIVE_CUSTOMER] });
  const result = await sendCallNotification(sb, {
    callRowId: 'call_row_2',
    customerId: null,
    calledNumber: '+41445052800',
    call: { callback_requested: true }
  });
  assert.equal(result.skipped, false);
  assert.equal(result.mail_type, CALLBACK_MAIL_TYPE);
});

await checkAsync('Weder Kunde noch Nummer: sauberes Ueberspringen statt Fehler', async () => {
  const sb = makeSupabaseDouble({ customers: [] });
  const result = await sendCallNotification(sb, {
    callRowId: 'call_row_3', customerId: null, calledNumber: '', call: {}
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'customer_not_resolved');
  assert.equal(sb.__log.inserts.length, 0, 'Es wurde trotzdem eine Outbox-Zeile geschrieben');
});

// ─── Doppelversand ──────────────────────────────────────────────────────────
console.log('\nDoppelversand-Schutz:');

await checkAsync('Bereits eingereihte Benachrichtigung wird nicht erneut verschickt', async () => {
  // Tool-Call-Pfad und Post-Call-Pfad treffen dieselbe calls-Zeile; ohne diese
  // Sperre bekommt der Kunde zwei identische Mails fuer ein Gespraech.
  const sb = makeSupabaseDouble({
    customers: [ACTIVE_CUSTOMER],
    outboxRows: [{
      id: 'outbox_existing',
      event_type: CALL_MAIL_TYPE,
      dedupe_key: `${CALL_MAIL_TYPE}:call_row_9`,
      status: 'sent'
    }]
  });
  const result = await sendCallNotification(sb, {
    callRowId: 'call_row_9',
    customerId: ACTIVE_CUSTOMER.id,
    calledNumber: '+41445052800',
    call: { callback_requested: false }
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'already_queued');
  assert.equal(sb.__log.inserts.length, 0, 'Trotz Sperre wurde erneut eingereiht');
});

await checkAsync('Ein Rueckruf blockiert die normale Anrufmail nicht', async () => {
  // Verschiedene mail_types teilen sich den Datensatz, aber nicht die Sperre.
  const sb = makeSupabaseDouble({
    customers: [ACTIVE_CUSTOMER],
    outboxRows: [{
      id: 'outbox_existing',
      event_type: CALLBACK_MAIL_TYPE,
      dedupe_key: `${CALLBACK_MAIL_TYPE}:call_row_10`,
      status: 'sent'
    }]
  });
  const result = await sendCallNotification(sb, {
    callRowId: 'call_row_10',
    customerId: ACTIVE_CUSTOMER.id,
    calledNumber: '+41445052800',
    call: { callback_requested: false }
  });
  assert.equal(result.skipped, false);
});

// ─── Robustheit ─────────────────────────────────────────────────────────────
console.log('\nRobustheit:');

await checkAsync('Ein Datenbankfehler laesst den Anruf-Intake nicht scheitern', async () => {
  const exploding = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() { throw new Error('supabase down'); }
      };
    }
  };
  const result = await sendCallNotification(exploding, {
    callRowId: 'call_row_4', customerId: 'cust_test_1', calledNumber: '', call: {}
  });
  assert.equal(result.accepted, false);
  assert.match(result.error, /supabase down/);
});

console.log(`\n${checks - failures.length}/${checks} Pruefungen bestanden.`);
if (failures.length) {
  console.error('\nCall-Notification-Migration fehlgeschlagen:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Call-Notification-Migration verifiziert.');
