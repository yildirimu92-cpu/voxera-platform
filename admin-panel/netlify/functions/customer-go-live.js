'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { normalizePlanCode } = require('./_lib/plan-config');
const { STATUS, normalizeCustomerStatus, normalizeOnboardingStatus } = require('./_lib/status-model');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const MASTER_FIELDS = ['customer_name', 'email', 'street', 'zip', 'city', 'country', 'plan'];
const AI_FIELDS = ['ai_business_description', 'ai_services', 'ai_instructions', 'ai_fallback_escalation'];
const ACTIVE_CONTRACT_STATUSES = new Set(['active', 'signed']);
const REQUIRED_MANUAL_CHECKS = [
  'commercial_terms_confirmed',
  'contact_and_escalation_confirmed',
  'privacy_configured',
  'assistant_reviewed',
  'technical_sync_tested',
  'required_scenarios_passed',
  'portal_owner_confirmed'
];

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function textValue(value) {
  return String(value == null ? '' : value).trim();
}

function missingMasterFields(customer) {
  return MASTER_FIELDS.filter((field) => {
    if (field === 'customer_name') return !textValue(customer.customer_name || customer.name);
    if (field === 'plan') return !normalizePlanCode(customer.plan_code || customer.plan || '');
    return !textValue(customer[field]);
  });
}

function missingAiFields(customer) {
  return AI_FIELDS.filter((field) => !textValue(customer[field]));
}

function hasAssignedNumber(customer) {
  const value = textValue(customer.voxera_number);
  return Boolean(value && !/zuweisung offen|pending|nicht zugewiesen/i.test(value));
}

function normalizeChecks(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  REQUIRED_MANUAL_CHECKS.forEach((key) => { out[key] = source[key] === true; });
  out.calendar_required = source.calendar_required === true;
  out.calendar_tested = source.calendar_tested === true;
  return out;
}

function missingManualChecks(checks) {
  const missing = REQUIRED_MANUAL_CHECKS.filter((key) => checks[key] !== true);
  if (checks.calendar_required && !checks.calendar_tested) missing.push('calendar_tested');
  return missing;
}

async function loadCustomerContext(sbAdmin, customerId) {
  const customerResult = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (customerResult.error) throw new Error('Customer lookup failed: ' + customerResult.error.message);
  if (!customerResult.data) return null;

  const [onboardingResult, contractsResult, offersResult, syncResult] = await Promise.all([
    sbAdmin.from('onboarding').select('*').eq('customer_id', customerId).maybeSingle(),
    sbAdmin.from('contracts').select('id, status, updated_at').eq('customer_id', customerId).order('updated_at', { ascending: false }).limit(50),
    sbAdmin.from('offers').select('id, status, accepted_at, contract_id, updated_at').eq('customer_id', customerId).order('updated_at', { ascending: false }).limit(50),
    sbAdmin.from('elevenlabs_sync_log')
      .select('id, agent_id, status, triggered_by, prompt_length, error_message, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
  ]);

  if (onboardingResult.error) throw new Error('Onboarding lookup failed: ' + onboardingResult.error.message);
  if (contractsResult.error) throw new Error('Contract lookup failed: ' + contractsResult.error.message);
  if (offersResult.error) throw new Error('Offer lookup failed: ' + offersResult.error.message);
  if (syncResult.error) throw new Error('Sync lookup failed: ' + syncResult.error.message);

  const contracts = Array.isArray(contractsResult.data) ? contractsResult.data : [];
  const offers = Array.isArray(offersResult.data) ? offersResult.data : [];
  const acceptedOffers = offers.filter((offer) => {
    const status = textValue(offer.status).toLowerCase();
    return status === 'accepted' || Boolean(offer.accepted_at);
  });
  const activeContracts = contracts.filter((contract) =>
    ACTIVE_CONTRACT_STATUSES.has(textValue(contract.status).toLowerCase())
  );
  const acceptedOfferLinkedToActiveContract = acceptedOffers.find((offer) =>
    activeContracts.some((contract) => textValue(contract.id) === textValue(offer.contract_id))
  ) || null;

  return {
    customer: customerResult.data,
    onboarding: onboardingResult.data || null,
    contracts,
    acceptedOffers,
    activeContracts,
    acceptedOfferLinkedToActiveContract,
    latestSync: Array.isArray(syncResult.data) ? (syncResult.data[0] || null) : null
  };
}

function syncEvidence(context) {
  const customer = context.customer;
  const currentAgentId = textValue(customer.elevenlabs_agent_id);
  const customerStatus = textValue(customer.elevenlabs_sync_status).toLowerCase();
  const customerLastSync = customer.elevenlabs_last_sync_at || null;
  const latest = context.latestSync || null;
  const latestStatus = textValue(latest?.status).toLowerCase();
  const latestAgentId = textValue(latest?.agent_id);
  const agentMatches = Boolean(currentAgentId && latestAgentId && currentAgentId === latestAgentId);
  const success = Boolean(
    currentAgentId &&
    customerStatus === 'success' &&
    customerLastSync &&
    latest &&
    latestStatus === 'success' &&
    agentMatches
  );

  return {
    success,
    customer_status: customerStatus || 'never',
    customer_last_sync_at: customerLastSync,
    current_agent_id: currentAgentId || null,
    latest_log_status: latestStatus || null,
    latest_log_at: latest?.created_at || null,
    latest_log_agent_id: latestAgentId || null,
    latest_log_error: latest?.error_message || null,
    latest_prompt_length: latest?.prompt_length ?? null,
    agent_matches: agentMatches
  };
}

function buildTechnicalGate(context) {
  const blockers = [];
  const missingFields = missingMasterFields(context.customer);
  const missingAi = missingAiFields(context.customer);
  const sync = syncEvidence(context);

  if (missingFields.length) blockers.push('Pflicht-Stammdaten fehlen: ' + missingFields.join(', '));
  if (!context.acceptedOffers.length) blockers.push('Keine akzeptierte Offerte vorhanden.');
  if (!context.activeContracts.length) blockers.push('Kein startbereiter Vertrag vorhanden (active/signed).');
  if (context.acceptedOffers.length && context.activeContracts.length && !context.acceptedOfferLinkedToActiveContract) {
    blockers.push('Akzeptierte Offerte ist nicht mit einem startbereiten Vertrag verknüpft.');
  }
  if (!context.onboarding) {
    blockers.push('Onboarding-Datensatz fehlt.');
  } else if (normalizeOnboardingStatus(context.onboarding.status) === STATUS.onboarding.BLOCKED) {
    blockers.push('Onboarding ist blockiert.');
  }
  if (!hasAssignedNumber(context.customer)) blockers.push('Voxera-Rufnummer ist nicht zugewiesen.');
  if (!textValue(context.customer.elevenlabs_agent_id)) blockers.push('ElevenLabs Agent-ID fehlt.');
  if (missingAi.length) blockers.push('Kritische AI-Konfiguration fehlt: ' + missingAi.join(', '));

  if (textValue(context.customer.elevenlabs_agent_id) && !sync.success) {
    if (sync.customer_status === 'failed') {
      blockers.push('Der letzte ElevenLabs-Sync ist fehlgeschlagen.');
    } else if (!sync.customer_last_sync_at || !context.latestSync) {
      blockers.push('Für den aktuellen ElevenLabs-Agenten ist noch kein erfolgreicher Sync dokumentiert.');
    } else if (!sync.agent_matches) {
      blockers.push('Der letzte Sync gehört nicht zur aktuell zugewiesenen ElevenLabs Agent-ID.');
    } else if (sync.latest_log_status !== 'success') {
      blockers.push('Der letzte dokumentierte ElevenLabs-Sync war nicht erfolgreich.');
    } else {
      blockers.push('ElevenLabs-Sync ist nicht als erfolgreich bestätigt.');
    }
  }

  const evidence = {
    master_data_complete: missingFields.length === 0,
    accepted_offer_present: context.acceptedOffers.length > 0,
    active_contract_present: context.activeContracts.length > 0,
    offer_contract_linked: Boolean(context.acceptedOfferLinkedToActiveContract),
    onboarding_present: Boolean(context.onboarding),
    onboarding_status: context.onboarding ? normalizeOnboardingStatus(context.onboarding.status) : null,
    voxera_number_assigned: hasAssignedNumber(context.customer),
    elevenlabs_agent_assigned: Boolean(textValue(context.customer.elevenlabs_agent_id)),
    elevenlabs_sync_confirmed: sync.success,
    ai_configuration_complete: missingAi.length === 0,
    sync
  };

  return {
    allow: blockers.length === 0,
    hard_blockers: blockers,
    missing_fields: missingFields,
    missing_ai_fields: missingAi,
    evidence
  };
}

function paymentWarnings(customer) {
  const status = textValue(customer.payment_status || 'none').toLowerCase();
  if (status === 'paid') return [];
  return ['Setup-Gebühr ist noch nicht als bezahlt markiert. Dies ist eine Warnung und blockiert die Freigabe nicht.'];
}

function readinessPayload(context) {
  const gate = buildTechnicalGate(context);
  const storedChecks = normalizeChecks(context.customer.go_live_checks);
  const missingChecks = missingManualChecks(storedChecks);
  const lifecycleStatus = normalizeCustomerStatus(context.customer.status);
  const approved = Boolean(context.customer.go_live_approved_at && context.customer.go_live_approved_by);
  const activated = [STATUS.customer.ACTIVATED, STATUS.customer.PAUSED, STATUS.customer.LIVE].includes(lifecycleStatus);

  return {
    success: true,
    customer_id: context.customer.id,
    customer_status: lifecycleStatus,
    onboarding_status: context.onboarding ? normalizeOnboardingStatus(context.onboarding.status) : null,
    technical_gate: gate,
    stored_checks: storedChecks,
    missing_checks: missingChecks,
    warnings: paymentWarnings(context.customer),
    approved,
    activated,
    can_approve: gate.allow && missingChecks.length === 0,
    can_go_live: gate.allow && missingChecks.length === 0 && approved && activated
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'Supabase-Konfiguration fehlt auf dem Server.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireAdminCaller({
    event,
    supabaseUrl: sbUrl,
    supabaseAnonKey: sbAnonKey,
    sbAdmin,
    requiredCapability: 'lifecycle:approve'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return response(400, { error: 'Ungültiger Request Body.' });
  }

  const action = textValue(body.action || 'approve').toLowerCase();
  const customerId = textValue(body.customer_id);
  const note = textValue(body.note) || null;
  if (!customerId) return response(400, { error: 'customer_id fehlt.' });
  if (!['check', 'approve', 'go_live'].includes(action)) return response(400, { error: 'Unbekannte Go-live-Aktion.' });

  let context;
  try {
    context = await loadCustomerContext(sbAdmin, customerId);
  } catch (error) {
    return response(500, { error: 'Go-live-Kontext konnte nicht geladen werden.', details: error.message });
  }
  if (!context) return response(404, { error: 'Kunde nicht gefunden.' });

  if (action === 'check') return response(200, readinessPayload(context));

  const lifecycleStatus = normalizeCustomerStatus(context.customer.status);
  if (action === 'approve') {
    const checks = normalizeChecks(body.checks);
    const gate = buildTechnicalGate(context);
    const missingChecks = missingManualChecks(checks);
    if (missingChecks.length) {
      gate.hard_blockers.push('Manuelle Freigabeprüfungen fehlen: ' + missingChecks.join(', '));
      gate.allow = false;
    }
    if (!gate.allow) {
      return response(409, {
        error: 'Admin-Freigabe ist blockiert.',
        hard_blockers: gate.hard_blockers,
        missing_fields: gate.missing_fields,
        missing_ai_fields: gate.missing_ai_fields,
        missing_checks: missingChecks,
        evidence: gate.evidence,
        warnings: paymentWarnings(context.customer)
      });
    }

    const sameChecks = JSON.stringify(context.customer.go_live_checks || {}) === JSON.stringify(checks);
    const sameNote = textValue(context.customer.go_live_approval_note) === textValue(note);
    if (context.customer.go_live_approved_at && sameChecks && sameNote) {
      return response(200, {
        success: true,
        duplicate: true,
        message: 'Admin-Freigabe war bereits identisch dokumentiert.',
        customer: context.customer,
        onboarding: context.onboarding,
        evidence: gate.evidence,
        warnings: paymentWarnings(context.customer)
      });
    }

    const rpcResult = await sbAdmin.rpc('admin_approve_customer_go_live', {
      p_customer_id: customerId,
      p_actor_user_id: caller.userId,
      p_actor_role: caller.role,
      p_note: note,
      p_checks: checks
    });
    if (rpcResult.error) {
      return response(409, { error: 'Admin-Freigabe konnte nicht gespeichert werden.', details: rpcResult.error.message });
    }

    const refreshed = await loadCustomerContext(sbAdmin, customerId);
    return response(200, {
      success: true,
      message: 'Admin-Freigabe dokumentiert. Der Kundenzugang kann jetzt gesendet werden.',
      customer: refreshed.customer,
      onboarding: refreshed.onboarding,
      readiness: readinessPayload(refreshed),
      warnings: paymentWarnings(refreshed.customer)
    });
  }

  if (lifecycleStatus === STATUS.customer.LIVE) {
    return response(200, {
      success: true,
      duplicate: true,
      message: 'Kunde ist bereits live.',
      customer: context.customer,
      onboarding: context.onboarding
    });
  }
  if (!context.customer.go_live_approved_at || !context.customer.go_live_approved_by) {
    return response(409, { error: 'Dokumentierte Admin-Freigabe fehlt.' });
  }

  const finalGate = buildTechnicalGate(context);
  const storedChecks = normalizeChecks(context.customer.go_live_checks);
  const missingStoredChecks = missingManualChecks(storedChecks);
  if (!finalGate.allow || missingStoredChecks.length) {
    return response(409, {
      error: 'Go-live-Gate ist seit der Freigabe nicht mehr vollständig erfüllt.',
      hard_blockers: finalGate.hard_blockers,
      missing_checks: missingStoredChecks,
      evidence: finalGate.evidence,
      warnings: paymentWarnings(context.customer)
    });
  }

  if (![STATUS.customer.ACTIVATED, STATUS.customer.PAUSED].includes(lifecycleStatus)) {
    return response(409, {
      error: 'Kundenzugang muss vor dem Go-live aktiviert sein.',
      customer_status: lifecycleStatus
    });
  }

  const rpcResult = await sbAdmin.rpc('admin_activate_customer_go_live', {
    p_customer_id: customerId,
    p_actor_user_id: caller.userId,
    p_actor_role: caller.role,
    p_note: note
  });
  if (rpcResult.error) {
    return response(409, { error: 'Go-live konnte nicht gespeichert werden.', details: rpcResult.error.message });
  }

  const refreshed = await loadCustomerContext(sbAdmin, customerId);
  return response(200, {
    success: true,
    message: 'Kunde wurde manuell live geschaltet.',
    customer: refreshed.customer,
    onboarding: refreshed.onboarding,
    readiness: readinessPayload(refreshed),
    warnings: paymentWarnings(refreshed.customer)
  });
};
