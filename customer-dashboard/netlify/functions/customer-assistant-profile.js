'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const text = (value) => String(value == null ? '' : value).trim();

const PROMPT_FUNCTIONS = new Set([
  'information', 'consulting', 'lead', 'appointment', 'quote', 'callback', 'support', 'transfer'
]);
const LEGACY_GOAL_FUNCTION = Object.freeze({
  service: 'information',
  lead: 'lead',
  appointment: 'appointment',
  callback: 'callback',
  support: 'support'
});

function parseMarkedJson(notes, marker) {
  const prefix = `[${marker}]`;
  const line = String(notes || '').split(/\r?\n/).find((item) => item.trim().startsWith(prefix));
  if (!line) return {};
  try {
    const parsed = JSON.parse(line.trim().slice(prefix.length).trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function promptProfile(notes) {
  const raw = parseMarkedJson(notes, 'PROMPT_V2');
  const functions = [...new Set((Array.isArray(raw.functions) ? raw.functions : [])
    .map((item) => text(item).toLowerCase())
    .filter((item) => PROMPT_FUNCTIONS.has(item)))];
  if (!functions.length && LEGACY_GOAL_FUNCTION[text(raw.goal).toLowerCase()]) {
    functions.push(LEGACY_GOAL_FUNCTION[text(raw.goal).toLowerCase()]);
  }
  const wizard = parseMarkedJson(notes, 'WIZARD');
  let appointmentMode = ['none', 'request', 'direct'].includes(text(raw.appointmentMode).toLowerCase())
    ? text(raw.appointmentMode).toLowerCase()
    : '';
  if (!appointmentMode && text(wizard.termin_modus).toLowerCase() === 'direkt') appointmentMode = 'direct';
  if (!appointmentMode && text(wizard.termin_modus).toLowerCase() === 'aufnehmen') appointmentMode = 'request';
  const unknownHandling = ['transparent', 'callback', 'human'].includes(text(raw.unknownHandling).toLowerCase())
    ? text(raw.unknownHandling).toLowerCase()
    : '';
  return { functions, appointmentMode, unknownHandling };
}

function hasAssignedNumber(value) {
  const number = text(value);
  return Boolean(number && !/zuweisung offen|pending|nicht zugewiesen/i.test(number));
}

function status(statusCode, label, detail) {
  return { status: statusCode, label, detail };
}

function notificationDetail(customer) {
  const mode = text(customer.notification_mode).toLowerCase();
  const channels = [];
  if (customer.new_log_email_active === true || customer.missed_call_email_active === true) channels.push('E-Mail');
  if (text(customer.phone_notification_to)) channels.push('Telefon/SMS');
  const scope = mode === 'all_calls' ? 'für alle Anrufe' : mode === 'callback_only' ? 'für Rückrufanfragen' : '';
  if (channels.length && scope) return `${channels.join(' und ')} ${scope}`;
  if (channels.length) return channels.join(' und ');
  if (scope) return `Benachrichtigungen ${scope}`;
  return 'Keine Benachrichtigung eingerichtet';
}

function buildCapabilities(customer, profile, calendarReady, calendarAttention) {
  const lifecycle = text(customer.status).toLowerCase();
  const hasAgent = Boolean(text(customer.elevenlabs_agent_id));
  const hasNumber = hasAssignedNumber(customer.voxera_number);
  const forwardingActive = customer.forwarding_setup_completed === true || text(customer.forwarding_status).toLowerCase() === 'active';
  const callbackConfigured = profile.functions.includes('callback')
    || profile.unknownHandling === 'callback'
    || /rückruf|callback/i.test(text(customer.ai_fallback_escalation));
  const transferConfigured = profile.functions.includes('transfer')
    || profile.unknownHandling === 'human'
    || /weiterleit|zuständige person|mitarbeiter/i.test(text(customer.ai_fallback_escalation));
  const notificationConfigured = customer.notification_active === true
    || text(customer.notification_mode).toLowerCase() !== 'none'
    || customer.new_log_email_active === true
    || customer.missed_call_email_active === true
    || Boolean(text(customer.phone_notification_to));

  let calls;
  if (lifecycle === 'paused') calls = status('attention', 'Pausiert', 'Der Assistent ist vorübergehend pausiert.');
  else if (hasAgent && hasNumber && forwardingActive && ['activated', 'live'].includes(lifecycle)) {
    calls = status('active', 'Aktiv', 'Rufnummer, Weiterleitung und Assistent sind eingerichtet.');
  } else if (hasAgent || hasNumber || forwardingActive) {
    calls = status('attention', 'Einrichtung prüfen', 'Mindestens ein technischer Bestandteil ist noch nicht vollständig aktiv.');
  } else calls = status('inactive', 'Nicht eingerichtet', 'Die technische Anrufannahme ist noch nicht bereit.');

  let appointments;
  if (profile.appointmentMode === 'direct' && calendarReady) {
    appointments = status('active', 'Direkte Buchung', 'Freie Zeiten können geprüft und bestätigte Termine gebucht werden.');
  } else if (profile.appointmentMode === 'direct' && calendarAttention) {
    appointments = status('attention', 'Kalender prüfen', 'Direkte Buchung ist vorgesehen, aber die Kalenderverbindung ist nicht vollständig bereit.');
  } else if (profile.appointmentMode === 'request') {
    appointments = status('active', 'Terminanfrage', 'Wunschzeiten und Kontaktdaten werden aufgenommen; das Unternehmen bestätigt den Termin.');
  } else appointments = status('inactive', 'Nicht freigeschaltet', 'Der Assistent vereinbart aktuell keine Termine.');

  let existingAppointments;
  if (profile.appointmentMode === 'direct' && calendarReady) {
    existingAppointments = status('active', 'Aktiv', 'Bestehende Voxera-Termine können verschoben oder abgesagt werden.');
  } else if (profile.appointmentMode === 'direct' && calendarAttention) {
    existingAppointments = status('attention', 'Kalender prüfen', 'Die Bearbeitung bestehender Termine benötigt eine aktive Kalenderverbindung.');
  } else existingAppointments = status('inactive', 'Nicht eingerichtet', 'Nur bei direkter Kalenderbuchung verfügbar.');

  return [
    { id: 'calls', title: 'Anrufe entgegennehmen', ...calls },
    {
      id: 'callback',
      title: 'Rückrufwünsche aufnehmen',
      ...(callbackConfigured
        ? status('active', 'Aktiv', 'Name, Kontaktdaten und Anliegen können strukturiert aufgenommen werden.')
        : status('inactive', 'Nicht konfiguriert', 'Diese Funktion ist in der aktuellen Gesprächslogik nicht freigegeben.'))
    },
    { id: 'appointments', title: 'Termine vereinbaren', ...appointments },
    { id: 'appointment_changes', title: 'Bestehende Termine bearbeiten', ...existingAppointments },
    {
      id: 'transfer',
      title: 'An zuständige Person weiterleiten',
      ...(transferConfigured
        ? status('active', 'Konfiguriert', 'Weiterleitung ist in der Gesprächslogik freigegeben.')
        : status('inactive', 'Nicht konfiguriert', 'Es ist keine Weiterleitungslogik freigegeben.'))
    },
    {
      id: 'notifications',
      title: 'Benachrichtigungen versenden',
      ...(notificationConfigured
        ? status('active', 'Aktiv', notificationDetail(customer))
        : status('inactive', 'Nicht eingerichtet', 'Benachrichtigungen können in den Einstellungen aktiviert werden.'))
    }
  ];
}

function buildTechnicalStatus(customer, calendarReady, calendarAttention, calendarProvider) {
  const hasAgent = Boolean(text(customer.elevenlabs_agent_id));
  const hasNumber = hasAssignedNumber(customer.voxera_number);
  const forwardingActive = customer.forwarding_setup_completed === true || text(customer.forwarding_status).toLowerCase() === 'active';
  const syncState = text(customer.elevenlabs_sync_status).toLowerCase();
  const syncSuccess = hasAgent && syncState === 'success' && Boolean(customer.elevenlabs_last_sync_at);
  const lifecycle = text(customer.status).toLowerCase();

  let assistant;
  if (lifecycle === 'paused') assistant = status('attention', 'Pausiert', 'Der Kundenbetrieb ist pausiert.');
  else if (hasAgent && ['activated', 'live'].includes(lifecycle)) assistant = status('active', 'Aktiv', 'Der technische Assistent ist zugewiesen.');
  else if (hasAgent) assistant = status('attention', 'Vorbereitet', 'Der Agent ist vorhanden, aber der Kundenbetrieb ist noch nicht live.');
  else assistant = status('inactive', 'Nicht eingerichtet', 'Es ist noch kein technischer Assistent zugewiesen.');

  let forwarding;
  if (hasNumber && forwardingActive) forwarding = status('active', 'Aktiv', 'Rufnummer und Weiterleitung sind bestätigt.');
  else if (hasNumber || forwardingActive) forwarding = status('attention', 'Prüfung erforderlich', 'Rufnummer oder Weiterleitung ist noch nicht vollständig bestätigt.');
  else forwarding = status('inactive', 'Nicht eingerichtet', 'Die Rufweiterleitung ist noch nicht eingerichtet.');

  let voiceSync;
  if (syncSuccess) voiceSync = status('active', 'Synchronisiert', 'Die Assistentenkonfiguration wurde erfolgreich übertragen.');
  else if (syncState === 'failed') voiceSync = status('error', 'Fehlgeschlagen', 'Die letzte Synchronisierung ist fehlgeschlagen.');
  else if (hasAgent) voiceSync = status('attention', 'Ausstehend', 'Für den aktuellen Agenten ist noch kein erfolgreicher Sync bestätigt.');
  else voiceSync = status('inactive', 'Nicht verfügbar', 'Ohne technischen Agenten ist keine Synchronisierung möglich.');

  let calendar;
  if (calendarReady) calendar = status('active', 'Verbunden', `${calendarProvider || 'Kalender'} ist für Buchungen aktiv.`);
  else if (calendarAttention) calendar = status('attention', 'Verbindung prüfen', 'Kalender ist aktiviert, aber Anbieter oder Kalenderauswahl ist nicht vollständig bereit.');
  else calendar = status('inactive', 'Nicht aktiviert', 'Der Assistent verwendet aktuell keine direkte Kalenderbuchung.');

  return {
    assistant,
    forwarding,
    voice_sync: voiceSync,
    calendar,
    last_successful_sync_at: syncSuccess ? customer.elevenlabs_last_sync_at : null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error: 'supabase_env_missing' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select([
      'id', 'customer_name', 'plan', 'plan_code', 'assistant_name', 'voice_id',
      'ai_tone', 'ai_address_form', 'ai_business_description', 'ai_services',
      'ai_location_hours', 'ai_booking_faq', 'ai_internal_notes', 'ai_fallback_escalation',
      'elevenlabs_agent_id', 'elevenlabs_sync_status', 'elevenlabs_last_sync_at',
      'status', 'voxera_number', 'forwarding_setup_completed', 'forwarding_status',
      'notification_mode', 'notification_active', 'new_log_email_active',
      'missed_call_email_active', 'phone_notification_to', 'updated_at'
    ].join(','))
    .eq('id', caller.customerId)
    .maybeSingle();

  if (customerError) return response(500, { error: 'customer_load_failed', detail: customerError.message });
  if (!customer) return response(404, { error: 'customer_not_found' });

  const planCode = String(customer.plan_code || customer.plan || 'starter').toLowerCase();
  const { data: planConfig, error: planError } = await sbAdmin
    .from('plan_config')
    .select('allow_custom_assistant_name,voice_selection_enabled')
    .eq('id', planCode)
    .maybeSingle();

  if (planError) return response(500, { error: 'plan_config_load_failed', detail: planError.message });

  const [calendarSettingsResult, calendarConnectionsResult, operationalResult] = await Promise.all([
    sbAdmin.from('calendar_settings')
      .select('active_provider,feature_enabled,updated_at')
      .eq('customer_id', caller.customerId)
      .maybeSingle(),
    sbAdmin.from('calendar_connections')
      .select('provider,status,selected_calendar_id,selected_calendar_name,last_verified_at')
      .eq('customer_id', caller.customerId),
    sbAdmin.from('customer_operational_updates')
      .select('starts_at,ends_at,status,sync_status')
      .eq('customer_id', caller.customerId)
      .eq('status', 'published')
  ]);

  if (calendarSettingsResult.error) {
    console.warn('[customer-assistant-profile] calendar_settings_unavailable', {
      customer_id: caller.customerId,
      message: calendarSettingsResult.error.message
    });
  }
  if (calendarConnectionsResult.error) {
    console.warn('[customer-assistant-profile] calendar_connections_unavailable', {
      customer_id: caller.customerId,
      message: calendarConnectionsResult.error.message
    });
  }
  if (operationalResult.error) {
    console.warn('[customer-assistant-profile] operational_updates_unavailable', {
      customer_id: caller.customerId,
      message: operationalResult.error.message
    });
  }

  const settings = calendarSettingsResult.data || null;
  const connections = Array.isArray(calendarConnectionsResult.data) ? calendarConnectionsResult.data : [];
  const activeProvider = text(settings?.active_provider).toLowerCase();
  const activeConnection = activeProvider
    ? connections.find((item) => text(item.provider).toLowerCase() === activeProvider)
    : null;
  const calendarAttention = settings?.feature_enabled === true;
  const calendarReady = Boolean(
    calendarAttention
    && activeProvider
    && activeConnection
    && text(activeConnection.status).toLowerCase() === 'connected'
    && text(activeConnection.selected_calendar_id)
  );

  const now = Date.now();
  const updates = Array.isArray(operationalResult.data) ? operationalResult.data : [];
  const activeUpdates = updates.filter((item) => {
    const start = new Date(item.starts_at).getTime();
    const end = new Date(item.ends_at).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now;
  });
  const plannedUpdates = updates.filter((item) => {
    const start = new Date(item.starts_at).getTime();
    return Number.isFinite(start) && start > now;
  });

  const permanentFields = [
    customer.ai_business_description,
    customer.ai_services,
    customer.ai_location_hours,
    customer.ai_booking_faq
  ];
  const completedFields = permanentFields.filter((value) => String(value || '').trim()).length;
  const parsedProfile = promptProfile(customer.ai_internal_notes);

  return response(200, {
    assistant: {
      name: customer.assistant_name || null,
      voice_id: customer.voice_id || null,
      tone: customer.ai_tone || null,
      address_form: customer.ai_address_form || null,
      has_agent: Boolean(customer.elevenlabs_agent_id)
    },
    business_profile: {
      company_name: customer.customer_name || null,
      description: customer.ai_business_description || null,
      services: customer.ai_services || null,
      location_hours: customer.ai_location_hours || null,
      booking_faq: customer.ai_booking_faq || null,
      completed_fields: completedFields,
      total_fields: permanentFields.length,
      updated_at: customer.updated_at || null
    },
    permissions: {
      can_change_voice: planConfig?.voice_selection_enabled === true,
      can_change_name: planConfig?.allow_custom_assistant_name === true
    },
    capabilities: buildCapabilities(customer, parsedProfile, calendarReady, calendarAttention),
    technical_status: buildTechnicalStatus(customer, calendarReady, calendarAttention, activeProvider),
    operational_updates: {
      active_count: activeUpdates.length,
      planned_count: plannedUpdates.length,
      sync_attention_count: updates.filter((item) => text(item.sync_status).toLowerCase() === 'failed').length
    },
    plan_code: planCode,
    status_version: 1
  });
};

exports._test = {
  parseMarkedJson,
  promptProfile,
  hasAssignedNumber,
  notificationDetail,
  buildCapabilities,
  buildTechnicalStatus
};
