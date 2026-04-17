'use strict';

const { orchestrateContractBilling } = require('./contract-billing-orchestrator');

const CONTRACT_TRANSITIONS = Object.freeze({
  draft: new Set(['signed', 'cancelled']),
  pending: new Set(['signed', 'active', 'cancelled']),
  signed: new Set(['active', 'suspended', 'cancelled']),
  active: new Set(['suspended', 'cancelled']),
  suspended: new Set(['active', 'cancelled']),
  cancelled: new Set([])
});

function normalizeContractStatus(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return 'pending';
  if (v === 'paused') return 'suspended';
  return v;
}

function assertContractTransition(from, to) {
  const source = normalizeContractStatus(from);
  const target = normalizeContractStatus(to);
  if (source === target) return;
  const allowed = CONTRACT_TRANSITIONS[source] || new Set();
  if (!allowed.has(target)) {
    throw new Error(`Illegal contract transition: '${source}' -> '${target}'`);
  }
}

async function writeCommercialAudit(sbAdmin, payload) {
  const row = {
    actor_admin_id: payload?.actor?.userId || null,
    actor_role: payload?.actor?.role || null,
    action: payload?.action || null,
    customer_id: payload?.customerId || null,
    contract_id: payload?.contractId || null,
    subscription_id: payload?.subscriptionId || null,
    invoice_id: payload?.invoiceId || null,
    previous_state: payload?.previousState || null,
    next_state: payload?.nextState || null,
    metadata: payload?.metadata || null,
    happened_at: new Date().toISOString()
  };

  const { error } = await sbAdmin.from('commercial_lifecycle_audit').insert(row);
  if (error) {
    console.warn('[commercial_orchestrator] audit insert failed', error.message || error);
  }
}

async function getContractById(sbAdmin, contractId) {
  const { data, error } = await sbAdmin.from('contracts').select('*').eq('id', contractId).maybeSingle();
  if (error) throw new Error(`Contract lookup failed: ${error.message}`);
  return data || null;
}

async function getCustomerById(sbAdmin, customerId) {
  const { data, error } = await sbAdmin.from('customers').select('*').eq('id', customerId).maybeSingle();
  if (error) throw new Error(`Customer lookup failed: ${error.message}`);
  return data || null;
}

async function getSubscriptionByCustomerId(sbAdmin, customerId) {
  const { data, error } = await sbAdmin.from('subscriptions').select('*').eq('customer_id', customerId).maybeSingle();
  if (error) throw new Error(`Subscription lookup failed: ${error.message}`);
  return data || null;
}

function commercialReadModel({ contract, customer, subscription, invoices = [] }) {
  return {
    contract: contract || null,
    customer: customer || null,
    subscription: subscription || null,
    billing: {
      invoice_open_count: (invoices || []).filter((inv) => !['paid', 'cancelled', 'void'].includes(String(inv?.status || '').toLowerCase())).length,
      latest_invoice_id: invoices?.[0]?.id || null,
      latest_invoice_status: invoices?.[0]?.status || null
    },
    last_mutation_at: new Date().toISOString()
  };
}

async function loadInvoicesForContract(sbAdmin, contractId) {
  if (!contractId) return [];
  const { data } = await sbAdmin
    .from('invoices')
    .select('*')
    .eq('contract_id', contractId)
    .order('created_at', { ascending: false })
    .limit(10);
  return Array.isArray(data) ? data : [];
}

async function executeCommercialCommand({ sbAdmin, actor, command, payload = {} }) {
  const nowIso = new Date().toISOString();

  if (command === 'contracts.create') {
    const insertPayload = { ...payload, updated_at: nowIso, created_at: payload.created_at || nowIso };
    const { data: created, error } = await sbAdmin.from('contracts').insert(insertPayload).select('*').single();
    if (error) throw new Error(error.message || 'Contract create failed');

    const customer = await getCustomerById(sbAdmin, created.customer_id);
    const subscription = created.customer_id ? await getSubscriptionByCustomerId(sbAdmin, created.customer_id) : null;
    const invoices = await loadInvoicesForContract(sbAdmin, created.id);
    const readModel = commercialReadModel({ contract: created, customer, subscription, invoices });

    await writeCommercialAudit(sbAdmin, {
      actor,
      action: command,
      customerId: created.customer_id || null,
      contractId: created.id,
      previousState: null,
      nextState: readModel,
      metadata: { source: 'admin-mutate' }
    });

    return { contract: created, read_model: readModel };
  }

  if (command === 'contracts.update') {
    const contractId = String(payload.contract_id || payload.id || '').trim();
    if (!contractId) throw new Error('contract_id ist erforderlich.');
    const patch = { ...(payload.patch || payload.payload || {}) };
    const previous = await getContractById(sbAdmin, contractId);
    if (!previous) throw new Error('Contract nicht gefunden.');

    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      assertContractTransition(previous.status, patch.status);
    }

    patch.updated_at = nowIso;
    const { data: updated, error } = await sbAdmin.from('contracts').update(patch).eq('id', contractId).select('*').single();
    if (error) throw new Error(error.message || 'Contract update failed');

    const customer = await getCustomerById(sbAdmin, updated.customer_id);
    const subscription = updated.customer_id ? await getSubscriptionByCustomerId(sbAdmin, updated.customer_id) : null;
    const invoices = await loadInvoicesForContract(sbAdmin, updated.id);
    const readModel = commercialReadModel({ contract: updated, customer, subscription, invoices });

    await writeCommercialAudit(sbAdmin, {
      actor,
      action: command,
      customerId: updated.customer_id || null,
      contractId: updated.id,
      subscriptionId: subscription?.id || null,
      previousState: { contract: previous },
      nextState: readModel,
      metadata: { source: 'admin-mutate' }
    });

    return { contract: updated, read_model: readModel };
  }

  if (command === 'contracts.activate') {
    const contractId = String(payload.contract_id || '').trim();
    if (!contractId) throw new Error('contract_id fehlt.');
    const startDate = String(payload.start_date || '').trim();
    const durationMonths = Math.max(1, Math.trunc(Number(payload.term_months || payload.duration_months || 0) || 0));
    const endDate = String(payload.end_date || '').trim();

    const previous = await getContractById(sbAdmin, contractId);
    if (!previous) throw new Error('Contract nicht gefunden.');
    assertContractTransition(previous.status, 'active');

    const patch = {
      status: 'active',
      start_date: startDate,
      duration_months: durationMonths,
      months: durationMonths,
      end_date: endDate,
      updated_at: nowIso,
      notes: String(payload.notes || previous.notes || '').trim() || null
    };
    const { data: updated, error } = await sbAdmin.from('contracts').update(patch).eq('id', contractId).select('*').single();
    if (error) throw new Error(`Contract update failed: ${error.message}`);

    const customer = await getCustomerById(sbAdmin, updated.customer_id);
    if (!customer) throw new Error('Customer nicht gefunden.');

    const billing = await orchestrateContractBilling({
      sbAdmin,
      customer,
      contract: updated,
      nowIso,
      startDate,
      forceActiveSubscription: true
    });

    const subscription = billing?.subscription || await getSubscriptionByCustomerId(sbAdmin, updated.customer_id);
    const invoices = await loadInvoicesForContract(sbAdmin, updated.id);
    const readModel = commercialReadModel({ contract: updated, customer, subscription, invoices });

    await writeCommercialAudit(sbAdmin, {
      actor,
      action: command,
      customerId: updated.customer_id || null,
      contractId: updated.id,
      subscriptionId: subscription?.id || null,
      previousState: { contract: previous },
      nextState: readModel,
      metadata: {
        setup_fee_invoice_id: billing?.setupInvoice?.id || null,
        recurring_invoice_id: billing?.recurringInvoice?.id || null
      }
    });

    return {
      contract: updated,
      subscription,
      setup_fee_invoice: billing?.setupInvoice || null,
      recurring_invoice: billing?.recurringInvoice || null,
      setup_fee_invoice_created: Boolean(billing?.setup_fee_invoice_created),
      recurring_invoice_created: Boolean(billing?.recurring_invoice_created),
      pdfs_generated: (billing?.pdf?.errors || []).length === 0,
      pdf_generation_errors: billing?.pdf?.errors || [],
      read_model: readModel
    };
  }

  if (command === 'contracts.cancel' || command === 'contracts.suspend' || command === 'contracts.resume' || command === 'contracts.changePlan') {
    const contractId = String(payload.contract_id || '').trim();
    if (!contractId) throw new Error('contract_id ist erforderlich.');
    const previous = await getContractById(sbAdmin, contractId);
    if (!previous) throw new Error('Contract nicht gefunden.');

    const patch = { updated_at: nowIso };
    if (command === 'contracts.cancel') patch.status = 'cancelled';
    if (command === 'contracts.suspend') patch.status = 'suspended';
    if (command === 'contracts.resume') patch.status = 'active';
    if (command === 'contracts.changePlan') {
      patch.plan = payload.plan;
      if (Object.prototype.hasOwnProperty.call(payload, 'recurring_amount_monthly')) patch.recurring_amount_monthly = payload.recurring_amount_monthly;
      if (Object.prototype.hasOwnProperty.call(payload, 'recurring_amount_yearly')) patch.recurring_amount_yearly = payload.recurring_amount_yearly;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) patch.notes = payload.notes;

    if (patch.status) assertContractTransition(previous.status, patch.status);

    const { data: updated, error } = await sbAdmin.from('contracts').update(patch).eq('id', contractId).select('*').single();
    if (error) throw new Error(error.message || 'Contract command failed');

    if (updated.customer_id) {
      if (command === 'contracts.suspend') {
        await sbAdmin.from('subscriptions').update({ subscription_status: 'paused', updated_at: nowIso }).eq('customer_id', updated.customer_id);
      }
      if (command === 'contracts.resume') {
        await sbAdmin.from('subscriptions').update({ subscription_status: 'active', updated_at: nowIso }).eq('customer_id', updated.customer_id);
      }
      if (command === 'contracts.cancel') {
        await sbAdmin.from('subscriptions').update({ subscription_status: 'cancelled', updated_at: nowIso }).eq('customer_id', updated.customer_id);
      }
    }

    const customer = await getCustomerById(sbAdmin, updated.customer_id);
    const subscription = updated.customer_id ? await getSubscriptionByCustomerId(sbAdmin, updated.customer_id) : null;
    const invoices = await loadInvoicesForContract(sbAdmin, updated.id);
    const readModel = commercialReadModel({ contract: updated, customer, subscription, invoices });

    await writeCommercialAudit(sbAdmin, {
      actor,
      action: command,
      customerId: updated.customer_id || null,
      contractId: updated.id,
      subscriptionId: subscription?.id || null,
      previousState: { contract: previous },
      nextState: readModel,
      metadata: { source: 'commercial-command' }
    });

    return { contract: updated, subscription, read_model: readModel };
  }

  throw new Error(`Unsupported commercial command: ${command}`);
}

module.exports = {
  executeCommercialCommand,
  normalizeContractStatus,
  assertContractTransition
};
