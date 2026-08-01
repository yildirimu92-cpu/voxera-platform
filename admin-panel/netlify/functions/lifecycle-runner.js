'use strict';

const { createClient } = require('@supabase/supabase-js');

const headers = { 'Content-Type': 'application/json; charset=utf-8' };
const ACTIVE_CONTRACT_STATUSES = ['active', 'signed', 'pending', 'suspended'];

function respond(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function asDateOnly(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

async function hasOtherActiveContract(sb, customerId, contractId) {
  const { data, error } = await sb
    .from('contracts')
    .select('id')
    .eq('customer_id', customerId)
    .neq('id', contractId)
    .in('status', ACTIVE_CONTRACT_STATUSES)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function loadCustomer(sb, customerId) {
  if (!customerId) return null;
  const { data, error } = await sb
    .from('customers')
    .select('id, customer_name, contact_name, email, status, operational_status')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function sendExpiryMail(webhookUrl, contract, customer) {
  if (!webhookUrl || !customer?.email) {
    return { attempted: false, accepted: false, reason: !webhookUrl ? 'webhook_missing' : 'email_missing' };
  }

  const payload = {
    event_type: 'contract_expired_email',
    mail_type: 'contract_expired_email',
    recipient: {
      email: customer.email,
      name: customer.contact_name || customer.customer_name || contract.customer_name || 'Kunde'
    },
    customer: {
      id: customer.id,
      name: customer.customer_name || contract.customer_name || null
    },
    contract: {
      id: contract.id,
      customer_name: contract.customer_name || customer.customer_name || null,
      plan: contract.plan || null,
      end_date: contract.end_date || contract.termination_effective_at || null,
      status: 'expired'
    },
    meta: {
      source: 'lifecycle_runner',
      requested_at: nowIso()
    }
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return {
      attempted: true,
      accepted: response.ok,
      status: response.status,
      reason: response.ok ? null : 'webhook_rejected'
    };
  } catch (error) {
    return { attempted: true, accepted: false, status: null, reason: error?.message || 'webhook_failed' };
  }
}

async function audit(sb, entry) {
  const { error } = await sb.from('commercial_lifecycle_audit').insert(entry);
  if (error) console.warn('[lifecycle-runner] audit insert failed', { error: error.message, action: entry.action });
}

async function expireContract({ sb, contract, enforcementEnabled, webhookUrl, runAt }) {
  const customer = await loadCustomer(sb, contract.customer_id);
  const otherActive = contract.customer_id
    ? await hasOtherActiveContract(sb, contract.customer_id, contract.id)
    : false;

  const result = {
    contract_id: contract.id,
    customer_id: contract.customer_id || null,
    previous_status: contract.status || null,
    other_active_contract: otherActive,
    preview: !enforcementEnabled,
    mail: null
  };

  if (!enforcementEnabled) return result;

  const contractPatch = {
    status: 'expired',
    termination_status: contract.termination_status === 'scheduled' ? 'effective' : contract.termination_status,
    terminated_at: contract.terminated_at || runAt,
    updated_at: runAt
  };

  const { data: updatedContract, error: contractError } = await sb
    .from('contracts')
    .update(contractPatch)
    .eq('id', contract.id)
    .in('status', ACTIVE_CONTRACT_STATUSES)
    .select('*')
    .maybeSingle();

  if (contractError) throw contractError;
  if (!updatedContract) {
    result.skipped = 'status_changed_concurrently';
    return result;
  }

  if (contract.customer_id) {
    await sb.from('subscriptions').update({
      subscription_status: otherActive ? 'active' : 'expired',
      updated_at: runAt
    }).eq('customer_id', contract.customer_id);

    if (!otherActive) {
      await sb.from('customers').update({
        operational_status: 'terminated',
        operational_ended_at: runAt,
        operational_end_reason: 'contract_expired',
        updated_at: runAt
      }).eq('id', contract.customer_id);
    }
  }

  result.mail = await sendExpiryMail(webhookUrl, updatedContract, customer);

  await audit(sb, {
    actor_admin_id: null,
    actor_role: 'system',
    action: 'contracts.expire',
    customer_id: contract.customer_id || null,
    contract_id: contract.id,
    previous_state: { contract },
    next_state: { contract: updatedContract },
    metadata: {
      source: 'scheduled_lifecycle_runner',
      other_active_contract: otherActive,
      customer_operationally_ended: Boolean(contract.customer_id && !otherActive),
      mail_delivery: result.mail
    },
    happened_at: runAt
  });

  result.updated_status = updatedContract.status;
  return result;
}

exports.handler = async () => {
  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) return respond(500, { ok: false, error: 'supabase_configuration_missing' });

  const enforcementEnabled = process.env.LIFECYCLE_ENFORCEMENT_ENABLED === 'true';
  const webhookUrl = process.env.MAKE_MAIL_WEBHOOK || '';
  const sb = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const runAt = nowIso();
  const today = asDateOnly(runAt);

  const { data: candidates, error } = await sb
    .from('contracts')
    .select('*')
    .in('status', ACTIVE_CONTRACT_STATUSES)
    .or(`end_date.lt.${today},and(termination_status.eq.scheduled,termination_effective_at.lte.${runAt})`)
    .order('end_date', { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) {
    console.error('[lifecycle-runner] candidate lookup failed', { error: error.message });
    return respond(500, { ok: false, error: 'candidate_lookup_failed' });
  }

  const results = [];
  for (const contract of candidates || []) {
    try {
      results.push(await expireContract({ sb, contract, enforcementEnabled, webhookUrl, runAt }));
    } catch (error) {
      console.error('[lifecycle-runner] contract processing failed', {
        contract_id: contract.id,
        error: error?.message || String(error)
      });
      results.push({ contract_id: contract.id, ok: false, error: error?.message || 'processing_failed' });
    }
  }

  const summary = {
    ok: true,
    enforcement_enabled: enforcementEnabled,
    run_at: runAt,
    candidates: candidates?.length || 0,
    processed: results.filter(item => item.updated_status === 'expired').length,
    previewed: results.filter(item => item.preview).length,
    failed: results.filter(item => item.ok === false).length,
    results
  };

  console.log('[lifecycle-runner] completed', summary);
  return respond(200, summary);
};

exports._test = {
  asDateOnly,
  ACTIVE_CONTRACT_STATUSES
};
