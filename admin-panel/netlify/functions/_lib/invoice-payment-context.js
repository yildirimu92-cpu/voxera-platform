'use strict';

function dateOnly(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const d = new Date(`${dateOnly(value)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Number(days) || 0));
  return d.toISOString();
}

function compact(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function creditorSnapshot(account) {
  return {
    account_id: account.id,
    account_name: account.account_name || null,
    creditor_name: account.creditor_name,
    creditor_street: account.creditor_street,
    creditor_house_number: account.creditor_house_number || null,
    creditor_postal_code: account.creditor_postal_code,
    creditor_city: account.creditor_city,
    creditor_country: account.creditor_country || 'CH',
    bank_name: account.bank_name || null,
    iban: compact(account.iban),
    qr_iban: compact(account.qr_iban) || null,
    bic: compact(account.bic) || null,
    currency: account.currency || 'CHF',
    reference_type: account.reference_type || 'NON',
    payment_terms_days: Number(account.payment_terms_days || 30),
    billing_email: account.billing_email || null,
    vat_number: account.vat_number || null,
    default_message: account.default_message || null,
    qr_enabled: account.qr_enabled !== false,
    stripe_link_enabled: account.stripe_link_enabled === true,
    captured_at: new Date().toISOString()
  };
}

function debtorSnapshot(customer) {
  return {
    customer_id: customer.id,
    company_name: customer.customer_name || customer.company_name || customer.name || null,
    contact_name: customer.contact_name || null,
    email: customer.email || null,
    street: customer.street || customer.address || null,
    house_number: customer.house_number || null,
    postal_code: customer.zip || customer.postal_code || null,
    city: customer.city || null,
    country: customer.country || 'CH',
    captured_at: new Date().toISOString()
  };
}

async function loadDefaultPaymentAccount(sbAdmin, currency) {
  const targetCurrency = String(currency || 'CHF').toUpperCase();
  const { data, error } = await sbAdmin
    .from('payment_accounts')
    .select('*')
    .eq('currency', targetCurrency)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw Object.assign(new Error(`payment account lookup failed: ${error.message}`), { step_failed: 'load_payment_account', db_message: error.message, db_code: error.code || null });
  if (!data) throw Object.assign(new Error(`Kein aktives Voxera-Zahlungskonto für ${targetCurrency} hinterlegt.`), { step_failed: 'load_payment_account' });
  return data;
}

async function loadInvoiceItems(sbAdmin, invoiceId) {
  const { data, error } = await sbAdmin
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('sort_order', { ascending: true });
  if (error) throw Object.assign(new Error(`invoice items snapshot failed: ${error.message}`), { step_failed: 'snapshot_invoice_items', db_message: error.message, db_code: error.code || null });
  return (data || []).map((item) => ({
    item_type: item.item_type || null,
    title: item.title || null,
    description: item.description || null,
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    line_total: Number(item.line_total || 0),
    sort_order: Number(item.sort_order || 0),
    metadata: item.metadata || {}
  }));
}

function paymentReference(invoice, account) {
  const number = String(invoice.invoice_number || invoice.id || '').trim();
  if (String(account.reference_type || 'NON').toUpperCase() === 'NON') return `Rechnung ${number}`.slice(0, 140);
  return invoice.payment_reference || null;
}

async function applyInvoicePaymentContext({ sbAdmin, invoice, customer }) {
  if (!invoice?.id) throw Object.assign(new Error('invoice missing for payment context'), { step_failed: 'apply_payment_context' });
  const account = await loadDefaultPaymentAccount(sbAdmin, invoice.currency || 'CHF');
  const itemsSnapshot = await loadInvoiceItems(sbAdmin, invoice.id);
  const issuedAt = invoice.issued_at || new Date().toISOString();
  const patch = {
    billing_provider: 'invoice',
    payment_method: 'bank_transfer',
    payment_account_id: account.id,
    payment_account_snapshot: creditorSnapshot(account),
    customer_snapshot: debtorSnapshot(customer),
    line_items_snapshot: itemsSnapshot,
    payment_reference_type: String(account.reference_type || 'NON').toUpperCase(),
    payment_reference: paymentReference(invoice, account),
    payment_terms_days: Number(account.payment_terms_days || 30),
    due_at: addDays(issuedAt, account.payment_terms_days),
    stripe_checkout_session_id: null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await sbAdmin.from('invoices').update(patch).eq('id', invoice.id).select('*').single();
  if (error) throw Object.assign(new Error(`invoice payment context update failed: ${error.message}`), { step_failed: 'apply_payment_context', db_message: error.message, db_code: error.code || null, db_details: error.details || null });
  return data;
}

async function applyContractInvoicesPaymentContext({ sbAdmin, invoices, customer }) {
  const result = {};
  for (const [key, invoice] of Object.entries(invoices || {})) {
    if (!invoice?.id) continue;
    result[key] = await applyInvoicePaymentContext({ sbAdmin, invoice, customer });
  }
  return result;
}

module.exports = {
  applyInvoicePaymentContext,
  applyContractInvoicesPaymentContext,
  loadDefaultPaymentAccount,
  creditorSnapshot,
  debtorSnapshot
};
