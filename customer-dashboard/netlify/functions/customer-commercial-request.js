'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const { insertOperationalCase } = require('./_lib/create-operational-case');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const ALLOWED_PLANS = new Set(['starter', 'business', 'professional']);
const ALLOWED_MINUTES = new Set([50, 100, 250, 500]);

function response(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function clean(value, maxLength = 160) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error: 'Supabase configuration missing' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const guard = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    requireActiveContract: true,
    functionName: 'customer-commercial-request'
  });
  if (!guard.ok) return response(guard.statusCode, guard.body);

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Invalid JSON', code: 'invalid_json' });
  }

  const type = clean(body.type, 40).toLowerCase();
  const requestId = clean(body.request_id, 100) || crypto.randomUUID();
  const currentPlan = clean(body.current_plan, 60).toLowerCase() || 'unbekannt';
  let title = '';
  let note = '';

  if (type === 'plan_upgrade') {
    const targetPlan = clean(body.target_plan, 60).toLowerCase();
    if (!ALLOWED_PLANS.has(targetPlan)) {
      return response(400, { error: 'Ungültiger Zielplan', code: 'invalid_target_plan' });
    }
    if (targetPlan === currentPlan) {
      return response(409, { error: 'Dieser Plan ist bereits aktiv', code: 'plan_already_active' });
    }

    const planLabels = { starter: 'Starter', business: 'Business', professional: 'Professional' };
    title = `Planwechsel auf ${planLabels[targetPlan]}`;
    note = [
      'Kundenanfrage aus dem Customer Portal',
      `Aktueller Plan: ${planLabels[currentPlan] || currentPlan}`,
      `Gewünschter Plan: ${planLabels[targetPlan]}`,
      `Abrechnungsrhythmus beibehalten: ${body.keep_billing_cycle === false ? 'Nein' : 'Ja'}`,
      'Der Kunde hat die Zusammenfassung im Portal bestätigt. Vertrags- und Rechnungsänderung intern prüfen und bestätigen.'
    ].join('\n');
  } else if (type === 'extra_minutes') {
    const minutes = Number(body.minutes);
    if (!ALLOWED_MINUTES.has(minutes)) {
      return response(400, { error: 'Ungültiges Minutenpaket', code: 'invalid_minutes_package' });
    }
    const estimate = Number(body.estimated_amount);
    const estimateLine = Number.isFinite(estimate) && estimate >= 0
      ? `Voraussichtlicher Betrag: CHF ${estimate.toFixed(2)}`
      : 'Betrag: gemäss gültiger Vertragskondition prüfen';

    title = `${minutes} Zusatzminuten anfragen`;
    note = [
      'Kundenanfrage aus dem Customer Portal',
      `Plan: ${currentPlan}`,
      `Gewünschtes Paket: ${minutes} Minuten`,
      estimateLine,
      'Der Kunde hat die Zusammenfassung im Portal bestätigt. Gutschrift und Verrechnung intern prüfen und bestätigen.'
    ].join('\n');
  } else {
    return response(400, { error: 'Ungültiger Anfragetyp', code: 'invalid_request_type' });
  }

  try {
    const caseRow = await insertOperationalCase(sbAdmin, {
      customerId: guard.customerId,
      title,
      note,
      source: 'customer_commercial_request',
      sourceRefId: requestId,
      priority: 'medium',
      caseType: type,
      originChannel: 'customer_portal',
      requesterUserId: guard.userId
    });

    const reference = clean(caseRow?.id || requestId, 100);
    return response(caseRow?.duplicate ? 200 : 201, {
      ok: true,
      duplicate: !!caseRow?.duplicate,
      reference,
      request_id: requestId,
      message: 'Ihre Anfrage wurde verbindlich übermittelt.'
    });
  } catch (error) {
    console.error('[customer-commercial-request] failed', error);
    return response(500, { error: 'Anfrage konnte nicht gespeichert werden', code: 'commercial_request_failed' });
  }
};
