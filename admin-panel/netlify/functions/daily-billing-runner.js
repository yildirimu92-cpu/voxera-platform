'use strict';

/**
 * daily-billing-runner.js
 *
 * Tägliche Auto-Billing-Engine für Voxera.
 *
 * Was die Funktion tut (in dieser Reihenfolge pro Customer):
 *
 *   1. Recurring-Sweep: für alle Verträge mit `status = 'active'` und
 *      `next_invoice_date <= heute` wird via existierendem
 *      `ensureRecurringInvoiceForContract` eine Recurring-Rechnung als DRAFT
 *      erstellt. Idempotent (external_reference: 'recurring:<contract>:<period>').
 *      `next_invoice_date` wird automatisch fortgeschrieben.
 *
 *   2. Überzug-Sweep: am 1. (oder 2.) jedes Monats wird für den VORMONAT
 *      pro Vertrag geprüft ob Überzug entstanden ist. Wenn ja → eine
 *      DRAFT-Rechnung mit invoice_type 'extra_minutes'. Idempotent
 *      (external_reference: 'overage:<customer>:<YYYY-MM>').
 *      Vertrag = Wahrheit für included_minutes + overage_rate_per_minute,
 *      plan_config = Fallback.
 *
 *   3. Mail-Trigger: für ALLE neu erstellten Drafts wird eine
 *      `invoice_email` Webhook-Nachricht via mail-dispatch ausgelöst, was
 *      Make das richtige Routing ermöglicht (subscription_payment vs
 *      setup_fee vs extra_minutes – Filter im Make-Router prüft auf
 *      invoice.invoice_type).
 *      Hinweis: Wenn der Admin Drafts manuell prüfen will (Modus B aus
 *      Operativ-Modell), ENV-Variable AUTO_SEND_DRAFTS=false setzen –
 *      dann werden Drafts nur erstellt, aber nicht versandt.
 *
 *   4. Subscription-Patch: setzt last_billing_sent_at, billing_state,
 *      next_reminder_at. Idempotent.
 *
 * Aufruf:
 *   - GET/POST → führt vollen Sweep aus
 *   - Optional: ?dry_run=1 → keine DB-Writes, nur Report
 *   - ENV: AUTO_SEND_DRAFTS=true|false (default: false – Drafts ohne Versand)
 *
 * Zeit-Logik:
 *   - Recurring wird PREPAID erstellt (am Tag von next_invoice_date,
 *     für die NEUE Periode die ab heute läuft).
 *   - Überzug wird POSTPAID erstellt (im neuen Monat für den abgeschlossenen
 *     Vormonat).
 *
 * Idempotenz:
 *   - Recurring: external_reference 'recurring:<contract>:<period>' (UNIQUE)
 *   - Überzug:   external_reference 'overage:<customer>:<YYYY-MM>'   (UNIQUE)
 *   - Beim Re-run am gleichen Tag → kein Duplikat, alles wird übersprungen.
 */

const { createClient } = require('@supabase/supabase-js');
const { runRecurringBillingSweep, createSetupFeeInvoice } = require('./_lib/invoice-service');
const { normalizePlanCode, loadPlanByCode } = require('./_lib/plan-config');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function log(level, event, payload = {}) {
  console.log(JSON.stringify({ level, event, ...payload }));
}

function intEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function boolEnv(name, fallback) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Überzug Sweep
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns { year, month } for the previous month (UTC) given a now date.
 * Result month is 1-12.
 */
function previousMonthYM(nowDate) {
  const d = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function ymString(year, month) {
  return year + '-' + String(month).padStart(2, '0');
}

/**
 * Counts call minutes for a customer in a specific UTC calendar month.
 * Uses Math.ceil per call to match frontend secsToMins().
 */
async function loadCustomerMinutesForMonth(sbAdmin, customerId, year, month) {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd   = new Date(Date.UTC(year, month, 1));
  return loadCustomerMinutesForPeriod(sbAdmin, customerId, periodStart, periodEnd);
}

/**
 * Counts call minutes for a customer in an arbitrary period [start, end).
 * Uses Math.ceil per call to match frontend secsToMins().
 */
async function loadCustomerMinutesForPeriod(sbAdmin, customerId, periodStart, periodEnd) {
  const { data, error } = await sbAdmin
    .from('calls')
    .select('duration_seconds, created_at')
    .eq('customer_id', customerId)
    .gte('created_at', periodStart.toISOString())
    .lt('created_at', periodEnd.toISOString());
  if (error) {
    return { ok: false, error: error.message };
  }
  // Math.ceil per call — matches frontend secsToMins() / ceil-per-call billing logic
  let usedMinutes = 0;
  let totalSeconds = 0;
  (data || []).forEach(row => {
    const sec = Number(row.duration_seconds);
    if (Number.isFinite(sec) && sec > 0) {
      totalSeconds += sec;
      usedMinutes  += Math.ceil(sec / 60);
    }
  });
  return { ok: true, usedMinutes, totalSeconds };
}

/**
 * Calculates billing period for a contract based on its start_date anchor day.
 * Given referenceDate (default: today), returns the period that ENDS on or before
 * referenceDate, i.e. the "current" or "just-ended" period.
 *
 * Example: contract start_date = 2026-05-02, today = 2026-06-02
 * → periodStart = 2026-05-02, periodEnd = 2026-06-01T23:59:59.999Z
 *
 * Returns { periodStart: Date, periodEnd: Date, periodKey: 'YYYY-MM-DD' }
 */
function getContractBillingPeriod(startDateStr, referenceDate) {
  if (!startDateStr) throw new Error('getContractBillingPeriod: startDateStr is required');
  const start = new Date(startDateStr);
  if (Number.isNaN(start.getTime())) throw new Error(`getContractBillingPeriod: invalid startDateStr: ${startDateStr}`);
  const ref   = referenceDate ? new Date(referenceDate) : new Date();
  const anchorDay = start.getUTCDate();

  // Find the most recent period start <= ref
  let pStart = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), anchorDay));
  if (pStart > ref) {
    pStart = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, anchorDay));
  }
  // Period end = anchor day next month, exclusive (i.e. periodEnd = pStart + 1 month)
  const pEnd = new Date(Date.UTC(pStart.getUTCFullYear(), pStart.getUTCMonth() + 1, anchorDay));

  return {
    periodStart: pStart,
    periodEnd:   pEnd,
    // Key = period start date YYYY-MM-DD (used for idempotency)
    periodKey: pStart.toISOString().slice(0, 10)
  };
}

/**
 * Resolves included_minutes + overage_rate from contract (truth) with
 * plan_config as fallback. Returns null if neither has values.
 */
async function resolveBillingTerms(sbAdmin, contract, customer) {
  let includedMinutes = null;
  let overageRate     = null;
  if (contract && contract.included_minutes != null) {
    includedMinutes = Number(contract.included_minutes);
  }
  if (contract && contract.overage_rate_per_minute != null) {
    overageRate = Number(contract.overage_rate_per_minute);
  }
  if (includedMinutes == null || overageRate == null) {
    const planCode = normalizePlanCode(contract?.plan || customer?.plan_code || customer?.plan);
    const { plan: planConfig } = await loadPlanByCode(sbAdmin, planCode);
    if (planConfig) {
      if (includedMinutes == null) includedMinutes = Number(planConfig.minutes || 0);
      if (overageRate     == null) overageRate     = Number(planConfig.extra_rate || 0);
    }
  }
  return {
    includedMinutes: Math.max(0, Number.isFinite(includedMinutes) ? includedMinutes : 0),
    overageRate:     Math.max(0, Number.isFinite(overageRate)     ? overageRate     : 0)
  };
}

/**
 * Creates a draft overage invoice if not already present. Idempotent.
 * Returns { created, invoiceId, skipped }.
 */
async function ensureOverageInvoice(sbAdmin, { customer, contract, year, month, overageMinutes, overageRate, externalRefOverride, periodStart: periodStartDate, periodEnd: periodEndDate }) {
  const periodMonth = ymString(year, month);
  // externalRefOverride: used for contract-cycle billing (key = contract:periodStart)
  // fallback: legacy calendar-month key for backwards compatibility
  const externalRef = externalRefOverride || ('overage:' + customer.id + ':' + periodMonth);
  // Idempotency check
  const { data: existing } = await sbAdmin
    .from('invoices')
    .select('id, invoice_number, status')
    .eq('external_reference', externalRef)
    .maybeSingle();
  if (existing) {
    return { created: false, invoiceId: existing.id, skipped: 'already_exists_for_period' };
  }
  const totalAmount = Number((overageMinutes * overageRate).toFixed(2));
  const periodStart = periodStartDate ? periodStartDate.toISOString() : new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const periodEnd   = periodEndDate   ? periodEndDate.toISOString()   : new Date(Date.UTC(year, month, 1)).toISOString();
  const nowIso = new Date().toISOString();
  const { data: numData } = await sbAdmin.rpc('next_invoice_number_v1');
  const invoiceNumber = numData || null;
  const { data: invoice, error: insertErr } = await sbAdmin
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      customer_id: customer.id,
      contract_id: contract.id,
      subscription_id: null,
      invoice_type: 'extra_minutes',
      billing_provider: 'invoice',
      status: 'draft',
      currency: 'CHF',
      subtotal_amount: totalAmount,
      tax_amount: 0,
      total_amount: totalAmount,
      issued_at: nowIso,
      due_at: nowIso,
      period_start: periodStart,
      period_end: periodEnd,
      external_reference: externalRef,
      notes: 'Überzugsrechnung ' + periodMonth + ' (auto-generated)',
      metadata: {
        source: 'auto_overage',
        overage_minutes: overageMinutes,
        overage_rate: overageRate,
        period_month: periodMonth
      }
    })
    .select('*')
    .single();
  if (insertErr) {
    return { created: false, error: 'invoice_insert_failed: ' + insertErr.message };
  }
  await sbAdmin.from('invoice_items').insert({
    invoice_id: invoice.id,
    sort_order: 1,
    item_type: 'extra_minutes',
    title: 'Überzug ' + periodMonth,
    description: overageMinutes + ' Min × CHF ' + overageRate.toFixed(2) + '/Min',
    quantity: overageMinutes,
    unit_price: overageRate,
    line_total: totalAmount,
    metadata: { source: 'auto_overage', period_month: periodMonth }
  });
  return { created: true, invoiceId: invoice.id };
}

/**
 * Iterates all active contracts, computes overage for the just-completed
 * billing period (contract-cycle based, NOT calendar month), and creates
 * draft invoices where needed.
 *
 * Runs EVERY DAY — for each contract it checks whether the contract's
 * billing period ended YESTERDAY. Only then does it create an invoice.
 * This means Überzug invoices are created the day after period end.
 *
 * Idempotency key: 'overage:<contract_id>:<period_start_date>' — so
 * even if the function runs multiple times, no duplicate invoice is created.
 */
async function runOverageSweep({ sbAdmin, now }) {
  // "Yesterday" in UTC — the period that just ended
  const yesterday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1,
    23, 59, 59, 999
  ));

  // 7-day lookback window to handle missed scheduler runs
  // Idempotency key prevents duplicate invoices
  const lookbackDates = [];
  for (let i = 1; i <= 7; i++) {
    lookbackDates.push(new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i,
      23, 59, 59, 999
    )));
  }

  const { data: contracts, error } = await sbAdmin
    .from('contracts')
    .select('*')
    .in('status', ['active', 'cancelled'])
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    return { processed: 0, results: [], error: 'contracts_query_failed: ' + error.message };
  }

  const results = [];

  for (const contract of (contracts || [])) {
    const customerId = String(contract.customer_id || '');
    if (!customerId || !contract.start_date) {
      results.push({ contract_id: contract.id, created: false, skipped: 'missing_customer_id_or_start_date' });
      continue;
    }

    // Calculate the billing period that ends today (i.e. the period where
    // periodEnd = today at 00:00 UTC, meaning yesterday was the last day)
    // Check each day in the lookback window for period endings
    let foundPeriod = null;
    for (const checkDate of lookbackDates) {
      const period = getContractBillingPeriod(contract.start_date, checkDate);
      // A period ended if periodEnd === checkDate's midnight
      const checkMidnight = new Date(checkDate);
      checkMidnight.setUTCHours(0, 0, 0, 0);
      checkMidnight.setUTCDate(checkMidnight.getUTCDate() + 1);
      if (period.periodEnd.getTime() === checkMidnight.getTime()) {
        foundPeriod = period;
        break; // use most recent ending period
      }
    }
    if (!foundPeriod) { results.push({ contract_id: contract.id, customer_id: customerId, created: false, skipped: 'no_period_ended_in_window' }); continue; }
    const { periodStart, periodEnd, periodKey } = foundPeriod;

    // Only proceed if yesterday was the last day of a billing period
    // i.e. periodEnd (exclusive) = today 00:00 UTC
    const todayMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (periodEnd.getTime() !== todayMidnight.getTime()) {
      results.push({
        contract_id: contract.id,
        customer_id: customerId,
        created: false,
        skipped: 'period_not_ending_today',
        period_key: periodKey,
        period_end: periodEnd.toISOString().slice(0,10),
        today: todayMidnight.toISOString().slice(0,10)
      });
      continue;
    }

    // For cancelled contracts, skip if terminated before this period
    if (String(contract.status).toLowerCase() === 'cancelled') {
      const termAt = contract.terminated_at ? new Date(contract.terminated_at) : null;
      if (termAt && termAt < periodStart) {
        results.push({ contract_id: contract.id, created: false, skipped: 'cancelled_before_period' });
        continue;
      }
    }

    const { data: customer } = await sbAdmin.from('customers').select('*').eq('id', customerId).maybeSingle();
    if (!customer) {
      results.push({ contract_id: contract.id, customer_id: customerId, created: false, skipped: 'customer_not_found' });
      continue;
    }

    // Load usage for this contract period
    const usage = await loadCustomerMinutesForPeriod(sbAdmin, customerId, periodStart, periodEnd);
    if (!usage.ok) {
      results.push({ contract_id: contract.id, customer_id: customerId, created: false, error: 'usage_query_failed: ' + usage.error });
      continue;
    }

    const terms = await resolveBillingTerms(sbAdmin, contract, customer);
    const overageMinutes = Math.max(0, usage.usedMinutes - terms.includedMinutes);

    if (overageMinutes <= 0) {
      results.push({
        contract_id: contract.id,
        customer_id: customerId,
        created: false,
        skipped: 'no_overage',
        used_minutes: usage.usedMinutes,
        included_minutes: terms.includedMinutes,
        period_key: periodKey
      });
      continue;
    }

    if (terms.overageRate <= 0) {
      results.push({
        contract_id: contract.id,
        customer_id: customerId,
        created: false,
        skipped: 'overage_rate_zero',
        overage_minutes: overageMinutes,
        period_key: periodKey
      });
      continue;
    }

    // Use periodKey (= period start date) as idempotency key
    const ensured = await ensureOverageInvoice(sbAdmin, {
      customer,
      contract,
      // Pass period info in a way ensureOverageInvoice can use
      year: periodStart.getUTCFullYear(),
      month: periodStart.getUTCMonth() + 1,
      overageMinutes,
      overageRate: terms.overageRate,
      // Override external_reference to use contract-cycle key
      externalRefOverride: 'overage:' + contract.id + ':' + periodKey,
      periodStart,
      periodEnd
    });

    results.push({
      contract_id: contract.id,
      customer_id: customerId,
      invoice_id: ensured.invoiceId || null,
      created: Boolean(ensured.created),
      skipped: ensured.skipped || null,
      error: ensured.error || null,
      overage_minutes: overageMinutes,
      overage_amount: Number((overageMinutes * terms.overageRate).toFixed(2)),
      period_key: periodKey
    });
  }

  return { processed: (contracts || []).length, results };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mail dispatch trigger (optional)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Triggers mail-dispatch.js via internal HTTP call for a list of newly
 * created draft invoices. Skipped if AUTO_SEND_DRAFTS is false (default).
 *
 * NOTE: This is a placeholder. Actual implementation depends on whether
 * mail-dispatch.js exposes a programmatic invoice_email entry point or
 * requires HTTP. For now, we leave drafts as-is and rely on the admin
 * to review them in the "Heute"-Tab and trigger sending manually.
 */
async function sendWebhookMail(payload) {
  const webhookUrl = process.env.MAKE_MAIL_WEBHOOK;
  if (!webhookUrl) return { ok: false, error: 'MAKE_MAIL_WEBHOOK not configured' };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function triggerInvoiceMails(sbAdmin, invoiceIds) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) return { sent: 0, errors: [] };
  let sent = 0;
  const errors = [];
  for (const invoiceId of invoiceIds) {
    try {
      const { data: invoice } = await sbAdmin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
      if (!invoice) { errors.push({ invoice_id: invoiceId, error: 'not_found' }); continue; }
      const { data: customer } = await sbAdmin.from('customers').select('*').eq('id', invoice.customer_id).maybeSingle();
      if (!customer) { errors.push({ invoice_id: invoiceId, error: 'customer_not_found' }); continue; }
      const invoiceType = String(invoice.invoice_type || '').toLowerCase();
      let payload;
      if (invoiceType === 'setup_fee') {
        // Use setup_fee_email route
        const planCode = normalizePlanCode(customer.plan_code || customer.plan);
        const { plan: planConfig } = await loadPlanByCode(sbAdmin, planCode);
        const paymentLink = planConfig?.setup_fee_payment_link || null;
        payload = {
          mail_type: 'setup_fee_email',
          recipient: { email: customer.email, name: customer.contact_name || customer.customer_name },
          customer: { id: customer.id, customer_name: customer.customer_name, plan_code: planCode },
          setup_fee: { amount: Number(invoice.total_amount || 0), currency: invoice.currency || 'CHF', payment_link: paymentLink },
          plan: { id: planConfig?.id || planCode, plan_label: planConfig?.plan_label || planConfig?.name || planCode },
          meta: { source: 'auto_billing', requested_at: new Date().toISOString() }
        };
      } else if (invoiceType === 'extra_minutes') {
        // Überzug → Banküberweisung (kein fixer Stripe-Link möglich)
        const voxeraIban = process.env.VOXERA_IBAN || 'CH53 0878 1000 2615 3320 0';
        const voxeraBic  = process.env.VOXERA_BIC  || 'SWQBCHZZXXX';
        const voxeraBank = process.env.VOXERA_BANK_NAME || 'Voxera AI c/o Umut Yildirim';
        // Extract period info from invoice metadata or notes
        const meta = invoice.metadata || {};
        const periodMonth = meta.period_month || invoice.notes?.match(/\d{4}-\d{2}/)?.[0] || '—';
        const overageMinutes = meta.overage_minutes || '—';
        const overageRate = meta.overage_rate || '—';
        payload = {
          mail_type: 'overage_email',
          recipient: { email: customer.email, name: customer.contact_name || customer.customer_name },
          customer: { id: customer.id, customer_name: customer.customer_name },
          invoice: {
            id: invoice.id,
            invoice_number: invoice.invoice_number || '—',
            amount: Number(invoice.total_amount || 0),
            currency: invoice.currency || 'CHF',
            due_at: invoice.due_at,
            period_month: periodMonth
          },
          overage: {
            minutes: overageMinutes,
            rate: overageRate,
            period_month: periodMonth
          },
          // Banküberweisung
          payment_method: 'bank_transfer',
          payment_iban: voxeraIban,
          payment_bic: voxeraBic,
          payment_bank: voxeraBank,
          payment_reference: invoice.invoice_number || '—',
          payment_due_days: 7,
          meta: { source: 'auto_billing', requested_at: new Date().toISOString() }
        };
      } else {
        // Use invoice_email route
        let subscription = null;
        if (invoice.subscription_id) {
          const { data: sub } = await sbAdmin.from('subscriptions').select('*').eq('id', invoice.subscription_id).maybeSingle();
          subscription = sub || null;
        }
        const planCode = normalizePlanCode(subscription?.plan_code || customer.plan_code || customer.plan);
        payload = {
          mail_type: 'invoice_email',
          recipient: { email: customer.email, name: customer.contact_name || customer.customer_name },
          customer: { id: customer.id, customer_name: customer.customer_name, plan_code: planCode, plan_label: planCode ? planCode.charAt(0).toUpperCase()+planCode.slice(1) : 'Voxera' },
          invoice: {
            id: invoice.id, invoice_number: invoice.invoice_number, invoice_type: invoice.invoice_type,
            status: invoice.status, amount: Number(invoice.total_amount || 0),
            due_at: invoice.due_at, currency: invoice.currency || 'CHF',
            payment_link: invoice.payment_link || null
          },
          subscription: subscription ? { id: subscription.id, billing_cycle: subscription.billing_cycle, plan_code: planCode, plan_label: planCode ? planCode.charAt(0).toUpperCase()+planCode.slice(1) : 'Voxera' } : { id: null, billing_cycle: null, plan_code: planCode, plan_label: planCode ? planCode.charAt(0).toUpperCase()+planCode.slice(1) : 'Voxera' },
          meta: { source: 'auto_billing', requested_at: new Date().toISOString() }
        };
      }
      const result = await sendWebhookMail(payload);
      if (result.ok) {
        // Mark invoice as open after sending
        await sbAdmin.from('invoices').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', invoiceId);
        sent++;
      } else {
        errors.push({ invoice_id: invoiceId, error: result.error || `status ${result.status}` });
      }
    } catch (err) {
      errors.push({ invoice_id: invoiceId, error: err.message || String(err) });
    }
  }
  return { sent, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup Fee T-7 Sweep
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds contracts starting in exactly 7 days and creates setup_fee invoices
 * if not already present. Sends email immediately via webhook.
 */
async function runSetupFeeSweep({ sbAdmin, now }) {
  const targetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7));
  const targetDateStr = targetDate.toISOString().slice(0, 10);

  const { data: contracts, error } = await sbAdmin
    .from('contracts')
    .select('*')
    .in('status', ['active', 'signed', 'pending_review', 'pending'])
    .gte('start_date', targetDateStr + 'T00:00:00.000Z')
    .lt('start_date', targetDateStr + 'T23:59:59.999Z');

  if (error) return { processed: 0, results: [], error: 'contracts_query_failed: ' + error.message };

  const results = [];
  for (const contract of (contracts || [])) {
    const customerId = String(contract.customer_id || '');
    if (!customerId) { results.push({ contract_id: contract.id, skipped: 'missing_customer_id' }); continue; }

    const setupAmount = Number(contract.setup_fee_amount || 0);
    if (setupAmount <= 0) { results.push({ contract_id: contract.id, skipped: 'no_setup_fee' }); continue; }

    // Idempotency: check if setup_fee invoice already exists for this contract
    const extRef = 'setup_fee:' + contract.id;
    const { data: existing } = await sbAdmin.from('invoices').select('id').eq('external_reference', extRef).maybeSingle();
    if (existing) { results.push({ contract_id: contract.id, skipped: 'already_exists', invoice_id: existing.id }); continue; }

    const { data: customer } = await sbAdmin.from('customers').select('*').eq('id', customerId).maybeSingle();
    if (!customer) { results.push({ contract_id: contract.id, skipped: 'customer_not_found' }); continue; }

    try {
      const dueAt = targetDateStr + 'T23:59:59.000Z'; // due on start date
      const invoice = await createSetupFeeInvoice({
        sbAdmin, customer, contractId: contract.id, contract,
        offerId: contract.offer_id || null,
        setupFeeAmount: setupAmount,
        billingProvider: 'invoice',
        status: 'open',
        dueAt,
        notes: 'Einrichtungsgebühr – automatisch erstellt T-7 vor Vertragsstart'
      });
      results.push({ contract_id: contract.id, customer_id: customerId, created: true, invoice_id: invoice?.id || null });
    } catch (err) {
      results.push({ contract_id: contract.id, customer_id: customerId, created: false, error: err.message || String(err) });
    }
  }
  return { processed: (contracts || []).length, target_date: targetDateStr, results };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dunning Sweep (Mahnungen)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds open/overdue invoices and sends reminder emails.
 * - Reminder 1: due_at + 7 days (first reminder)
 * - Reminder 2: due_at + 14 days (final warning — account will be suspended)
 * Tracks reminders via invoice.notes to avoid duplicates.
 */
async function runDunningSweep({ sbAdmin, now }) {
  const todayStr = now.toISOString().slice(0, 10);
  const reminder1Threshold = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7)).toISOString().slice(0, 10);
  const reminder2Threshold = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 14)).toISOString().slice(0, 10);

  const { data: invoices, error } = await sbAdmin
    .from('invoices')
    .select('*')
    .eq('status', 'open')
    .lte('due_at', reminder1Threshold + 'T23:59:59.999Z')
    .limit(200);

  if (error) return { processed: 0, results: [], error: 'invoices_query_failed: ' + error.message };

  const results = [];
  const mailIds = { reminder1: [], reminder2: [] };

  for (const invoice of (invoices || [])) {
    const notes = String(invoice.notes || '');
    const dueDateStr = invoice.due_at ? invoice.due_at.slice(0, 10) : null;
    if (!dueDateStr) { results.push({ invoice_id: invoice.id, skipped: 'no_due_date' }); continue; }

    const hasReminder2 = notes.includes('[REMINDER L2') || notes.includes('[REMINDER_FINAL');
    const hasReminder1 = notes.includes('[REMINDER L1') || notes.includes('[REMINDER L2');

    // Final warning: due + 14 days
    if (dueDateStr <= reminder2Threshold && !hasReminder2) {
      const noteEntry = `[REMINDER_FINAL ${todayStr}] Letzte Warnung – Konto wird bei Nichtbezahlung deaktiviert`;
      await sbAdmin.from('invoices').update({
        notes: [notes, noteEntry].filter(Boolean).join('\n'),
        updated_at: new Date().toISOString()
      }).eq('id', invoice.id);
      mailIds.reminder2.push(invoice.id);
      results.push({ invoice_id: invoice.id, customer_id: invoice.customer_id, action: 'reminder2_sent' });
      continue;
    }

    // First reminder: due + 7 days
    if (dueDateStr <= reminder1Threshold && !hasReminder1) {
      const noteEntry = `[REMINDER L1 ${todayStr}] Erste Mahnung versendet`;
      await sbAdmin.from('invoices').update({
        notes: [notes, noteEntry].filter(Boolean).join('\n'),
        updated_at: new Date().toISOString()
      }).eq('id', invoice.id);
      mailIds.reminder1.push(invoice.id);
      results.push({ invoice_id: invoice.id, customer_id: invoice.customer_id, action: 'reminder1_sent' });
      continue;
    }

    results.push({ invoice_id: invoice.id, skipped: hasReminder2 ? 'final_already_sent' : hasReminder1 ? 'reminder1_already_sent' : 'not_yet_due_for_reminder' });
  }

  // Send reminder emails via webhook
  const webhookUrl = process.env.MAKE_MAIL_WEBHOOK;
  let mailsSent = 0;
  if (webhookUrl) {
    for (const invoiceId of [...mailIds.reminder1, ...mailIds.reminder2]) {
      try {
        const { data: invoice } = await sbAdmin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
        const { data: customer } = await sbAdmin.from('customers').select('*').eq('id', invoice?.customer_id).maybeSingle();
        if (!invoice || !customer) continue;
        const isFinal = mailIds.reminder2.includes(invoiceId);
        const planCode = normalizePlanCode(customer.plan_code || customer.plan);
        const payload = {
          mail_type: isFinal ? 'reminder_final_email' : 'reminder_email',
          reminder_level: isFinal ? 2 : 1,
          recipient: { email: customer.email, name: customer.contact_name || customer.customer_name },
          customer: { id: customer.id, customer_name: customer.customer_name, plan_code: planCode },
          invoice: {
            id: invoice.id, invoice_number: invoice.invoice_number,
            amount: Number(invoice.total_amount || 0), due_at: invoice.due_at,
            currency: invoice.currency || 'CHF', payment_link: invoice.payment_link || null
          },
          meta: { source: 'auto_dunning', requested_at: new Date().toISOString() }
        };
        const res = await sendWebhookMail(payload);
        if (res.ok) mailsSent++;
      } catch (_e) { console.warn('[daily-runner] mail dispatch error:', _e?.message || String(_e)); }
    }
  }

  return {
    processed: (invoices || []).length,
    reminder1_sent: mailIds.reminder1.length,
    reminder2_sent: mailIds.reminder2.length,
    mails_sent: mailsSent,
    results
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract Expiry Sweep
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds contracts where end_date = today and deactivates them + the customer
 * if no other active contract remains.
 *
 * Also sends a contract_expired_email via Make webhook.
 */
async function runContractExpirySweep({ sbAdmin, now }) {
  const todayStr = now.toISOString().slice(0, 10);
  const results  = [];

  const { data: expiredContracts, error } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('status', 'active')
    .eq('end_date', todayStr);

  if (error) {
    return { processed: 0, results: [], error: 'contracts_query_failed: ' + error.message };
  }

  for (const contract of (expiredContracts || [])) {
    // Guard: skip contracts without customer_id
    const customerId = String(contract.customer_id || '').trim();
    if (!customerId) {
      results.push({ contract_id: contract.id, skipped: 'missing_customer_id' });
      continue;
    }
    try {
      // 1. Cancel the contract
      const { error: cancelErr } = await sbAdmin
        .from('contracts')
        .update({
          status:             'cancelled',
          termination_type:   'end_of_term',
          termination_reason: 'Vertrag automatisch beendet (Laufzeitende)',
          terminated_at:      now.toISOString(),
          terminated_by:      'system',
          updated_at:         now.toISOString()
        })
        .eq('id', contract.id);

      if (cancelErr) {
        results.push({ contract_id: contract.id, error: 'cancel_failed: ' + cancelErr.message });
        continue;
      }

      log('info', 'contract_expired', { contract_id: contract.id, customer_id: contract.customer_id, end_date: todayStr });

      // 2. Check if customer has other active contracts
      const { data: otherActive } = await sbAdmin
        .from('contracts')
        .select('id')
        .eq('customer_id', contract.customer_id)
        .eq('status', 'active');

      let customerDeactivated = false;
      if (!otherActive || otherActive.length === 0) {
        // No remaining active contracts → deactivate customer
        const { error: custErr } = await sbAdmin
          .from('customers')
          .update({ status: 'cancelled', updated_at: now.toISOString() })
          .eq('id', contract.customer_id);

        if (!custErr) {
          customerDeactivated = true;
          log('info', 'customer_deactivated_on_contract_expiry', { customer_id: contract.customer_id });
        }
      }

      // 3. Send expiry notification via Make webhook
      const webhookUrl = process.env.MAKE_MAIL_WEBHOOK;
      if (webhookUrl) {
        try {
          const { data: customer } = await sbAdmin
            .from('customers')
            .select('email, contact_name, customer_name')
            .eq('id', contract.customer_id)
            .maybeSingle();

          if (customer) {
            await fetch(webhookUrl, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mail_type:         'contract_expired_email',
                recipient: {
                  email: customer.email,
                  name:  customer.contact_name || customer.customer_name
                },
                customer: { id: contract.customer_id },
                contract: {
                  id:       contract.id,
                  end_date: todayStr,
                  plan:     contract.plan
                },
                meta: { source: 'auto_expiry', requested_at: now.toISOString() }
              })
            });
          }
        } catch (mailErr) {
          log('warn', 'expiry_mail_failed', { contract_id: contract.id, error: mailErr.message });
        }
      }

      results.push({
        contract_id:          contract.id,
        customer_id:          contract.customer_id,
        cancelled:            true,
        customer_deactivated: customerDeactivated,
        end_date:             todayStr
      });

    } catch (err) {
      results.push({ contract_id: contract.id, error: err.message || String(err) });
    }
  }

  return { processed: (expiredContracts || []).length, results };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Handler
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return response(405, { error: 'Method not allowed' });
  }

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const params = event.queryStringParameters || {};
  const dryRun = String(params.dry_run || '').trim() === '1';
  const autoSendDrafts = boolEnv('AUTO_SEND_DRAFTS', false);

  const now = new Date();
  const nowIso = now.toISOString();

  log('info', 'billing_runner_start', { dry_run: dryRun, auto_send_drafts: autoSendDrafts, ran_at: nowIso });

  // ── 1. Recurring Sweep ─────────────────────────────────────────────────────
  let recurringResult = { processed: 0, results: [] };
  if (!dryRun) {
    try {
      recurringResult = await runRecurringBillingSweep({ sbAdmin, now, limit: 500 });
    } catch (err) {
      log('error', 'recurring_sweep_failed', { error: err.message || String(err) });
      recurringResult = { processed: 0, results: [], error: err.message || String(err) };
    }
  } else {
    log('info', 'dry_run_skipping_recurring');
  }

  // ── 1b. Setup Fee T-7 Sweep ───────────────────────────────────────────────
  let setupFeeResult = { processed: 0, results: [] };
  if (!dryRun) {
    try {
      setupFeeResult = await runSetupFeeSweep({ sbAdmin, now });
    } catch (err) {
      log('error', 'setup_fee_sweep_failed', { error: err.message || String(err) });
      setupFeeResult = { processed: 0, results: [], error: err.message || String(err) };
    }
  }

  // ── 1c. Dunning Sweep ──────────────────────────────────────────────────────
  let dunningResult = { processed: 0, results: [], reminder1_sent: 0, reminder2_sent: 0 };
  if (!dryRun) {
    try {
      dunningResult = await runDunningSweep({ sbAdmin, now });
    } catch (err) {
      log('error', 'dunning_sweep_failed', { error: err.message || String(err) });
    }
  }

  // ── 2. Overage Sweep (contract-cycle based, runs every day) ─────────────
  // Each contract's overage is invoiced the day AFTER its billing period ends.
  // This replaces the old calendar-month window (day 1-3).
  let overageResult = { processed: 0, results: [] };
  if (!dryRun) {
    try {
      overageResult = await runOverageSweep({ sbAdmin, now });
    } catch (err) {
      log('error', 'overage_sweep_failed', { error: err.message || String(err) });
      overageResult = { processed: 0, results: [], error: err.message || String(err) };
    }
  } else {
    log('info', 'dry_run_skipping_overage');
  }

  // ── 2b. Contract Expiry Sweep ─────────────────────────────────────────────
  // Cancels contracts where end_date = today and deactivates customer access.
  let expiryResult = { processed: 0, results: [] };
  if (!dryRun) {
    try {
      expiryResult = await runContractExpirySweep({ sbAdmin, now });
    } catch (err) {
      log('error', 'expiry_sweep_failed', { error: err.message || String(err) });
      expiryResult = { processed: 0, results: [], error: err.message || String(err) };
    }
  } else {
    log('info', 'dry_run_skipping_expiry');
  }

  // ── 3. Mail trigger for newly created drafts ──────────────────────────────
  const newRecurringInvoiceIds = (recurringResult.results || [])
    .filter(r => r.created && r.invoice_id)
    .map(r => r.invoice_id);
  const newOverageInvoiceIds = (overageResult.results || [])
    .filter(r => r.created && r.invoice_id)
    .map(r => r.invoice_id);
  const newSetupFeeInvoiceIds = (setupFeeResult.results || [])
    .filter(r => r.created && r.invoice_id)
    .map(r => r.invoice_id);
  const allNewInvoiceIds = newRecurringInvoiceIds.concat(newOverageInvoiceIds).concat(newSetupFeeInvoiceIds);

  let mailResult = { sent: 0, errors: [], note: 'auto_send_disabled' };
  if (autoSendDrafts && !dryRun && allNewInvoiceIds.length > 0) {
    mailResult = await triggerInvoiceMails(sbAdmin, allNewInvoiceIds);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = {
    success: true,
    ran_at: nowIso,
    dry_run: dryRun,
    auto_send_drafts: autoSendDrafts,
    recurring: {
      processed: recurringResult.processed,
      created: newRecurringInvoiceIds.length,
      skipped_count: (recurringResult.results || []).filter(r => !r.created && r.skipped).length,
      error_count: (recurringResult.results || []).filter(r => r.error).length,
      results: recurringResult.results || [],
      error: recurringResult.error || null
    },
    overage: {
      processed: overageResult.processed,
      created: newOverageInvoiceIds.length,
      period_month: overageResult.period_month || null,
      skipped: overageResult.skipped || null,
      day_of_month: overageResult.day_of_month != null ? overageResult.day_of_month : null,
      results: overageResult.results || [],
      error: overageResult.error || null
    },
    mail: mailResult,
    new_invoice_ids: allNewInvoiceIds,
    setup_fee: {
      processed: setupFeeResult.processed,
      created: newSetupFeeInvoiceIds.length,
      results: setupFeeResult.results || [],
      error: setupFeeResult.error || null
    },
    dunning: {
      processed: dunningResult.processed,
      reminder1_sent: dunningResult.reminder1_sent || 0,
      reminder2_sent: dunningResult.reminder2_sent || 0,
      mails_sent: dunningResult.mails_sent || 0
    },
    expiry: {
      processed: expiryResult.processed,
      cancelled: (expiryResult.results || []).filter(r => r.cancelled).length,
      results: expiryResult.results || [],
      error: expiryResult.error || null
    }
  };

  log('info', 'billing_runner_done', {
    recurring_created: summary.recurring.created,
    overage_created: summary.overage.created,
    mail_sent: mailResult.sent
  });

  return response(200, summary);
};
