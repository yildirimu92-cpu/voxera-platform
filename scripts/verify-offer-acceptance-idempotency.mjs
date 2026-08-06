#!/usr/bin/env node
// Verifies the offer-acceptance idempotency/visibility fix:
//  - concurrent accept attempts on the same offer are serialized via a compare-and-swap
//    claim (offers.accept_claim_key), not a race
//  - a failed contract creation leaves the offer in the retry-capable 'contract_failed'
//    status instead of a final 'accepted' with no contract
//  - a failed contract creation is always visible to admins via an ops review case,
//    whether or not the caller allows the failure to be swallowed
//  - accepting the same offer twice never creates a second contract row
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LIB_DIR = new URL('../admin-panel/netlify/functions/_lib/', import.meta.url);
const orchestratorPath = require.resolve(new URL('contract-billing-orchestrator.js', LIB_DIR).pathname);

require.cache[orchestratorPath] = {
  id: orchestratorPath,
  filename: orchestratorPath,
  loaded: true,
  exports: {
    orchestrateContractBilling: async ({ contract }) => ({
      subscription: { id: 'sub_1' },
      setupInvoice: { id: `inv_setup_${contract.id}` },
      recurringInvoice: { id: `inv_recurring_${contract.id}` },
      setup_fee_invoice_created: true,
      recurring_invoice_created: true,
      pdf: { setup_fee: null, month_1: null, errors: [] }
    })
  }
};

const { acceptOfferAndEnsureContract, OfferAcceptanceError } = require(
  new URL('offer-acceptance.js', LIB_DIR).pathname
);

// ---- minimal in-memory fake Supabase query builder ----
function makeDb(opts = {}) {
  const tables = { offers: [], customers: [], contracts: [], cases: [], onboarding: [], invoices: [], subscriptions: [] };
  const state = { forceContractInsertError: Boolean(opts.forceContractInsertError) };

  function matches(row, filters) {
    return filters.every((f) => {
      const v = row[f.col];
      if (f.type === 'eq') return String(v) === String(f.val);
      if (f.type === 'is') return f.val === null ? (v === null || v === undefined) : v === f.val;
      if (f.type === 'ilike') return String(v || '').toLowerCase() === String(f.val || '').toLowerCase();
      return true;
    });
  }

  class Builder {
    constructor(table) {
      this.table = table;
      this.mode = null;
      this.filters = [];
      this.orRaw = null;
      this.payload = null;
      this.orderCol = null;
      this.orderDesc = false;
      this.limitN = null;
      this.terminal = null;
    }
    select() { if (!this.mode) this.mode = 'select'; return this; }
    eq(col, val) { this.filters.push({ type: 'eq', col, val }); return this; }
    is(col, val) { this.filters.push({ type: 'is', col, val }); return this; }
    ilike(col, val) { this.filters.push({ type: 'ilike', col, val }); return this; }
    or(raw) { this.orRaw = raw; return this; }
    order(col, opts2) { this.orderCol = col; this.orderDesc = !(opts2 && opts2.ascending); return this; }
    limit(n) { this.limitN = n; return this; }
    insert(payload) { this.mode = 'insert'; this.payload = payload; return this; }
    update(payload) { this.mode = 'update'; this.payload = payload; return this; }
    single() { this.terminal = 'single'; return this._run(); }
    maybeSingle() { this.terminal = 'maybeSingle'; return this._run(); }
    then(resolve, reject) { this._run().then(resolve, reject); }

    async _run() {
      const rows = tables[this.table];
      if (this.mode === 'insert') {
        if (this.table === 'contracts' && state.forceContractInsertError) {
          return { data: null, error: { message: 'simulated contract insert failure', code: 'SIMULATED' } };
        }
        const row = { ...this.payload, id: this.payload.id || `${this.table}-${rows.length + 1}` };
        rows.push(row);
        return this._project([row]);
      }
      let matched = rows.filter((r) => matches(r, this.filters));
      if (this.orRaw && this.table === 'cases') {
        const keyMatch = /%([^%]+)%/.exec(this.orRaw);
        const key = keyMatch ? keyMatch[1] : null;
        matched = matched.filter((r) => key && ((r.note || '').includes(key) || (r.notes || '').includes(key)));
      }
      if (this.mode === 'update') {
        matched.forEach((r) => Object.assign(r, this.payload));
        if (this.limitN) matched = matched.slice(0, this.limitN);
        return this._project(matched);
      }
      if (this.orderCol) {
        matched = [...matched].sort((a, b) => (a[this.orderCol] > b[this.orderCol] ? -1 : 1) * (this.orderDesc ? 1 : -1));
      }
      if (this.limitN) matched = matched.slice(0, this.limitN);
      return this._project(matched);
    }

    _project(rowsOut) {
      if (this.terminal === 'single') {
        if (rowsOut.length !== 1) return { data: null, error: { message: `expected 1 row, got ${rowsOut.length}`, code: rowsOut.length === 0 ? 'PGRST116' : 'MULTI' } };
        return { data: { ...rowsOut[0] }, error: null };
      }
      if (this.terminal === 'maybeSingle') {
        if (rowsOut.length > 1) return { data: null, error: { message: 'multiple rows', code: 'MULTI' } };
        return { data: rowsOut[0] ? { ...rowsOut[0] } : null, error: null };
      }
      return { data: rowsOut.map((r) => ({ ...r })), error: null };
    }
  }

  return { tables, state, from(table) { return new Builder(table); } };
}

function baseOffer(overrides) {
  return {
    id: 'offer-1', offer_number: 'OFF-2026-000001', status: 'sent', customer_id: 'cust-1', contract_id: null,
    plan: 'professional', billing_cycle: 'monthly', duration_months: 12, company_name: 'Test GmbH',
    street: 'Teststrasse 1', zip: '8000', city: 'Zürich', country: 'Schweiz',
    accepted_at: null, accept_claim_key: null, ...overrides
  };
}
function baseCustomer(overrides) {
  return { id: 'cust-1', customer_name: 'Test GmbH', status: 'onboarding', email: 'test@example.com', ...overrides };
}

async function run() {
  // 1) success path
  {
    const db = makeDb();
    db.tables.offers.push(baseOffer({}));
    db.tables.customers.push(baseCustomer({}));
    const nowIso = new Date('2026-08-06T10:00:00.000Z').toISOString();
    const result = await acceptOfferAndEnsureContract({
      sbAdmin: db, offer: db.tables.offers[0], nowIso, allowContractFailure: true, idempotencyKey: 'key-success'
    });
    assert.equal(result.duplicate, false);
    assert.ok(result.contractId);
    assert.equal(result.contractError, null);
    const offerRow = db.tables.offers.find((o) => o.id === 'offer-1');
    assert.equal(offerRow.status, 'accepted');
    assert.equal(offerRow.accept_claim_key, null);
    assert.equal(db.tables.contracts.length, 1);
    assert.equal(db.tables.cases.length, 1);
  }

  // 2) contract creation fails, allowContractFailure=true -> contract_failed, not final, ops case created
  {
    const db = makeDb({ forceContractInsertError: true });
    db.tables.offers.push(baseOffer({ id: 'offer-2', customer_id: 'cust-2' }));
    db.tables.customers.push(baseCustomer({ id: 'cust-2' }));
    const nowIso = new Date('2026-08-06T10:05:00.000Z').toISOString();
    const result = await acceptOfferAndEnsureContract({
      sbAdmin: db, offer: db.tables.offers[0], nowIso, allowContractFailure: true, idempotencyKey: 'key-fail-1'
    });
    assert.equal(result.contractId, null);
    assert.ok(result.contractError);
    assert.equal(result.contractPending, true);
    const offerRow = db.tables.offers.find((o) => o.id === 'offer-2');
    assert.equal(offerRow.status, 'contract_failed');
    assert.ok(offerRow.accepted_at);
    assert.equal(offerRow.accept_claim_key, null);
    const failureCase = db.tables.cases.find((c) => (c.note || '').includes('ops_contract_review_failed:offer-2'));
    assert.ok(failureCase);
    assert.equal(failureCase.priority, 'high');
  }

  // 2b) retry after contract_failed self-heals, no duplicate contract
  {
    const db = makeDb();
    const offer = baseOffer({ id: 'offer-2b', customer_id: 'cust-2b', status: 'contract_failed', accepted_at: '2026-08-06T10:05:00.000Z' });
    db.tables.offers.push(offer);
    db.tables.customers.push(baseCustomer({ id: 'cust-2b' }));
    const nowIso = new Date('2026-08-06T10:10:00.000Z').toISOString();
    const result = await acceptOfferAndEnsureContract({
      sbAdmin: db, offer: db.tables.offers[0], nowIso, allowContractFailure: true, idempotencyKey: 'key-retry-1'
    });
    assert.equal(result.duplicate, false);
    assert.ok(result.contractId);
    const offerRow = db.tables.offers.find((o) => o.id === 'offer-2b');
    assert.equal(offerRow.status, 'accepted');
    assert.equal(db.tables.contracts.length, 1);
  }

  // 3) admin path (allowContractFailure=false) still throws, but visibility is persisted first
  {
    const db = makeDb({ forceContractInsertError: true });
    db.tables.offers.push(baseOffer({ id: 'offer-3', customer_id: 'cust-3' }));
    db.tables.customers.push(baseCustomer({ id: 'cust-3' }));
    const nowIso = new Date('2026-08-06T10:15:00.000Z').toISOString();
    let threw = null;
    try {
      await acceptOfferAndEnsureContract({ sbAdmin: db, offer: db.tables.offers[0], nowIso, idempotencyKey: 'offer_admin_accept:offer-3' });
    } catch (err) { threw = err; }
    assert.ok(threw instanceof OfferAcceptanceError);
    const offerRow = db.tables.offers.find((o) => o.id === 'offer-3');
    assert.equal(offerRow.status, 'contract_failed');
    const failureCase = db.tables.cases.find((c) => (c.note || '').includes('ops_contract_review_failed:offer-3'));
    assert.ok(failureCase);
  }

  // 4) foreign in-flight claim blocks a concurrent request (true CAS contention)
  {
    const db = makeDb();
    db.tables.offers.push(baseOffer({ id: 'offer-4', customer_id: 'cust-4' }));
    db.tables.customers.push(baseCustomer({ id: 'cust-4' }));
    const staleSnapshot = { ...db.tables.offers[0] };
    db.tables.offers[0].accept_claim_key = 'someone-elses-key';
    const nowIso = new Date('2026-08-06T10:20:00.000Z').toISOString();
    let threw = null;
    try {
      await acceptOfferAndEnsureContract({ sbAdmin: db, offer: staleSnapshot, nowIso, allowContractFailure: true, idempotencyKey: 'my-key' });
    } catch (err) { threw = err; }
    assert.ok(threw instanceof OfferAcceptanceError);
    assert.equal(threw.statusCode, 409);
    assert.equal(threw.details.reason, 'claim_conflict');
    assert.equal(db.tables.contracts.length, 0);
  }

  // 5) same idempotency key retried re-enters and completes
  {
    const db = makeDb();
    db.tables.offers.push(baseOffer({ id: 'offer-5', customer_id: 'cust-5', accept_claim_key: 'retry-key' }));
    db.tables.customers.push(baseCustomer({ id: 'cust-5' }));
    const nowIso = new Date('2026-08-06T10:25:00.000Z').toISOString();
    const result = await acceptOfferAndEnsureContract({
      sbAdmin: db, offer: db.tables.offers[0], nowIso, allowContractFailure: true, idempotencyKey: 'retry-key'
    });
    assert.equal(result.contractError, null);
    assert.ok(result.contractId);
  }

  // 6) double-accept end to end never creates a second contract
  {
    const db = makeDb();
    db.tables.offers.push(baseOffer({ id: 'offer-6', customer_id: 'cust-6' }));
    db.tables.customers.push(baseCustomer({ id: 'cust-6' }));
    const nowIso = new Date('2026-08-06T10:30:00.000Z').toISOString();
    const first = await acceptOfferAndEnsureContract({ sbAdmin: db, offer: db.tables.offers[0], nowIso, allowContractFailure: true, idempotencyKey: 'dbl-key' });
    const offerAfterFirst = db.tables.offers.find((o) => o.id === 'offer-6');
    const second = await acceptOfferAndEnsureContract({ sbAdmin: db, offer: offerAfterFirst, nowIso, allowContractFailure: true, idempotencyKey: 'dbl-key-2' });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.contractId, first.contractId);
    assert.equal(db.tables.contracts.length, 1);
  }

  console.log('✅ offer-acceptance idempotency verification passed (claim lock, contract_failed retry status, ops-case visibility, no duplicate contracts).');
}

run().catch((err) => {
  console.error('❌ offer-acceptance idempotency verification failed:', err?.stack || err?.message || err);
  process.exit(1);
});
