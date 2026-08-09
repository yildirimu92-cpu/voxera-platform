'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const { sanitizeOpeningHours } = require('./_lib/opening-hours');
const { sanitizeServiceList, sanitizeFaqList } = require('./_lib/service-faq');
const { normalizePhoneE164 } = require('./_lib/phone-normalize');
const { FORWARDING_FIELDS, canEditForwarding, needsPromptSync } = require('./_lib/assistant-write-policy');

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

const BLOCKED_CUSTOMER_FIELDS = ['ai_instructions', 'ai_fallback_escalation', 'ai_response_constraints'];
const PLAN_TIERS = { starter: 1, business: 2, professional: 3 };

function buildContractPayload(extra) {
  return {
    success: false,
    errors: [],
    blocked_fields: [],
    sync_status: 'skipped_no_sync_fields',
    sync_error: null,
    ...extra
  };
}

function text(value, maxLength) {
  const normalized = String(value ?? '').trim();
  return (maxLength ? normalized.slice(0, maxLength) : normalized) || null;
}

// Branchenfelder (I8). Die erlaubten Schluessel kommen ausschliesslich aus der
// zugeordneten Branchenvorlage — der Browser bestimmt nicht, was gespeichert
// wird. Das ist keine Formalie: seit Prompt-Builder 2.2 werden diese Antworten
// zu Prompt-Variablen, ein freier Schluessel waere damit eine Schreibberechtigung
// auf den Prompt.
const BRANCH_TEXT_LIMIT = 400;

// J4 / Schicht A. Der Schreibpfad benutzt bewusst dieselbe Bauform wie die
// Branchenfelder: erlaubte Schluessel und Optionen kommen aus dem Schema, der
// Browser bestimmt nichts. Ein Unterschied ist entscheidend — das Ziel ist eine
// typisierte Spalte, und WELCHE Spalte beschrieben werden darf, steht hier im
// Code und nicht im Schema. Sonst waere eine Zeile in system_config eine
// Schreibberechtigung auf plan_code, status oder elevenlabs_agent_id.
// Dieselbe Liste steht in _lib/prompt-builder-v2.js und in
// customer-assistant-profile.js; die drei gehoeren zusammen gepflegt.
const CORE_FIELD_COLUMNS = new Set([
  'sprechstunden_modus', 'ai_appointment_mode', 'ai_online_booking_url', 'ai_opening_hours',
  // J6
  'ai_short_description', 'ai_public_address', 'ai_target_groups', 'ai_service_area',
  'ai_arrival_note', 'ai_visit_preparation',
  'ai_pricing_mode', 'ai_pricing_amount', 'ai_pricing_unit', 'ai_pricing_validity',
  // J7
  'ai_service_list', 'ai_faq_list',
  // E1: Regeln rund um Termine. Bis hierher lagen sie als Regelzeilen im
  // Freitext ai_booking_faq und waeren beim Bestaetigen der FAQ-Liste aus dem
  // Prompt verschwunden.
  'ai_appointment_rules'
]);
const CORE_TEXT_LIMIT = 400;
// Ein Feld darf sein Limit im Schema anheben ("max"), aber nicht beliebig: eine
// Zeile in system_config waere sonst ein unbegrenztes Schreibrecht. Gleiche
// Begruendung wie bei CORE_FIELD_COLUMNS -- das Schema bestimmt die Frage, der
// Code die Grenzen.
const CORE_TEXT_HARD_LIMIT = 2000;

// E3: Felder, die nur der Admin-Wizard stellt. Der Filter greift hier im
// Schreibpfad und nicht nur in der Darstellung -- eine Sperre, die allein im
// Formular sitzt, umgeht ein direkter POST.
const ADMIN_ONLY_AUDIENCE = 'admin';

function coreTextLimit(field) {
  const raw = Number(field?.max);
  if (!Number.isFinite(raw) || raw <= 0) return CORE_TEXT_LIMIT;
  return Math.min(Math.floor(raw), CORE_TEXT_HARD_LIMIT);
}

// Alle Spalten, die dieser Endpoint schreiben kann. Sie werden vor dem Patch
// gelesen, damit der Sync `prev_values` mitbekommt und `changed_fields` im
// elevenlabs_sync_log sagen kann, welches Feld ihn ausgeloest hat (S9). Ohne
// das ist aus den Daten nur ablesbar, *dass* ein Sync lief. Schicht A gehoert
// dazu, obwohl sie ueber Object.assign(patch, corePatch) schreibt — sonst
// stuende dort null statt des tatsaechlichen Vorzustands.
const WRITABLE_FIELDS = [
  'assistant_name', 'voice_id', 'ai_business_description', 'ai_services',
  'ai_location_hours', 'ai_booking_faq', 'ai_greeting', 'ai_tone', 'ai_address_form',
  'ai_branch_extra', 'notification_mode', 'sms_notify_enabled', 'sms_notify_trigger',
  'sms_notify_number', 'sms_caller_enabled', 'sms_caller_trigger', 'sms_caller_template',
  ...FORWARDING_FIELDS,
  ...CORE_FIELD_COLUMNS
];

function parseCoreSteps(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function coreFieldRules(steps) {
  const rules = new Map();
  (Array.isArray(steps) ? steps : []).forEach((step) => {
    (Array.isArray(step?.fields) ? step.fields : []).forEach((field) => {
      const key = String(field?.key || '').trim();
      const column = String(field?.column || '').trim();
      if (!/^[A-Za-z0-9_]+$/.test(key) || !CORE_FIELD_COLUMNS.has(column) || rules.has(key)) return;
      // E3: Ein Admin-Feld bekommt hier gar keine Regel. Damit landet es nicht
      // in `rules`, und sanitizeCoreFields weist es als unbekannten Schluessel
      // ab -- dieselbe Antwort wie auf einen frei erfundenen Schluessel.
      if (String(field?.audience || '').trim() === ADMIN_ONLY_AUDIENCE) return;
      const options = (Array.isArray(field?.options) ? field.options : [])
        .map((option) => String(option?.val || '').trim())
        .filter(Boolean);
      rules.set(key, { column, options, type: String(field?.type || 'text').trim(), limit: coreTextLimit(field) });
    });
  });
  return rules;
}

// Anders als bei den Branchenfeldern loescht ein leerer Wert hier ausdruecklich:
// jedes Feld hat eine eigene Spalte, "nicht gesetzt" ist ein gueltiger Zustand
// und muss zuruecknehmbar sein.
function sanitizeCoreFields(input, rules) {
  const patch = {};
  const rejected = [];
  Object.entries(input && typeof input === 'object' && !Array.isArray(input) ? input : {}).forEach(([key, value]) => {
    const rule = rules.get(key);
    if (!rule) {
      rejected.push(key);
      return;
    }
    // J5: Der Feldtyp `hours` traegt ein Wochenraster statt eines Wertes. Die
    // Pruefung dafuer steht in _lib/opening-hours.js und ist strenger als die
    // hiesige: Zeitformat, Ende nach Beginn, keine Ueberschneidungen. Ein
    // ungueltiges Raster wird abgewiesen, nicht zurechtgebogen -- aus einem
    // stillschweigend reparierten Zeitplan wuerde eine Auskunft am Telefon.
    if (rule.type === 'hours') {
      const { value: week, errors } = sanitizeOpeningHours(value === '' ? null : value);
      if (errors.length) {
        rejected.push(key);
        return;
      }
      patch[rule.column] = week;
      return;
    }
    // J7: Zwei weitere Feldtypen mit eigener Pruefung in _lib/service-faq.js --
    // eine Liste von Zeilen und eine Liste von Frage-Antwort-Paaren. Gleiche
    // Regel wie beim Wochenraster: Ein Feld mit einem Fehler wird ganz
    // abgewiesen, nicht zur Haelfte gespeichert. Eine Frage ohne Antwort waere
    // am Telefon eine Frage ohne Antwort.
    if (rule.type === 'list' || rule.type === 'faq') {
      const check = rule.type === 'list' ? sanitizeServiceList : sanitizeFaqList;
      const { value: list, errors } = check(value === '' ? null : value);
      if (errors.length) {
        rejected.push(key);
        return;
      }
      patch[rule.column] = list;
      return;
    }
    const cleaned = String(value ?? '').replace(/[{}]/g, '').trim().slice(0, rule.limit || CORE_TEXT_LIMIT);
    if (!cleaned) {
      patch[rule.column] = null;
      return;
    }
    if (rule.options.length && !rule.options.includes(cleaned)) {
      rejected.push(key);
      return;
    }
    patch[rule.column] = cleaned;
  });
  return { patch, rejected };
}

function branchFieldRules(steps) {
  const rules = new Map();
  (Array.isArray(steps) ? steps : []).forEach((step) => {
    (Array.isArray(step?.fields) ? step.fields : []).forEach((field) => {
      const key = String(field?.key || '').trim();
      if (!/^[A-Za-z0-9_]+$/.test(key)) return;
      const options = (Array.isArray(field?.options) ? field.options : [])
        .map((option) => String(option?.val || '').trim())
        .filter(Boolean);
      rules.set(key, { type: String(field?.type || 'text').trim(), options });
    });
  });
  return rules;
}

function sanitizeBranchExtra(input, rules) {
  const result = {};
  const rejected = [];
  Object.entries(input && typeof input === 'object' && !Array.isArray(input) ? input : {}).forEach(([key, value]) => {
    const rule = rules.get(key);
    if (!rule) {
      rejected.push(key);
      return;
    }
    // Geschweifte Klammern raus: sonst koennte eine Antwort einen Platzhalter
    // in den Branchen-Layer schreiben, den der Builder anschliessend aufloest.
    const cleaned = String(value ?? '').replace(/[{}]/g, '').trim().slice(0, BRANCH_TEXT_LIMIT);
    if (!cleaned) return;
    if (rule.options.length && !rule.options.includes(cleaned)) {
      rejected.push(key);
      return;
    }
    result[key] = cleaned;
  });
  return { values: result, rejected };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, buildContractPayload({ error: 'Method not allowed' }));

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, buildContractPayload({ error: 'supabase_env_missing' }));

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) {
    const callerBody = (caller && caller.body && typeof caller.body === 'object') ? caller.body : {};
    return response(caller.statusCode, buildContractPayload(callerBody));
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return response(400, buildContractPayload({ error: 'invalid_body' })); }

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select(['plan', 'plan_code', 'elevenlabs_agent_id', 'industry_template_id', ...WRITABLE_FIELDS].join(','))
    .eq('id', caller.customerId)
    .maybeSingle();
  if (customerError || !customer) return response(500, buildContractPayload({ error: 'customer_load_failed' }));

  const planCode = String(customer.plan_code || customer.plan || 'starter').toLowerCase();
  const currentTier = PLAN_TIERS[planCode] || PLAN_TIERS.starter;

  const { data: planCfg, error: planError } = await sbAdmin
    .from('plan_config')
    .select('allow_custom_assistant_name,voice_selection_enabled,allow_custom_tone')
    .eq('id', planCode)
    .maybeSingle();
  if (planError) return response(500, buildContractPayload({ error: 'plan_config_load_failed' }));

  const canEditName = planCfg?.allow_custom_assistant_name === true;
  const canEditVoice = planCfg?.voice_selection_enabled === true;
  const canEditTone = planCfg?.allow_custom_tone === true;
  const canEditForwardingOnPlan = canEditForwarding(planCode);

  const {
    voice_id,
    assistant_name,
    ai_business_description,
    ai_services,
    ai_location_hours,
    ai_booking_faq,
    ai_fallback_escalation,
    ai_response_constraints,
    ai_instructions,
    ai_greeting,
    ai_tone,
    ai_address_form,
    ai_forwarding_1_name,
    ai_forwarding_1_number,
    ai_forwarding_1_trigger,
    ai_forwarding_2_name,
    ai_forwarding_2_number,
    ai_forwarding_2_trigger,
    ai_emergency_number,
    ai_branch_extra,
    core_fields,
    notification_mode,
    sms_notify_enabled,
    sms_notify_trigger,
    sms_notify_number,
    sms_caller_enabled,
    sms_caller_trigger,
    sms_caller_template
  } = body;

  const patch = { updated_at: new Date().toISOString() };
  const errors = [];
  const blockedFields = [];

  if (ai_business_description !== undefined) patch.ai_business_description = text(ai_business_description, 6000);
  if (ai_services !== undefined) patch.ai_services = text(ai_services, 6000);
  if (ai_location_hours !== undefined) patch.ai_location_hours = text(ai_location_hours, 6000);
  if (ai_booking_faq !== undefined) patch.ai_booking_faq = text(ai_booking_faq, 6000);

  if (ai_fallback_escalation !== undefined) blockedFields.push('ai_fallback_escalation');
  if (ai_response_constraints !== undefined) blockedFields.push('ai_response_constraints');
  if (ai_instructions !== undefined) blockedFields.push('ai_instructions');
  if (blockedFields.length) errors.push('blocked_customer_fields_present');

  if (ai_greeting !== undefined) patch.ai_greeting = text(ai_greeting, 1000);
  // A1 (Etappe 6 / S3): Die Ton-Sperre wird hier durchgesetzt, nicht nur in der
  // Oberflaeche — vorher genuegte ein direkter Aufruf, um sie zu umgehen. Die
  // Regel selbst lebt in plan_config.allow_custom_tone, damit ein Freischalten
  // ein DB-Update ohne Deploy bleibt.
  // ai_address_form ist bewusst NICHT gesperrt: Sie oder Du ist eine Frage der
  // Grundhoeflichkeit, kein Premium-Merkmal.
  if (ai_tone !== undefined) {
    if (!canEditTone) {
      return response(403, buildContractPayload({ error: 'tone_not_allowed_on_plan', errors: ['tone_not_allowed_on_plan'] }));
    }
    patch.ai_tone = text(ai_tone, 120);
  }
  if (ai_address_form !== undefined) patch.ai_address_form = text(ai_address_form, 40);

  if (voice_id !== undefined) {
    if (!canEditVoice) {
      return response(403, buildContractPayload({ error: 'voice_not_allowed_on_plan', errors: ['voice_not_allowed_on_plan'] }));
    }
    const requestedVoiceId = String(voice_id || '').trim();
    if (!requestedVoiceId) return response(400, buildContractPayload({ error: 'voice_id_required' }));

    const { data: voice, error: voiceError } = await sbAdmin
      .from('voxera_voices')
      .select('voice_id,available_from_plan')
      .eq('voice_id', requestedVoiceId)
      .eq('is_active', true)
      .maybeSingle();
    if (voiceError) return response(500, buildContractPayload({ error: 'voices_load_failed' }));

    const requiredTier = PLAN_TIERS[String(voice?.available_from_plan || 'starter').toLowerCase()] || PLAN_TIERS.starter;
    if (!voice || requiredTier > currentTier) {
      return response(403, buildContractPayload({ error: 'voice_not_available_on_plan', errors: ['voice_not_available_on_plan'] }));
    }
    patch.voice_id = requestedVoiceId;
  }

  if (assistant_name !== undefined) {
    if (!canEditName) {
      return response(403, buildContractPayload({ error: 'assistant_name_not_allowed_on_plan', errors: ['assistant_name_not_allowed_on_plan'] }));
    }
    patch.assistant_name = text(assistant_name, 40);
  }

  if (notification_mode !== undefined) {
    const validModes = ['none', 'callback_only', 'all_calls'];
    if (validModes.includes(String(notification_mode))) patch.notification_mode = notification_mode;
  }

  if (sms_notify_enabled !== undefined) patch.sms_notify_enabled = Boolean(sms_notify_enabled);
  if (sms_notify_trigger !== undefined) patch.sms_notify_trigger = text(sms_notify_trigger, 80) || 'all';
  if (sms_notify_number !== undefined) patch.sms_notify_number = text(sms_notify_number, 40);
  if (sms_caller_enabled !== undefined) patch.sms_caller_enabled = Boolean(sms_caller_enabled);
  if (sms_caller_trigger !== undefined) patch.sms_caller_trigger = text(sms_caller_trigger, 80) || 'callback_only';
  if (sms_caller_template !== undefined) patch.sms_caller_template = text(sms_caller_template, 1000);

  const forwardingInput = {
    ai_forwarding_1_name, ai_forwarding_1_number, ai_forwarding_1_trigger,
    ai_forwarding_2_name, ai_forwarding_2_number, ai_forwarding_2_trigger,
    ai_emergency_number
  };
  if (FORWARDING_FIELDS.some((key) => forwardingInput[key] !== undefined)) {
    // Vorher lief die Plan-Sperre hier als weicher `errors`-Eintrag mit HTTP 200
    // durch, waehrend Ton, Name und Stimme mit 403 abweisen. Ein abgewiesenes
    // Feld, das als Erfolg quittiert wird, ist derselbe stille Fehlschlag, den
    // dieser Auftrag beseitigt.
    if (!canEditForwardingOnPlan) {
      return response(403, buildContractPayload({ error: 'forwarding_not_allowed_on_plan', errors: ['forwarding_not_allowed_on_plan'] }));
    }

    // Die Nummer landet als Wahlanweisung im Prompt. Ein Assistent, der eine
    // unwaehlbare Nummer ansagt, ist schlimmer als einer ohne Weiterleitung —
    // deshalb wird hier normalisiert (079 … -> +4179…) und im Zweifel
    // abgewiesen, statt Unbrauchbares in den Prompt zu schreiben.
    const invalidNumbers = [];
    const normalizedNumber = (raw, field) => {
      const trimmed = text(raw, 40);
      if (!trimmed) return null;
      const result = normalizePhoneE164(trimmed);
      if (!result.valid) { invalidNumbers.push(field); return trimmed; }
      return result.normalized;
    };

    if (ai_forwarding_1_name !== undefined) patch.ai_forwarding_1_name = text(ai_forwarding_1_name, 120);
    if (ai_forwarding_1_number !== undefined) patch.ai_forwarding_1_number = normalizedNumber(ai_forwarding_1_number, 'ai_forwarding_1_number');
    if (ai_forwarding_1_trigger !== undefined) patch.ai_forwarding_1_trigger = text(ai_forwarding_1_trigger, 500);
    if (ai_forwarding_2_name !== undefined) patch.ai_forwarding_2_name = text(ai_forwarding_2_name, 120);
    if (ai_forwarding_2_number !== undefined) patch.ai_forwarding_2_number = normalizedNumber(ai_forwarding_2_number, 'ai_forwarding_2_number');
    if (ai_forwarding_2_trigger !== undefined) patch.ai_forwarding_2_trigger = text(ai_forwarding_2_trigger, 500);
    // Die Notfallnummer bleibt bewusst ungepruefte Kurzwahl-Zone: 144 und 112
    // sind gueltige Notrufnummern und faellen durch jede E.164-Pruefung. Leeren
    // setzt auf den Schweizer Standard zurueck, statt den Abschnitt
    // NOTFALLNUMMER ersatzlos aus dem Prompt zu nehmen.
    if (ai_emergency_number !== undefined) patch.ai_emergency_number = text(ai_emergency_number, 40) || '144';

    if (invalidNumbers.length) {
      return response(400, buildContractPayload({
        error: 'forwarding_number_invalid',
        errors: ['forwarding_number_invalid'],
        blocked_fields: invalidNumbers
      }));
    }
  }

  if (ai_branch_extra !== undefined) {
    const templateId = String(customer.industry_template_id || '').trim();
    if (!templateId) {
      return response(409, buildContractPayload({ error: 'no_industry_template', errors: ['no_industry_template'] }));
    }
    const { data: template, error: templateError } = await sbAdmin
      .from('industry_templates')
      .select('extra_steps')
      .eq('id', templateId)
      .maybeSingle();
    if (templateError) return response(500, buildContractPayload({ error: 'industry_template_load_failed' }));

    const { values, rejected } = sanitizeBranchExtra(ai_branch_extra, branchFieldRules(template?.extra_steps));
    if (rejected.length) {
      return response(400, buildContractPayload({
        error: 'branch_field_not_in_template',
        errors: ['branch_field_not_in_template'],
        blocked_fields: rejected
      }));
    }
    // Teil-Speicherung: der Screen sendet nur den bearbeiteten Abschnitt, die
    // uebrigen Antworten des Kunden bleiben stehen. Ein leerer Wert loescht
    // seinen Schluessel, weil sanitizeBranchExtra ihn gar nicht erst uebernimmt.
    const existing = customer.ai_branch_extra && typeof customer.ai_branch_extra === 'object' && !Array.isArray(customer.ai_branch_extra)
      ? customer.ai_branch_extra
      : {};
    const merged = { ...existing };
    Object.keys(ai_branch_extra && typeof ai_branch_extra === 'object' ? ai_branch_extra : {}).forEach((key) => { delete merged[key]; });
    Object.assign(merged, values);
    patch.ai_branch_extra = Object.keys(merged).length ? merged : null;
  }

  // Schicht A. Anders als ai_branch_extra braucht das keine Branchenvorlage —
  // genau deshalb liegen diese Werte in eigenen Spalten (Entscheid F1).
  if (core_fields !== undefined) {
    const { data: coreRow, error: coreError } = await sbAdmin
      .from('system_config')
      .select('value')
      .eq('key', 'core_field_steps')
      .maybeSingle();
    if (coreError) return response(500, buildContractPayload({ error: 'core_field_steps_load_failed' }));

    const rules = coreFieldRules(parseCoreSteps(coreRow?.value));
    if (!rules.size) {
      return response(409, buildContractPayload({ error: 'core_fields_unavailable', errors: ['core_fields_unavailable'] }));
    }
    const { patch: corePatch, rejected } = sanitizeCoreFields(core_fields, rules);
    if (rejected.length) {
      return response(400, buildContractPayload({
        error: 'core_field_not_in_schema',
        errors: ['core_field_not_in_schema'],
        blocked_fields: rejected
      }));
    }
    Object.assign(patch, corePatch);
  }

  const patchKeys = Object.keys(patch).filter((key) => key !== 'updated_at');
  if (!patchKeys.length) {
    return response(400, buildContractPayload({
      error: 'no_valid_fields',
      errors,
      blocked_fields: blockedFields
    }));
  }

  // Vor dem Schreiben festhalten, damit der Sync sagen kann, welches Feld ihn
  // ausgeloest hat. `customer` ist der Stand VOR dem Patch.
  const prevValues = {};
  patchKeys.forEach((key) => { prevValues[key] = customer[key] ?? null; });

  const { error: dbErr } = await sbAdmin.from('customers').update(patch).eq('id', caller.customerId);
  if (dbErr) return response(500, buildContractPayload({ error: 'update_failed', detail: dbErr.message, errors, blocked_fields: blockedFields }));

  // N6: Der Sync haengt an der Prompt-Wirkung der geschriebenen Spalten, nicht
  // an ihrem Namen. Eine reine Weiterleitungsaenderung ist damit ein
  // vollwertiger Ausloeser (frueher `skipped_forwarding_only`), eine reine
  // SMS-Einstellung keiner mehr (frueher ein voller Prompt-Rebuild).
  const requiresSync = needsPromptSync(patchKeys);
  let syncStatus = 'skipped_no_sync_fields';
  let syncError = null;

  if (requiresSync && customer.elevenlabs_agent_id) {
    try {
      const adminUrl = process.env.ADMIN_URL || 'https://admin.voxera.ch';
      const authorization = event.headers?.authorization || event.headers?.Authorization || '';
      const syncRes = await fetch(`${adminUrl}/.netlify/functions/trigger-elevenlabs-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({
          customer_id: caller.customerId,
          agent_id: customer.elevenlabs_agent_id,
          triggered_by: 'customer_self_edit',
          prev_values: prevValues
        })
      });
      if (!syncRes.ok) {
        syncStatus = 'failed';
        syncError = `sync_http_${syncRes.status}`;
      } else {
        syncStatus = 'success';
      }
    } catch (error) {
      syncStatus = 'failed';
      syncError = error.message || 'sync_failed';
    }
  } else if (requiresSync && !customer.elevenlabs_agent_id) {
    syncStatus = 'skipped_no_agent';
  }

  return response(200, buildContractPayload({
    success: true,
    updated: patchKeys,
    errors,
    blocked_fields: blockedFields,
    sync_status: syncStatus,
    sync_error: syncError
  }));
};

exports._test = { branchFieldRules, sanitizeBranchExtra, parseCoreSteps, coreFieldRules, sanitizeCoreFields };
