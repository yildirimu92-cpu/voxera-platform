'use strict';

const { orchestrateContractBilling } = require('./contract-billing-orchestrator');

const ACTIVATABLE_STATUSES = new Set(['pending', 'pending_review', 'signed', 'active']);
const OPTIONAL_CONTRACT_COLUMNS = new Set(['end_date', 'updated_at', 'notes']);

function normalizeStatus(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'pending';
  if (value === 'pending_review') return 'pending_review';
  return value;
}

function extractMissingColumn(error) {
  if (!error || String(error.code || '') !== 'PGRST204') return null;
  const match = String(error.message || '').match(/Could not find the '([^']+)' column/i);
  return match?.[1] || null;
}

async function updateContractWithSchemaFallback({ sbAdmin, contractId, patch }) {
  const mutablePatch = { ...patch };
  const removedColumns = [];
  const maxAttempts = Object.keys(mutablePatch).length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await sbAdmin
      .from('contracts')
      .update(mutablePatch)
      .eq('id', contractId)
      .select('*')
      .single();

    if (!error) return { contract: data, removedColumns };

    const missingColumn = extractMissingColumn(error);
    if (!missingColumn || !OPTIONAL_CONTRACT_COLUMNS.has(missingColumn) || !(missingColumn in mutablePatch)) {
      const wrapped = new Error(`Contract update failed: ${error.message || 'unknown database error'}`);
      wrapped.step_failed = 'update_contract';
      wrapped.db_message = error.message || null;
      wrapped.db_code = error.code || null;
      wrapped.db_details = error.details || null;
      wrapped.db_hint = error.hint || null;
      throw wrapped;
    }

    delete mutablePatch[missingColumn];
    removedColumns.push(missingColumn);
  }

  const exhausted = new Error('Contract update failed: schema fallback exhausted.');
  exhausted.step_failed = 'update_contract';
  throw exhausted;
}

async function loadContract(sbAdmin, contractId) {
  const { data, error } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();
  if (error) {
    const wrapped = new Error(`Contract lookup failed: ${error.message}`);
    wrapped.step_failed = 'load_contract';
    wrapped.db_message = error.message || null;
    wrapped.db_code = error.code || null;
    throw wrapped;
  }
  return data || null;
}

async function loadCustomer(sbAdmin, customerId) {
  const { data, error } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (error) {
    const wrapped = new Error(`Customer lookup failed: ${error.message}`);
    wrapped.step_failed = 'load_customer';
    wrapped.db_message = error.message || null;
    wrapped.db_code = error.code || null;
    throw wrapped;
  }
  return data || null;
}

async function loadInvoices(sbAdmin, contractId) {
  const { data, error } = await sbAdmin
    .from('invoices')
    .select('*')
    .eq('contract_id', contractId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    console.warn('[contract_activation] invoice read model failed', error.message || error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function writeAudit(sbAdmin, payload) {
  const { error } = await sbAdmin.from('commercial_lifecycle_audit').insert({
    actor_admin_id: payload.actor?.userId || null,
    actor_role: payload.actor?.role || null,
    action: payload.recovery ? 'contracts.activate.recover' : 'contracts.activate',
    customer_id: payload.contract?.customer_id || null,
    contract_id: payload.contract?.id || null,
    subscription_id: payload.subscription?.id || null,
    previous_state: payload.previous ? { contract: payload.previous } : null,
    next_state: payload.readModel || null,
    metadata: {
      activation_recovery: Boolean(payload.recovery),
      removed_schema_columns: payload.removedColumns || [],
      setup_fee_invoice_id: payload.billing?.setupInvoice?.id || null,
      recurring_invoice_id: payload.billing?.recurringInvoice?.id || null
    },
    happened_at: new Date().toISOString()
  });
  if (error) console.warn('[contract_activation] audit insert failed', error.message || error);
}

function buildReadModel({ contract, customer, subscription, invoices }) {
  return {
    contract,
    customer,
    subscription,
    billing: {
      invoice_open_count: (invoices || []).filter((invoice) => !['paid', 'cancelled', 'void', 'credited'].includes(String(invoice?.status || '').toLowerCase())).length,
      latest_invoice_id: invoices?.[0]?.id || null,
      latest_invoice_status: invoices?.[0]?.status || null
    },
    last_mutation_at: new Date().toISOString()
  };
}

async function activateContractSafely({
  sbAdmin,
  actor,
  contractId,
  requestedCustomerId = null,
  startDate,
  durationMonths,
  endDate,
  notes = null,
  nowIso = new Date().toISOString(),
  billingOrchestrator = orchestrateContractBilling
}) {
  const previous = await loadContract(sbAdmin, contractId);
  if (!previous) {
    const error = new Error('Contract nicht gefunden.');
    error.step_failed = 'load_contract';
    throw error;
  }

  const status = normalizeStatus(previous.status);
  if (!ACTIVATABLE_STATUSES.has(status)) {
    const error = new Error(`Illegal contract transition: '${status}' -> 'active'`);
    error.step_failed = 'validate_contract_status';
    throw error;
  }

  const customerId = String(previous.customer_id || '').trim();
  if (!customerId) {
    const error = new Error('Contract hat keine customer_id.');
    error.step_failed = 'validate_contract_customer';
    throw error;
  }
  if (requestedCustomerId && String(requestedCustomerId) !== customerId) {
    const error = new Error('customer_id stimmt nicht mit dem Vertrag überein.');
    error.step_failed = 'validate_contract_customer';
    throw error;
  }

  const recovery = status === 'active';
  const patch = {
    status: 'active',
    start_date: startDate,
    duration_months: durationMonths,
    end_date: endDate,
    updated_at: nowIso,
    notes: String(notes || previous.notes || '').trim() || null
  };

  // `months` is a legacy read alias, not a canonical database column.
  // Keeping it out of the mutation prevents PGRST204 schema failures.
  const updatedResult = await updateContractWithSchemaFallback({
    sbAdmin,
    contractId,
    patch
  });
  const updated = updatedResult.contract;

  const customer = await loadCustomer(sbAdmin, customerId);
  if (!customer) {
    const error = new Error('Customer nicht gefunden.');
    error.step_failed = 'load_customer';
    throw error;
  }

  const billing = await billingOrchestrator({
    sbAdmin,
    customer,
    contract: updated,
    nowIso,
    startDate,
    forceActiveSubscription: true
  });

  const subscription = billing?.subscription || null;
  const invoices = await loadInvoices(sbAdmin, contractId);
  const readModel = buildReadModel({ contract: updated, customer, subscription, invoices });

  await writeAudit(sbAdmin, {
    actor,
    previous,
    contract: updated,
    subscription,
    billing,
    recovery,
    removedColumns: updatedResult.removedColumns,
    readModel
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
    activation_recovery: recovery,
    removed_schema_columns: updatedResult.removedColumns,
    read_model: readModel
  };
}

module.exports = {
  activateContractSafely,
  extractMissingColumn,
  updateContractWithSchemaFallback
};
