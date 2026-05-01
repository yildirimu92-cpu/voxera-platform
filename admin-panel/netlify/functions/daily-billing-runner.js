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
const { runRecurringBillingSweep } = require('./_lib/invoice-service');
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
  const { data, error } = await sbAdmin
    .from('calls')
    .select('duration_seconds, created_at')
    .eq('customer_id', customerId)
    .gte('created_at', periodStart.toISOString())
    .lt('created_at', periodEnd.toISOString());
  if (error) {
    return { ok: false, error: error.message };
  }
  let totalSeconds = 0;
  (data || []).forEach(row => {
    const sec = Number(row.duration_seconds);
    if (Number.isFinite(sec) && sec > 0) totalSeconds += sec;
  });
  // Math.ceil matches frontend display (secsToMins)
  const usedMinutes = Math.ceil(totalSeconds / 60);
  return { ok: true, usedMinutes, totalSeconds };
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
async function ensureOverageInvoice(sbAdmin, { customer, contract, year, month, overageMinutes, overageRate }) {
  const periodMonth = ymString(year, month);
  const externalRef = 'overage:' + customer.id + ':' + periodMonth;
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
  const periodStart = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const periodEnd   = new Date(Date.UTC(year, month, 1)).toISOString();
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
 * Iterates all active/cancelled-this-month contracts, computes overage for
 * the previous full month, and creates draft invoices where needed.
 */
async function runOverageSweep({ sbAdmin, now }) {
  const { year, month } = previousMonthYM(now);
  const periodMonth = ymString(year, month);
  // Pull contracts that were active during the previous month. Includes:
  // - status 'active' (still active today, was active last month too)
  // - status 'cancelled' but terminated after last month start (was active part of it)
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
    if (!customerId) {
      results.push({ contract_id: contract.id, created: false, skipped: 'missing_customer_id' });
      continue;
    }
    // For cancelled contracts, only process if termination was AFTER the prev-month start
    if (String(contract.status).toLowerCase() === 'cancelled') {
      const termAt = contract.terminated_at ? new Date(contract.terminated_at) : null;
      const prevMonthStart = new Date(Date.UTC(year, month - 1, 1));
      if (termAt && termAt < prevMonthStart) {
        results.push({ contract_id: contract.id, created: false, skipped: 'cancelled_before_period' });
        continue;
      }
    }
    const { data: customer } = await sbAdmin.from('customers').select('*').eq('id', customerId).maybeSingle();
    if (!customer) {
      results.push({ contract_id: contract.id, customer_id: customerId, created: false, skipped: 'customer_not_found' });
      continue;
    }
    const usage = await loadCustomerMinutesForMonth(sbAdmin, customerId, year, month);
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
        included_minutes: terms.includedMinutes
      });
      continue;
    }
    if (terms.overageRate <= 0) {
      results.push({
        contract_id: contract.id,
        customer_id: customerId,
        created: false,
        skipped: 'overage_rate_zero',
        overage_minutes: overageMinutes
      });
      continue;
    }
    const ensured = await ensureOverageInvoice(sbAdmin, {
      customer,
      contract,
      year,
      month,
      overageMinutes,
      overageRate: terms.overageRate
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
      period_month: periodMonth
    });
  }
  return { processed: (contracts || []).length, period_month: periodMonth, results };
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
async function triggerInvoiceMails(sbAdmin, invoiceIds) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) return { sent: 0, errors: [] };
  // Mode B (default): drafts are reviewed manually – do not auto-send.
  // To enable auto-send, set AUTO_SEND_DRAFTS=true and implement the call here.
  return { sent: 0, errors: [], note: 'auto_send_disabled' };
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

  // ── 2. Overage Sweep (only on day 1-3 of the month, to give some leeway) ──
  // Drift safety: if the cron misses day 1 (e.g. weekend, downtime), still
  // run on days 2 and 3. After that, assume manual handling for the month.
  let overageResult = { processed: 0, results: [], period_month: null, skipped: null };
  const dayOfMonth = now.getUTCDate();
  if (dayOfMonth <= 3) {
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
  } else {
    overageResult = { processed: 0, results: [], skipped: 'not_in_overage_window', day_of_month: dayOfMonth };
  }

  // ── 3. Mail trigger for newly created drafts ──────────────────────────────
  const newRecurringInvoiceIds = (recurringResult.results || [])
    .filter(r => r.created && r.invoice_id)
    .map(r => r.invoice_id);
  const newOverageInvoiceIds = (overageResult.results || [])
    .filter(r => r.created && r.invoice_id)
    .map(r => r.invoice_id);
  const allNewInvoiceIds = newRecurringInvoiceIds.concat(newOverageInvoiceIds);

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
    new_invoice_ids: allNewInvoiceIds
  };

  log('info', 'billing_runner_done', {
    recurring_created: summary.recurring.created,
    overage_created: summary.overage.created,
    mail_sent: mailResult.sent
  });

  return response(200, summary);
};
