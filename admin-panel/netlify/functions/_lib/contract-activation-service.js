'use strict';

const { orchestrateContractBilling } = require('./contract-billing-orchestrator');
const { applyContractInvoicesPaymentContext } = require('./invoice-payment-context');

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
    const { data, error } = await sbAdmin.from('contracts').update(mutablePatch).eq('id', contractId).select('*').single();
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

async function loadOne(sbAdmin, table, id, step) {
  const { data, error } = await sbAdmin.from(table).select('*').eq('id', id).maybeSingle();
  if (error) {
    const wrapped = new Error(`${table} lookup failed: ${error.message}`);
    wrapped.step_failed = step;
    wrapped.db_message = error.message || null;
    wrapped.db_code = error.code || null;
    throw wrapped;
  }
  return data || null;
}

async function activateContractSafely({ sbAdmin, actor, contractId, requestedCustomerId = null, startDate, durationMonths, endDate, notes = null, nowIso = new Date().toISOString() }) {
  const previous = await loadOne(sbAdmin, 'contracts', contractId, 'load_contract');
  if (!previous) throw Object.assign(new Error('Contract nicht gefunden.'), { step_failed: 'load_contract' });
  const status = normalizeStatus(previous.status);
  if (!ACTIVATABLE_STATUSES.has(status)) throw Object.assign(new Error(`Illegal contract transition: '${status}' -> 'active'`), { step_failed: 'validate_contract_status' });
  const customerId = String(previous.customer_id || '').trim();
  if (!customerId) throw Object.assign(new Error('Contract hat keine customer_id.'), { step_failed: 'validate_contract_customer' });
  if (requestedCustomerId && String(requestedCustomerId) !== customerId) throw Object.assign(new Error('customer_id stimmt nicht mit dem Vertrag überein.'), { step_failed: 'validate_contract_customer' });

  const recovery = status === 'active';
  const updatedResult = await updateContractWithSchemaFallback({
    sbAdmin,
    contractId,
    patch: { status: 'active', start_date: startDate, duration_months: durationMonths, end_date: endDate, updated_at: nowIso, notes: String(notes || previous.notes || '').trim() || null }
  });
  const updated = updatedResult.contract;
  const customer = await loadOne(sbAdmin, 'customers', customerId, 'load_customer');
  if (!customer) throw Object.assign(new Error('Customer nicht gefunden.'), { step_failed: 'load_customer' });

  const billing = await orchestrateContractBilling({ sbAdmin, customer, contract: updated, nowIso, startDate, forceActiveSubscription: true });
  const paymentInvoices = await applyContractInvoicesPaymentContext({
    sbAdmin,
    customer,
    invoices: {
      setup_fee: billing?.setupInvoice || null,
      recurring: billing?.recurringInvoice || null
    }
  });
  if (paymentInvoices.setup_fee) billing.setupInvoice = paymentInvoices.setup_fee;
  if (paymentInvoices.recurring) billing.recurringInvoice = paymentInvoices.recurring;

  const subscription = billing?.subscription || null;
  const { data: invoices } = await sbAdmin.from('invoices').select('*').eq('contract_id', contractId).order('created_at', { ascending: false }).limit(10);
  const readModel = { contract: updated, customer, subscription, billing: { invoice_open_count: (invoices || []).filter(i => !['paid','cancelled','void','credited'].includes(String(i?.status || '').toLowerCase())).length, latest_invoice_id: invoices?.[0]?.id || null, latest_invoice_status: invoices?.[0]?.status || null }, last_mutation_at: new Date().toISOString() };

  await sbAdmin.from('commercial_lifecycle_audit').insert({ actor_admin_id: actor?.userId || null, actor_role: actor?.role || null, action: recovery ? 'contracts.activate.recover' : 'contracts.activate', customer_id: customerId, contract_id: contractId, subscription_id: subscription?.id || null, previous_state: { contract: previous }, next_state: readModel, metadata: { activation_recovery: recovery, removed_schema_columns: updatedResult.removedColumns, setup_fee_invoice_id: billing?.setupInvoice?.id || null, recurring_invoice_id: billing?.recurringInvoice?.id || null, payment_account_id: billing?.setupInvoice?.payment_account_id || billing?.recurringInvoice?.payment_account_id || null }, happened_at: new Date().toISOString() });

  return { contract: updated, subscription, setup_fee_invoice: billing?.setupInvoice || null, recurring_invoice: billing?.recurringInvoice || null, setup_fee_invoice_created: Boolean(billing?.setup_fee_invoice_created), recurring_invoice_created: Boolean(billing?.recurring_invoice_created), pdfs_generated: (billing?.pdf?.errors || []).length === 0, pdf_generation_errors: billing?.pdf?.errors || [], activation_recovery: recovery, removed_schema_columns: updatedResult.removedColumns, read_model: readModel };
}

module.exports = { activateContractSafely, extractMissingColumn, updateContractWithSchemaFallback };
