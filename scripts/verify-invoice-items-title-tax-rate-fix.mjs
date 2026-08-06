#!/usr/bin/env node
// Verifies the invoice_items schema-drift fix:
//  - createSetupFeeInvoice / createInitialContractInvoice / ensureContractStartInvoices
//    (the exact path Vertragsstart-Bestätigen -> orchestrateContractBilling ->
//    ensureContractStartInvoices runs through) all insert invoice_items rows carrying a
//    non-empty `title` and, critically, never a null `description` -- production has
//    invoice_items.description NOT NULL (see 2026-08-06_invoice_items_title_tax_rate_drift_fix.sql),
//    which a `description: x || null` fallback would violate the moment a caller omits it.
//  - a fake sbAdmin rejects any invoice_items insert containing description === null or a
//    missing title key, the same way the real (fixed) production schema would reject the
//    pre-fix `|| null` fallback with a NOT NULL violation.
//
// The same `description: x || null` -> `description: x || ''` fix was also applied to the
// create_manual_invoice branch in customer-billing-update.js (a directly callable Netlify
// function action with no admin-panel UI button wired to it, so not reachable from here without
// mocking requireAdminCaller/createClient/env vars for one dead-from-UI branch). That one-line
// change was instead verified directly against real Postgres with the live NOT NULL constraint
// reproduced locally: an insert with description: null was rejected, description: '' succeeded.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LIB_DIR = new URL('../admin-panel/netlify/functions/_lib/', import.meta.url);
const { createSetupFeeInvoice, createInitialContractInvoice, ensureContractStartInvoices } = require(
  new URL('invoice-service.js', LIB_DIR).pathname
);

// ---- minimal in-memory fake Supabase query builder ----
// Mirrors invoice_items' real NOT NULL constraint on `description`: any insert with
// description === null (or the key entirely missing) is rejected, just like production.
function makeDb() {
  const tables = { invoices: [], invoice_items: [] };
  let seq = 0;

  function matches(row, filters) {
    return filters.every((f) => {
      if (f.op === 'in') return Array.isArray(f.val) && f.val.some((v) => String(row[f.col]) === String(v));
      return String(row[f.col]) === String(f.val);
    });
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
    eq(col, val) { this.filters.push({ col, val, op: 'eq' }); return this; }
    in(col, vals) { this.filters.push({ col, val: vals, op: 'in' }); return this; }
    insert(payload) { this.mode = 'insert'; this.payload = payload; return this; }
    order(col, opts) { this.orderCol = col; this.orderDesc = !(opts && opts.ascending); return this; }
    limit(n) { this.limitN = n; return this; }
    single() { this.terminal = 'single'; return this._run(); }
    maybeSingle() { this.terminal = 'maybeSingle'; return this._run(); }
    then(resolve, reject) { this._run().then(resolve, reject); }

    async _run() {
      const rows = tables[this.table];
      if (this.mode === 'insert') {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
        if (this.table === 'invoice_items') {
          for (const row of incoming) {
            if (row.description === null || row.description === undefined) {
              return { data: null, error: { message: `null value in column "description" of relation "invoice_items" violates not-null constraint`, code: '23502' } };
            }
            if (!('title' in row)) {
              return { data: null, error: { message: `Could not find the 'title' column of 'invoice_items' in the schema cache`, code: 'PGRST204' } };
            }
          }
        }
        const inserted = incoming.map((row) => ({ ...row, id: row.id || `${this.table}-${(seq += 1)}` }));
        rows.push(...inserted);
        return this._project(inserted);
      }
      let matched = rows.filter((r) => matches(r, this.filters));
      if (this.orderCol) {
        matched = [...matched].sort((a, b) => (a[this.orderCol] > b[this.orderCol] ? -1 : 1) * (this.orderDesc ? 1 : -1));
      }
      if (this.limitN) matched = matched.slice(0, this.limitN);
      return this._project(matched);
    }

    _project(rowsOut) {
      if (this.terminal === 'single') {
        if (rowsOut.length !== 1) return { data: null, error: { message: `expected 1 row, got ${rowsOut.length}` } };
        return { data: { ...rowsOut[0] }, error: null };
      }
      if (this.terminal === 'maybeSingle') {
        return { data: rowsOut[0] ? { ...rowsOut[0] } : null, error: null };
      }
      return { data: rowsOut.map((r) => ({ ...r })), error: null };
    }
  }

  return {
    tables,
    from(table) { return new Builder(table); },
    async rpc(name) {
      if (name === 'next_invoice_number_v1') return { data: `OFF-VERIFY-${(seq += 1)}`, error: null };
      return { data: null, error: { message: `unstubbed rpc ${name}` } };
    }
  };
}

function baseCustomer(overrides) {
  return { id: 'cust-1', customer_name: 'Test GmbH', email: 'test@example.com', ...overrides };
}
function baseContract(overrides) {
  return {
    id: 'contract-1', customer_id: 'cust-1', status: 'active', plan: 'professional',
    setup_fee_amount: 500, recurring_amount_monthly: 199, billing_cycle: 'monthly',
    offer_id: null, ...overrides
  };
}

function assertNoNullDescriptionOrMissingTitle(db) {
  for (const row of db.tables.invoice_items) {
    assert.notEqual(row.description, null, `invoice_items row ${row.id} has null description`);
    assert.ok('title' in row, `invoice_items row ${row.id} is missing the title key`);
  }
}

async function run() {
  // 1) createSetupFeeInvoice: title present, description non-null
  {
    const db = makeDb();
    await createSetupFeeInvoice({
      sbAdmin: db, customer: baseCustomer({}), contractId: 'contract-1', contract: baseContract({}),
      setupFeeAmount: 500, billingProvider: 'invoice', status: 'draft'
    });
    assert.equal(db.tables.invoice_items.length, 1);
    assertNoNullDescriptionOrMissingTitle(db);
    assert.equal(db.tables.invoice_items[0].title, 'Setup Fee');
    assert.ok(db.tables.invoice_items[0].description.length > 0);
  }

  // 2) createInitialContractInvoice: title present, description non-null
  {
    const db = makeDb();
    await createInitialContractInvoice({
      sbAdmin: db, customer: baseCustomer({ id: 'cust-2' }), contractId: 'contract-2',
      contract: baseContract({ id: 'contract-2', customer_id: 'cust-2' }), subscription: { id: 'sub-2' },
      dueAt: new Date().toISOString()
    });
    assert.equal(db.tables.invoice_items.length, 1);
    assertNoNullDescriptionOrMissingTitle(db);
  }

  // 3) ensureContractStartInvoices: the exact path Vertragsstart-Bestätigen runs through
  //    (activateContractSafely -> orchestrateContractBilling -> ensureContractStartInvoices).
  //    Must create both a setup-fee and a month-1 recurring invoice_items row, neither with a
  //    null description or a missing title.
  {
    const db = makeDb();
    const customer = baseCustomer({ id: 'cust-3' });
    const contract = baseContract({ id: 'contract-3', customer_id: 'cust-3' });
    const subscription = { id: 'sub-3', plan_code: 'professional', billing_cycle: 'monthly' };
    const result = await ensureContractStartInvoices({
      sbAdmin: db, customer, contract, subscription, startDate: '2026-08-06'
    });
    assert.equal(db.tables.invoice_items.length, 2, 'expected one setup-fee and one recurring line item');
    assertNoNullDescriptionOrMissingTitle(db);
    assert.ok(result.setupInvoice.verification.found);
    assert.ok(result.recurringInvoice.verification.found);
    const titles = db.tables.invoice_items.map((r) => r.title).sort();
    assert.deepEqual(titles, ['Setup Fee Voxera', 'Voxera Monatsabo [professional]']);
  }

  // 4) Sanity: the fake DB actually enforces the constraint it claims to (a raw insert with
  //    description omitted must be rejected the same way production now is) -- otherwise
  //    scenarios 1-3 would be passing for the wrong reason.
  {
    const db = makeDb();
    const invoice = (await db.from('invoices').insert({ id: 'inv-x' }).select('*').single()).data;
    const rejected = await db.from('invoice_items').insert({
      invoice_id: invoice.id, sort_order: 1, item_type: 'manual', title: 'X', quantity: 1, unit_price: 1, line_total: 1
    });
    assert.ok(rejected.error, 'expected the fake DB to reject an insert missing description, proving the harness is meaningful');
  }

  console.log('✅ invoice_items title/tax_rate drift-fix verification passed (no write path emits a null description or omits title).');
}

run().catch((err) => {
  console.error('❌ invoice_items title/tax_rate drift-fix verification failed:', err?.stack || err?.message || err);
  process.exit(1);
});
