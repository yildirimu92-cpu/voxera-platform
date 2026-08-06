#!/usr/bin/env node
// Verifies the contract-activation countersign gate fix:
//  - a contract that was never countersigned (countersigned_at not set) cannot be
//    activated via activateContractSafely, even though its status is in
//    ACTIVATABLE_STATUSES (pending/pending_review/signed)
//  - a countersigned contract still activates normally
//  - re-activating an already-active contract ("recovery") is not blocked by the
//    new gate, so existing/legacy active contracts without a captured
//    countersignature keep working
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LIB_DIR = new URL('../admin-panel/netlify/functions/_lib/', import.meta.url);

// Stub the heavy billing/payment-context dependencies so this test targets only
// the countersign precondition added to contract-activation-service.js, not the
// full billing orchestration pipeline (covered elsewhere).
const orchestratorPath = require.resolve(new URL('contract-billing-orchestrator.js', LIB_DIR).pathname);
require.cache[orchestratorPath] = {
  id: orchestratorPath,
  filename: orchestratorPath,
  loaded: true,
  exports: {
    orchestrateContractBilling: async ({ contract }) => ({
      subscription: { id: `sub_${contract.id}` },
      setupInvoice: null,
      recurringInvoice: null,
      setup_fee_invoice_created: false,
      recurring_invoice_created: false,
      pdf: { errors: [] }
    })
  }
};
const paymentContextPath = require.resolve(new URL('invoice-payment-context.js', LIB_DIR).pathname);
require.cache[paymentContextPath] = {
  id: paymentContextPath,
  filename: paymentContextPath,
  loaded: true,
  exports: {
    applyContractInvoicesPaymentContext: async () => ({ setup_fee: null, recurring: null })
  }
};

const { activateContractSafely } = require(new URL('contract-activation-service.js', LIB_DIR).pathname);

// ---- minimal in-memory fake Supabase query builder (subset needed here) ----
function makeDb() {
  const tables = { contracts: [], customers: [], invoices: [], commercial_lifecycle_audit: [] };

  function matches(row, filters) {
    return filters.every((f) => String(row[f.col]) === String(f.val));
  }

  class Builder {
    constructor(table) {
      this.table = table;
      this.mode = null;
      this.filters = [];
      this.payload = null;
      this.orderCol = null;
      this.orderDesc = false;
      this.limitN = null;
      this.terminal = null;
    }
    select() { if (!this.mode) this.mode = 'select'; return this; }
    eq(col, val) { this.filters.push({ col, val }); return this; }
    insert(payload) { this.mode = 'insert'; this.payload = payload; return this; }
    update(payload) { this.mode = 'update'; this.payload = payload; return this; }
    order(col, opts) { this.orderCol = col; this.orderDesc = !(opts && opts.ascending); return this; }
    limit(n) { this.limitN = n; return this; }
    single() { this.terminal = 'single'; return this._run(); }
    maybeSingle() { this.terminal = 'maybeSingle'; return this._run(); }
    then(resolve, reject) { this._run().then(resolve, reject); }

    async _run() {
      const rows = tables[this.table];
      if (this.mode === 'insert') {
        const row = { ...this.payload, id: this.payload.id || `${this.table}-${rows.length + 1}` };
        rows.push(row);
        return this._project([row]);
      }
      let matched = rows.filter((r) => matches(r, this.filters));
      if (this.mode === 'update') {
        matched.forEach((r) => Object.assign(r, this.payload));
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

  return { tables, from(table) { return new Builder(table); } };
}

function baseContract(overrides) {
  return {
    id: 'contract-1', customer_id: 'cust-1', status: 'pending_review',
    countersigned_at: null, notes: null, ...overrides
  };
}
function baseCustomer(overrides) {
  return { id: 'cust-1', customer_name: 'Test GmbH', email: 'test@example.com', ...overrides };
}

async function expectRejection(db, contractId, label) {
  let threw = null;
  try {
    await activateContractSafely({
      sbAdmin: db, actor: { userId: 'admin-1', role: 'admin' }, contractId,
      startDate: '2026-08-06', durationMonths: 12, endDate: '2027-08-06'
    });
  } catch (err) {
    threw = err;
  }
  assert.ok(threw, `${label}: expected activateContractSafely to throw`);
  assert.equal(threw.step_failed, 'validate_contract_countersigned', `${label}: unexpected step_failed "${threw.step_failed}"`);
  const row = db.tables.contracts.find((c) => c.id === contractId);
  assert.notEqual(row.status, 'active', `${label}: contract must not have been activated`);
}

async function run() {
  // 1) pending_review + never countersigned -> rejected before any billing/DB mutation
  {
    const db = makeDb();
    db.tables.contracts.push(baseContract({ id: 'contract-1', status: 'pending_review', countersigned_at: null }));
    db.tables.customers.push(baseCustomer({}));
    await expectRejection(db, 'contract-1', 'pending_review without countersign');
    assert.equal(db.tables.commercial_lifecycle_audit.length, 0, 'no audit row should be written on rejection');
  }

  // 2) signed + never countersigned -> rejected (signed is also in ACTIVATABLE_STATUSES)
  {
    const db = makeDb();
    db.tables.contracts.push(baseContract({ id: 'contract-2', status: 'signed', countersigned_at: null }));
    db.tables.customers.push(baseCustomer({ id: 'cust-1' }));
    await expectRejection(db, 'contract-2', 'signed without countersign');
  }

  // 3) pending_review + countersigned -> activates normally
  {
    const db = makeDb();
    db.tables.contracts.push(baseContract({ id: 'contract-3', status: 'pending_review', countersigned_at: '2026-08-05T10:00:00.000Z' }));
    db.tables.customers.push(baseCustomer({ id: 'cust-1' }));
    const result = await activateContractSafely({
      sbAdmin: db, actor: { userId: 'admin-1', role: 'admin' }, contractId: 'contract-3',
      startDate: '2026-08-06', durationMonths: 12, endDate: '2027-08-06'
    });
    assert.equal(result.contract.status, 'active');
    assert.equal(result.activation_recovery, false);
    const audit = db.tables.commercial_lifecycle_audit.find((a) => a.contract_id === 'contract-3');
    assert.ok(audit, 'countersigned activation should be audited');
    assert.equal(audit.action, 'contracts.activate');
  }

  // 4) already active (recovery) + never countersigned -> NOT blocked by the new gate
  //    (protects legacy contracts activated before this check existed)
  {
    const db = makeDb();
    db.tables.contracts.push(baseContract({ id: 'contract-4', status: 'active', countersigned_at: null }));
    db.tables.customers.push(baseCustomer({ id: 'cust-1' }));
    const result = await activateContractSafely({
      sbAdmin: db, actor: { userId: 'admin-1', role: 'admin' }, contractId: 'contract-4',
      startDate: '2026-08-06', durationMonths: 12, endDate: '2027-08-06'
    });
    assert.equal(result.contract.status, 'active');
    assert.equal(result.activation_recovery, true);
    const audit = db.tables.commercial_lifecycle_audit.find((a) => a.contract_id === 'contract-4');
    assert.ok(audit, 'recovery activation should still be audited');
    assert.equal(audit.action, 'contracts.activate.recover');
  }

  console.log('✅ contract-activation countersign-gate verification passed (blocks un-countersigned first activation, allows countersigned activation and legacy recovery).');
}

run().catch((err) => {
  console.error('❌ contract-activation countersign-gate verification failed:', err?.stack || err?.message || err);
  process.exit(1);
});
