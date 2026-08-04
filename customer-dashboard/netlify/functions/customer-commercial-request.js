'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const { insertOperationalCase } = require('./_lib/create-operational-case');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

const ALLOWED_PLANS = new Set(['starter', 'business', 'professional', 'enterprise']);
const ALLOWED_MINUTES = new Set([50, 100, 250, 500]);
const ACTIVE_STATUSES = ['open', 'pending', 'in_progress', 'processing'];
const EXTRA_MINUTES_DEDUPE_MS = 10 * 60 * 1000;

function response(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function clean(value, maxLength = 160) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function publicRequest(row) {
  if (!row) return null;
  return {
    id: clean(row.id, 100),
    type: clean(row.case_type, 60) || 'plan_upgrade',
    status: clean(row.status, 40) || 'open',
    title: clean(row.title, 180),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function findActivePlanRequest(sbAdmin, customerId) {
  const { data, error } = await sbAdmin
    .from('voxera_cases')
    .select('id,title,status,case_type,source,created_at,updated_at')
    .eq('customer_id', customerId)
    .eq('source', 'customer_commercial_request')
    .eq('case_type', 'plan_upgrade')
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error) return data || null;

  const message = `${error.message || ''} ${error.details || ''}`.toLowerCase();
  if (!message.includes('column') && error.code !== '42703' && error.code !== 'PGRST204') throw error;

  const legacy = await sbAdmin
    .from('voxera_cases')
    .select('id,title,status,created_at,updated_at')
    .eq('customer_id', customerId)
    .in('status', ACTIVE_STATUSES)
    .or('title.ilike.Planwechsel%,title.ilike.Enterprise%')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (legacy.error) throw legacy.error;
  return legacy.data ? { ...legacy.data, case_type: 'plan_upgrade' } : null;
}

async function findRecentExtraMinutesRequest(sbAdmin, customerId, minutes) {
  const since = new Date(Date.now() - EXTRA_MINUTES_DEDUPE_MS).toISOString();
  const title = `${minutes} Zusatzminuten anfragen`;
  const { data, error } = await sbAdmin
    .from('voxera_cases')
    .select('id,title,status,case_type,source,created_at,updated_at')
    .eq('customer_id', customerId)
    .eq('title', title)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) return response(405, { error: 'Method not allowed' });

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

  if (event.httpMethod === 'GET') {
    try {
      const activePlanRequest = await findActivePlanRequest(sbAdmin, guard.customerId);
      return response(200, {
        ok: true,
        active_plan_request: publicRequest(activePlanRequest)
      });
    } catch (error) {
      console.error('[customer-commercial-request] status lookup failed', error);
      return response(500, { error: 'Anfragestatus konnte nicht geladen werden', code: 'commercial_status_failed' });
    }
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Invalid JSON', code: 'invalid_json' });
  }

  const type = clean(body.type, 40).toLowerCase();
  const requestId = clean(body.request_id, 100) || crypto.randomUUID();
  const activeContract = (guard.contractState && guard.contractState.activeContract)
    || (guard.contractState && guard.contractState.effectiveContract)
    || null;
  const currentPlan = clean(activeContract && activeContract.plan, 60).toLowerCase() || 'unbekannt';
  let title = '';
  let note = '';

  try {
    if (type === 'plan_upgrade') {
      const existing = await findActivePlanRequest(sbAdmin, guard.customerId);
      if (existing) {
        return response(200, {
          ok: true,
          duplicate: true,
          active_request: publicRequest(existing),
          message: 'Ihre bestehende Anfrage wird bereits bearbeitet.'
        });
      }

      const targetPlan = clean(body.target_plan, 60).toLowerCase();
      if (!ALLOWED_PLANS.has(targetPlan)) {
        return response(400, { error: 'Ungültiger Zielplan', code: 'invalid_target_plan' });
      }
      if (targetPlan === currentPlan) {
        return response(409, { error: 'Dieser Plan ist bereits aktiv', code: 'plan_already_active' });
      }

      const planLabels = {
        starter: 'Starter',
        business: 'Business',
        professional: 'Professional',
        enterprise: 'Enterprise'
      };
      const isEnterprise = targetPlan === 'enterprise';
      title = isEnterprise ? 'Enterprise-Beratung anfragen' : `Planwechsel auf ${planLabels[targetPlan]}`;
      note = [
        'Kundenanfrage aus dem Customer Portal',
        `Aktueller Plan: ${planLabels[currentPlan] || currentPlan}`,
        `Gewünschte Lösung: ${planLabels[targetPlan]}`,
        isEnterprise
          ? 'Bedarf: höheres Volumen oder individuelle Anforderungen. Beratung zu Volumen, Standorten, Integrationen, Support und Konditionen durchführen.'
          : `Abrechnungsrhythmus beibehalten: ${body.keep_billing_cycle === false ? 'Nein' : 'Ja'}`,
        isEnterprise
          ? 'Enterprise wird nicht automatisch aktiviert. Kunde kontaktieren, Bedarf qualifizieren und individuelles Angebot erstellen.'
          : 'Der Kunde hat die Bestellung im Portal bestätigt. Planwechsel gemäss internem Prozess ausführen.'
      ].join('\n');
    } else if (type === 'extra_minutes') {
      const minutes = Number(body.minutes);
      if (!ALLOWED_MINUTES.has(minutes)) {
        return response(400, { error: 'Ungültiges Minutenpaket', code: 'invalid_minutes_package' });
      }

      const recent = await findRecentExtraMinutesRequest(sbAdmin, guard.customerId, minutes);
      if (recent) {
        return response(200, {
          ok: true,
          duplicate: true,
          active_request: publicRequest(recent),
          message: 'Diese Bestellung wurde bereits übermittelt.'
        });
      }

      title = `${minutes} Zusatzminuten anfragen`;
      note = [
        'Kundenbestellung aus dem Customer Portal',
        `Plan: ${currentPlan}`,
        `Gewünschtes Paket: ${minutes} Minuten`,
        'Zusatzminuten gemäss aktuellem Übergangsprozess aktivieren und verrechnen.',
        'Zahlungs- und Rechnungsprozess wird später durch den finalen Payment-Flow ersetzt.'
      ].join('\n');
    } else {
      return response(400, { error: 'Ungültiger Anfragetyp', code: 'invalid_request_type' });
    }

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
      active_request: publicRequest(caseRow),
      message: type === 'extra_minutes'
        ? 'Ihre Bestellung wurde übermittelt.'
        : 'Ihre Anfrage wurde übermittelt.'
    });
  } catch (error) {
    console.error('[customer-commercial-request] failed', error);
    return response(500, { error: 'Anfrage konnte nicht gespeichert werden', code: 'commercial_request_failed' });
  }
};
