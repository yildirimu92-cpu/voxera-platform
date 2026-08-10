'use strict';

/**
 * Die Endpunkttabelle aus shared/core/admin-api.js festnageln.
 *
 * Welle 1 des Zielbilds hat acht Laufzeit-Wrapper um `callAdminFunction` in
 * eine Regelkette überführt. Die Reihenfolge dieser Regeln ist Verhalten, nicht
 * Geschmack: Regel 1 schreibt `mail-dispatch` auf `invoice-mail-dispatch` um,
 * und Regel 2 greift danach nicht mehr, weil sie nur `mail-dispatch` kennt.
 * Genau das tat die alte Wrapper-Kette auch — nur unsichtbar über acht Dateien
 * verteilt.
 *
 * Dieser Test prüft jede Umleitung, die es vorher gab. Fällt eine weg oder
 * verschiebt sich die Reihenfolge, schlägt er fehl.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Das Modul hängt sich an globalThis und braucht beim Laden kein document.
require(path.join(__dirname, '..', 'shared', 'core', 'admin-api.js'));
const api = globalThis.VoxeraAdminApi;

/** Endpunkt, an den ein Aufruf am Ende geht — oder 'REJECT'. */
function ziel(name, payload) {
  const aufgeloest = api.resolve(name, payload);
  return aufgeloest.reject ? 'REJECT' : aufgeloest.name;
}

test('admin-api ist geladen und bietet resolve an', () => {
  assert.strictEqual(typeof api, 'object');
  assert.strictEqual(typeof api.resolve, 'function');
  assert.strictEqual(typeof api.call, 'function');
});

test('Kundendaten schreiben geht an admin-customer-update (vorher: data-integrity)', () => {
  const aufgeloest = api.resolve('admin-mutate', { action: 'customers.update', id: 'c1', customer_id: 'c1', patch: { city: 'Bern' } });
  assert.strictEqual(aufgeloest.name, 'admin-customer-update');
  assert.deepStrictEqual(aufgeloest.payload, { id: 'c1', customer_id: 'c1', patch: { city: 'Bern' } });
});

test('Vertragskündigung geht an contract-terminate und packt die Nutzlast aus (vorher: contract-termination)', () => {
  const aufgeloest = api.resolve('admin-mutate', { action: 'contracts.cancel', payload: { contract_id: 'ct1', mode: 'ordinary' } });
  assert.strictEqual(aufgeloest.name, 'contract-terminate');
  assert.deepStrictEqual(aufgeloest.payload, { contract_id: 'ct1', mode: 'ordinary' });
  assert.strictEqual(aufgeloest.after.length, 1, 'die Nachbearbeitung muss erhalten bleiben');
});

test('v2-Endpunkte werden weiterhin angesteuert (vorher: launch-p0)', () => {
  assert.strictEqual(ziel('trigger-elevenlabs-sync', {}), 'trigger-elevenlabs-sync-v2');
  assert.strictEqual(ziel('scrape-website', { url: 'https://beispiel.ch' }), 'scrape-website-v2');
});

test('Storno und Gutschrift gehen an invoice-financial-action (vorher: invoice-adjustments)', () => {
  const storno = api.resolve('customer-billing-update', { action: 'cancel_invoice', invoice_id: 'i1', reason: 'Test' });
  assert.strictEqual(storno.name, 'invoice-financial-action');
  assert.strictEqual(storno.payload.action, 'void_draft');
  assert.strictEqual(storno.payload.invoice_id, 'i1');
  assert.strictEqual(storno.payload.reason, 'Test');
  assert.ok(storno.payload.request_id, 'ohne request_id ist der Aufruf nicht idempotent');

  const gutschrift = api.resolve('customer-billing-update', { action: 'create_credit_note', invoice_id: 'i1', amount: 42, description: 'Kulanz' });
  assert.strictEqual(gutschrift.name, 'invoice-financial-action');
  assert.strictEqual(gutschrift.payload.action, 'create_credit');
  assert.strictEqual(gutschrift.payload.amount, 42);
  assert.strictEqual(gutschrift.payload.reason, 'Kulanz');
});

test('Überzugsrechnung geht an admin-overage-invoice (vorher: billing-inline-qr)', () => {
  const aufgeloest = api.resolve('customer-billing-update', { action: 'create_overage_invoice', customer_id: 'c1' });
  assert.strictEqual(aufgeloest.name, 'admin-overage-invoice');
  assert.strictEqual(aufgeloest.after.length, 1, 'Rechnung in state übernehmen und Toast zeigen');
});

test('Zahlungslink-Aktionen werden abgewiesen, nicht gesendet (vorher: invoice-only-ch)', () => {
  for (const action of ['send_payment_link', 'send_monthly_payment_link', 'send_yearly_payment_link']) {
    const aufgeloest = api.resolve('customer-billing-update', { action });
    assert.ok(aufgeloest.reject, `${action} muss abgewiesen werden`);
    assert.match(aufgeloest.reject.message, /Zahlungslinks sind deaktiviert/);
    assert.strictEqual(aufgeloest.reject.payload.step_failed, 'legacy_payment_link_disabled');
  }
});

test('Rechnungsmail: Versand, Vorschau und Trockenlauf (vorher: invoice-mail-routing-fix)', () => {
  assert.strictEqual(
    ziel('mail-dispatch', { mail_type: 'invoice_email', invoice_id: 'i1' }),
    'invoice-mail-dispatch'
  );
  assert.strictEqual(
    ziel('mail-dispatch', { mail_type: 'invoice_email', invoice_id: 'i1', dry_run: true }),
    'invoice-mail-preview'
  );
  assert.strictEqual(
    ziel('invoice-mail-preview', { mail_type: 'reminder_email', invoice_id: 'i1' }),
    'invoice-mail-preview'
  );
});

test('Alt-Mailtypen werden auf den kanonischen Typ normalisiert', () => {
  const aufgeloest = api.resolve('mail-dispatch', { mail_type: 'setup_fee_email', invoice_id: 'i1' });
  assert.strictEqual(aufgeloest.name, 'invoice-mail-dispatch');
  assert.strictEqual(aufgeloest.payload.mail_type, 'invoice_email');
  assert.strictEqual(aufgeloest.payload.original_mail_type, 'setup_fee_email',
    'der ursprüngliche Typ muss erhalten bleiben, sonst ist die Herkunft weg');
});

test('Der Offerten-Versand bleibt bei mail-dispatch', () => {
  // Diese Zeile ist der Grund, warum die Reihenfolge der Regeln geprüft wird:
  // sendOffer() ruft mail-dispatch mit mail_type "offer_email" auf. Würde eine
  // der Rechnungsmail-Regeln zu breit greifen, ginge der Offertenversand still
  // an den Rechnungs-Endpunkt.
  assert.strictEqual(ziel('mail-dispatch', { mail_type: 'offer_email', offer_id: 'o1' }), 'mail-dispatch');
});

test('Nicht betroffene Aufrufe bleiben unverändert', () => {
  for (const name of ['admin-voices', 'create-customer', 'customer-go-live', 'cases-update', 'admin-mutate']) {
    assert.strictEqual(ziel(name, {}), name);
  }
});

test('Das Fehlerwörterbuch übersetzt nur ElevenLabs-Fehler (vorher: voice-errors)', () => {
  const stimmenFehler = Object.assign(new Error('boom'), { payload: { provider_code: 'payment_required' } });
  assert.match(api.describeError('admin-voices', stimmenFehler).message, /ElevenLabs-Abonnement/);

  const unbekannt = Object.assign(new Error('boom'), { payload: { provider_code: 'irgendwas' } });
  assert.strictEqual(api.describeError('admin-voices', unbekannt).message, 'boom');

  const andererEndpunkt = Object.assign(new Error('boom'), { payload: { provider_code: 'payment_required' } });
  assert.strictEqual(api.describeError('create-customer', andererEndpunkt).message, 'boom',
    'ausserhalb von admin-voices darf die Meldung nicht ersetzt werden');
});
