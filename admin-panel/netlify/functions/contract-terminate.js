'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const text = value => String(value == null ? '' : value).trim();

function normalizeTerminationType(value) {
  const raw = text(value).toLowerCase();
  if (['ordinary', 'scheduled', 'ordentlich'].includes(raw)) return 'ordinary';
  if (['pre_start', 'before_start', 'annulled'].includes(raw)) return 'pre_start';
  return 'extraordinary';
}

function effectiveDate(value, type) {
  const raw = text(value);
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (type === 'ordinary') return null;
  return new Date().toISOString();
}

async function loadOpenInvoices(sb, contractId) {
  const { data, error } = await sb
    .from('invoices')
    .select('id, invoice_number, status, total, total_amount, amount, due_date, created_at')
    .eq('contract_id', contractId)
    .not('status', 'in', '(paid,cancelled,void,credited)')
    .order('created_at', { ascending:false });
  if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return response(405, { error:'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error:'Supabase-Konfiguration fehlt.' });

  const sb = createClient(sbUrl, sbServiceKey, { auth:{ autoRefreshToken:false, persistSession:false } });
  const caller = await requireAdminCaller({
    event,
    supabaseUrl:sbUrl,
    supabaseAnonKey:sbAnonKey,
    sbAdmin:sb,
    requiredCapability:'contract:write'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return response(400, { error:'Ungültiger Request Body.' }); }

  const payload = body.payload && typeof body.payload === 'object' ? body.payload : body;
  const contractId = text(payload.contract_id || body.contract_id);
  if (!contractId) return response(400, { error:'contract_id ist erforderlich.' });

  const type = normalizeTerminationType(payload.termination_type);
  const reason = text(payload.termination_reason || payload.reason || payload.notes) || null;
  const effectiveAt = effectiveDate(payload.termination_effective_at || payload.effective_at || payload.end_date, type);

  const { data:contract, error:contractError } = await sb
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();
  if (contractError) return response(400, { error:contractError.message });
  if (!contract) return response(404, { error:'Vertrag nicht gefunden.' });

  const now = new Date();
  const effective = effectiveAt ? new Date(effectiveAt) : null;
  const scheduled = type === 'ordinary' && effective && effective.getTime() > now.getTime();
  const immediate = !scheduled;

  const contractPatch = {
    termination_type:type,
    termination_status:scheduled ? 'scheduled' : 'effective',
    termination_effective_at:effectiveAt,
    termination_reason:reason,
    terminated_at:immediate ? now.toISOString() : null,
    terminated_by:caller.userId || null,
    updated_at:now.toISOString()
  };
  if (immediate) contractPatch.status = 'cancelled';

  const { data:updatedContract, error:updateError } = await sb
    .from('contracts')
    .update(contractPatch)
    .eq('id', contractId)
    .select('*')
    .single();
  if (updateError) return response(400, { error:updateError.message });

  if (contract.customer_id) {
    const subscriptionPatch = {
      subscription_status: scheduled ? 'active' : 'cancelled',
      updated_at:now.toISOString()
    };
    await sb.from('subscriptions').update(subscriptionPatch).eq('customer_id', contract.customer_id);

    if (immediate) {
      const { data:otherActive } = await sb
        .from('contracts')
        .select('id')
        .eq('customer_id', contract.customer_id)
        .neq('id', contractId)
        .in('status', ['active','signed','pending','suspended'])
        .limit(1);

      if (!Array.isArray(otherActive) || otherActive.length === 0) {
        await sb.from('customers').update({
          operational_status:'terminated',
          operational_ended_at:now.toISOString(),
          operational_end_reason:reason || type,
          updated_at:now.toISOString()
        }).eq('id', contract.customer_id);
      }
    }
  }

  const openInvoices = await loadOpenInvoices(sb, contractId);

  await sb.from('commercial_lifecycle_audit').insert({
    actor_admin_id:caller.userId || null,
    actor_role:caller.role || null,
    action:'contracts.terminate',
    customer_id:contract.customer_id || null,
    contract_id:contractId,
    previous_state:{ contract },
    next_state:{ contract:updatedContract },
    metadata:{
      termination_type:type,
      termination_status:scheduled ? 'scheduled' : 'effective',
      termination_effective_at:effectiveAt,
      open_invoice_ids:openInvoices.map(item => item.id)
    },
    happened_at:now.toISOString()
  });

  return response(200, {
    ok:true,
    contract:updatedContract,
    termination:{ type, scheduled, effective_at:effectiveAt, reason },
    open_invoices:openInvoices,
    finance_action_required:openInvoices.length > 0,
    message: scheduled
      ? 'Kündigung wurde per Datum vorgemerkt. Der Kunde bleibt bis zum Wirksamkeitsdatum operativ aktiv.'
      : (openInvoices.length
          ? 'Vertrag wurde beendet. Offene Rechnungen bleiben als Forderungen bestehen und müssen separat beurteilt werden.'
          : 'Vertrag wurde beendet und der Kunde operativ deaktiviert.')
  });
};
