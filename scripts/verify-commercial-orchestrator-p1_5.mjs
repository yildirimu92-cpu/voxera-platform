#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executeCommercialCommand } from '../admin-panel/netlify/functions/_lib/commercial-orchestrator.js';

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this._op = 'select';
    this._patch = null;
    this._insertPayload = null;
    this._filters = [];
    this._order = null;
    this._limit = null;
  }
  select() { return this; }
  eq(col, val) { this._filters.push((row) => String(row?.[col]) === String(val)); return this; }
  order(col, { ascending = true } = {}) { this._order = { col, ascending }; return this; }
  limit(n) { this._limit = n; return this; }
  update(patch) { this._op = 'update'; this._patch = { ...patch }; return this; }
  insert(payload) { this._op = 'insert'; this._insertPayload = payload; return this; }
  maybeSingle() { return this._execSingle(true); }
  single() { return this._execSingle(false); }
  then(resolve, reject) { this._exec().then(resolve, reject); }

  _rows() {
    const base = this.db.tables[this.table] || [];
    return base.filter((row) => this._filters.every((f) => f(row)));
  }

  _clone(row) { return row ? JSON.parse(JSON.stringify(row)) : row; }

  async _execSingle(allowNull) {
    const res = await this._exec();
    if (res.error) return res;
    const list = Array.isArray(res.data) ? res.data : [];
    if (!list.length && allowNull) return { data: null, error: null };
    if (!list.length && !allowNull) return { data: null, error: { message: 'No rows' } };
    return { data: list[0], error: null };
  }

  async _exec() {
    if (this._op === 'insert') {
      if (this.table === 'commercial_lifecycle_audit' && this.db.failAuditInsert) {
        return { data: null, error: { message: 'simulated audit insert failure' } };
      }
      const payloads = Array.isArray(this._insertPayload) ? this._insertPayload : [this._insertPayload];
      const inserted = payloads.map((raw) => {
        const row = { ...raw };
        if (!row.id) row.id = `${this.table}-${++this.db.ids[this.table]}`;
        this.db.tables[this.table].push(this._clone(row));
        return this._clone(row);
      });
      return { data: inserted, error: null };
    }

    if (this._op === 'update') {
      const rows = this._rows();
      for (const row of rows) Object.assign(row, this._patch);
      return { data: rows.map((r) => this._clone(r)), error: null };
    }

    let rows = this._rows().map((r) => this._clone(r));
    if (this._order) {
      const { col, ascending } = this._order;
      rows.sort((a, b) => {
        const av = a?.[col];
        const bv = b?.[col];
        if (av === bv) return 0;
        return ascending ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
      });
    }
    if (Number.isFinite(this._limit)) rows = rows.slice(0, this._limit);
    return { data: rows, error: null };
  }
}

class FakeSupabaseAdmin {
  constructor(seed = {}) {
    this.failAuditInsert = false;
    this.ids = { contracts: 100, subscriptions: 100, customers: 100, invoices: 100, commercial_lifecycle_audit: 100, plan_config: 100 };
    this.tables = {
      contracts: seed.contracts || [],
      subscriptions: seed.subscriptions || [],
      customers: seed.customers || [],
      invoices: seed.invoices || [],
      commercial_lifecycle_audit: seed.commercial_lifecycle_audit || [],
      plan_config: seed.plan_config || [
        { id: 'starter', name: 'Starter' },
        { id: 'business', name: 'Business' },
        { id: 'professional', name: 'Professional' }
      ]
    };
  }
  from(table) {
    if (!this.tables[table]) this.tables[table] = [];
    if (!(table in this.ids)) this.ids[table] = 0;
    return new Query(this, table);
  }
}

function makeSeed() {
  return {
    customers: [{ id: 'cust-1', customer_name: 'Pilot Corp', plan: 'professional', status: 'pending' }],
    subscriptions: [{ id: 'sub-1', customer_id: 'cust-1', subscription_status: 'inactive', plan: 'professional', updated_at: '2026-04-01T00:00:00.000Z' }],
    contracts: [{ id: 'ct-seed', customer_id: 'cust-1', status: 'pending', plan: 'professional', updated_at: '2026-04-01T00:00:00.000Z' }],
    invoices: [{ id: 'inv-1', contract_id: 'ct-seed', status: 'open', created_at: '2026-04-02T00:00:00.000Z' }]
  };
}

async function run() {
  const actor = { userId: 'admin-1', role: 'owner' };

  // 1) Contract create + reload consistency.
  const createDb = new FakeSupabaseAdmin(makeSeed());
  const created = await executeCommercialCommand({
    sbAdmin: createDb,
    actor,
    command: 'contracts.create',
    payload: { customer_id: 'cust-1', status: 'pending', plan: 'business', notes: 'Created via admin ui' }
  });
  assert.equal(created.contract.customer_id, 'cust-1');
  const reloadFromSameSession = await createDb.from('contracts').select('*').eq('id', created.contract.id).maybeSingle();
  const secondSession = new FakeSupabaseAdmin({ ...createDb.tables });
  const reloadFromSecondSession = await secondSession.from('contracts').select('*').eq('id', created.contract.id).maybeSingle();
  assert.equal(reloadFromSameSession.data?.id, created.contract.id);
  assert.equal(reloadFromSecondSession.data?.id, created.contract.id);

  // 2) Activate/start confirm path + idempotency guard.
  const activateDb = new FakeSupabaseAdmin(makeSeed());
  const fakeBilling = async ({ customer, contract }) => ({
    subscription: { id: 'sub-1', customer_id: customer.id, subscription_status: 'active', plan: contract.plan },
    setupInvoice: { id: 'inv-setup' },
    recurringInvoice: { id: 'inv-recurring' },
    setup_fee_invoice_created: true,
    recurring_invoice_created: true,
    pdf: { errors: [] }
  });
  const activated = await executeCommercialCommand({
    sbAdmin: activateDb,
    actor,
    command: 'contracts.activate',
    payload: { contract_id: 'ct-seed', start_date: '2026-05-01', term_months: 12, end_date: '2027-05-01' },
    billingOrchestrator: fakeBilling
  });
  assert.equal(activated.contract.status, 'active');
  await assert.rejects(() => executeCommercialCommand({
    sbAdmin: activateDb,
    actor,
    command: 'contracts.activate',
    payload: { contract_id: 'ct-seed', start_date: '2026-05-01', term_months: 12, end_date: '2027-05-01' },
    billingOrchestrator: fakeBilling
  }), /bereits aktiv|bereits im Status|Illegal contract transition/);

  // 3) Plan change + invalid plan guard.
  const planDb = new FakeSupabaseAdmin(makeSeed());
  const changedPlan = await executeCommercialCommand({
    sbAdmin: planDb,
    actor,
    command: 'contracts.changePlan',
    payload: { contract_id: 'ct-seed', plan: 'starter' }
  });
  assert.equal(changedPlan.contract.plan, 'starter');
  await assert.rejects(() => executeCommercialCommand({
    sbAdmin: planDb,
    actor,
    command: 'contracts.changePlan',
    payload: { contract_id: 'ct-seed', plan: 'invalid-enterprise-ultra' }
  }), /Ungültiger Zielplan/);

  // 4) Suspend/resume deterministic transitions + negative guards.
  const suspendDb = new FakeSupabaseAdmin(makeSeed());
  await executeCommercialCommand({ sbAdmin: suspendDb, actor, command: 'contracts.activate', payload: { contract_id: 'ct-seed', start_date: '2026-05-01', term_months: 12, end_date: '2027-05-01' }, billingOrchestrator: fakeBilling });
  const suspended = await executeCommercialCommand({ sbAdmin: suspendDb, actor, command: 'contracts.suspend', payload: { contract_id: 'ct-seed', notes: 'Ops hold' } });
  assert.equal(suspended.contract.status, 'suspended');
  const resumed = await executeCommercialCommand({ sbAdmin: suspendDb, actor, command: 'contracts.resume', payload: { contract_id: 'ct-seed' } });
  assert.equal(resumed.contract.status, 'active');
  await assert.rejects(() => executeCommercialCommand({ sbAdmin: suspendDb, actor, command: 'contracts.resume', payload: { contract_id: 'ct-seed' } }), /bereits aktiv|bereits im Status|Illegal contract transition/);

  // 5) Cancel + invalid repeated cancel blocked.
  const cancelDb = new FakeSupabaseAdmin(makeSeed());
  const cancelled = await executeCommercialCommand({ sbAdmin: cancelDb, actor, command: 'contracts.cancel', payload: { contract_id: 'ct-seed', notes: 'Customer requested' } });
  assert.equal(cancelled.contract.status, 'cancelled');
  await assert.rejects(() => executeCommercialCommand({ sbAdmin: cancelDb, actor, command: 'contracts.cancel', payload: { contract_id: 'ct-seed' } }), /bereits aktiv|bereits im Status|Illegal contract transition/);

  // 6) Signature save via contracts.update.
  const signatureDb = new FakeSupabaseAdmin(makeSeed());
  const signature = await executeCommercialCommand({
    sbAdmin: signatureDb,
    actor,
    command: 'contracts.update',
    payload: { contract_id: 'ct-seed', payload: { signature_data: 'data:image/png;base64,AAA', status: 'signed' } }
  });
  assert.equal(signature.contract.status, 'signed');
  assert.ok(String(signature.contract.signature_data || '').startsWith('data:image/png;base64,'));

  // 7) malformed payload / required-field errors.
  await assert.rejects(() => executeCommercialCommand({ sbAdmin: signatureDb, actor, command: 'contracts.update', payload: { payload: { status: 'signed' } } }), /contract_id ist erforderlich/);

  // 8) Audit coverage + best-effort behavior if audit fails.
  const auditDb = new FakeSupabaseAdmin(makeSeed());
  await executeCommercialCommand({ sbAdmin: auditDb, actor, command: 'contracts.create', payload: { customer_id: 'cust-1', status: 'pending', plan: 'professional' } });
  await executeCommercialCommand({ sbAdmin: auditDb, actor, command: 'contracts.update', payload: { contract_id: 'ct-seed', payload: { notes: 'Touched' } } });
  await executeCommercialCommand({ sbAdmin: auditDb, actor, command: 'contracts.cancel', payload: { contract_id: 'ct-seed' } });
  const auditActions = auditDb.tables.commercial_lifecycle_audit.map((row) => row.action);
  assert.ok(auditActions.includes('contracts.create'));
  assert.ok(auditActions.includes('contracts.update'));
  assert.ok(auditActions.includes('contracts.cancel'));
  const auditRow = auditDb.tables.commercial_lifecycle_audit[0];
  assert.equal(auditRow.actor_admin_id, actor.userId);
  assert.ok(auditRow.happened_at);
  assert.ok(Object.prototype.hasOwnProperty.call(auditRow, 'previous_state'));
  assert.ok(Object.prototype.hasOwnProperty.call(auditRow, 'next_state'));

  const auditFailureDb = new FakeSupabaseAdmin(makeSeed());
  auditFailureDb.failAuditInsert = true;
  const stillMutates = await executeCommercialCommand({ sbAdmin: auditFailureDb, actor, command: 'contracts.cancel', payload: { contract_id: 'ct-seed' } });
  assert.equal(stillMutates.contract.status, 'cancelled');
  assert.equal(auditFailureDb.tables.commercial_lifecycle_audit.length, 0);

  // 9) verify UI and server command routing are centralized.
  const indexHtml = readFileSync(new URL('../admin-panel/index.html', import.meta.url), 'utf8');
  assert.ok(indexHtml.includes("action:'contracts.create'"));
  assert.ok(indexHtml.includes("callAdminFunction('contract-start-confirm'"));
  assert.ok(indexHtml.includes("action:'contracts.cancel'"));

  const mutateSource = readFileSync(new URL('../admin-panel/netlify/functions/admin-mutate.js', import.meta.url), 'utf8');
  assert.match(mutateSource, /executeCommercialCommand\(/);
  assert.match(mutateSource, /\['contracts\.activate', 'contracts\.changePlan', 'contracts\.suspend', 'contracts\.resume', 'contracts\.cancel'\]/);

  console.log('✅ P1.5 commercial orchestrator verification passed (scripted integration).');
}

run().catch((err) => {
  console.error('❌ P1.5 commercial orchestrator verification failed:', err?.stack || err?.message || err);
  process.exit(1);
});
