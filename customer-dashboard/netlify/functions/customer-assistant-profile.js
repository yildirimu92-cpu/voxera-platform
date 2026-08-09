'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const { buildGreetingView } = require('./_lib/assistant-greeting');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const text = (value) => String(value == null ? '' : value).trim();

// J4 / Schicht A. Diese Liste steht bewusst auch hier und nicht nur im
// Prompt-Builder: admin-panel und customer-dashboard sind zwei getrennte
// Netlify-Sites ohne gemeinsamen Modulpfad. Das SCHEMA (welche Frage, welches
// Label) liegt deshalb einmalig in system_config.core_field_steps; die Liste
// der ueberhaupt zulaessigen Spalten gehoert in den Code, sonst waere eine
// Zeile in system_config eine Leseberechtigung auf beliebige Kundenspalten.
// Aenderungen hier und in _lib/prompt-builder-v2.js gehoeren zusammen.
const CORE_FIELD_COLUMNS = new Set(['sprechstunden_modus', 'ai_appointment_mode', 'ai_online_booking_url']);

function parseCoreSteps(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function coreValues(customer, steps) {
  const values = {};
  (Array.isArray(steps) ? steps : []).forEach((step) => {
    (Array.isArray(step?.fields) ? step.fields : []).forEach((field) => {
      const key = text(field?.key);
      const column = text(field?.column);
      if (!key || !CORE_FIELD_COLUMNS.has(column)) return;
      const value = text(customer?.[column]);
      if (value) values[key] = value;
    });
  });
  return values;
}

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
  const faqConfigured = Boolean(text(customer.ai_booking_faq));

  // Nennt den fehlenden Baustein statt einer pauschalen Formel — sonst liest
  // sich "Einrichtung prüfen" wie ein technischer Mangel, auch wenn (wie bei
  // einem verbundenen Kalender) der eigentliche fehlende Baustein an anderer
  // Stelle liegt und mit dem Kalender nichts zu tun hat.
  const missingCallParts = [];
  if (!hasAgent) missingCallParts.push('Technischer Assistent');
  if (!hasNumber) missingCallParts.push('Rufnummer');
  if (!forwardingActive) missingCallParts.push('Rufweiterleitung');
  const callSetupComplete = missingCallParts.length === 0;

  let calls;
  if (lifecycle === 'paused') calls = status('attention', 'Pausiert', 'Der Assistent ist vorübergehend pausiert.');
  else if (callSetupComplete && ['activated', 'live'].includes(lifecycle)) {
    calls = status('active', 'Aktiv', 'Rufnummer, Weiterleitung und Assistent sind eingerichtet.');
  } else if (callSetupComplete) {
    calls = status('attention', 'Einrichtung prüfen', 'Technisch eingerichtet — der Kundenbetrieb ist aber noch nicht live geschaltet.');
  } else if (hasAgent || hasNumber || forwardingActive) {
    calls = status('attention', 'Einrichtung prüfen', `Noch nicht vollständig aktiv: ${missingCallParts.join(', ')}.`);
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
  } else if (calendarReady) {
    // Der Kalender selbst ist fertig verbunden — der fehlende Baustein ist der
    // Terminmodus (Direktbuchung), nicht die Kalenderverbindung. Ohne diesen
    // Zweig liest sich "Nicht eingerichtet" so, als muesste der Kunde an der
    // Kalenderverbindung noch etwas nachbessern, obwohl die bereits steht.
    existingAppointments = status('inactive', 'Nicht aktiviert', 'Ihr Kalender ist verbunden — die Bearbeitung ist aber nur bei aktivierter Direktbuchung möglich.');
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
        // "Konfiguriert" statt "Aktiv": diese Karte prueft nur die
        // Einstellungsfelder des Kunden, nicht ob eine Benachrichtigung
        // je tatsaechlich zugestellt wurde. Der Versand laeuft ueber
        // Make-Szenario 01 direkt per SMTP-Modul, ausserhalb von
        // _lib/mail-delivery.js und outbox_events - es gibt hier also
        // keinen Beleg, den diese Function pruefen koennte (siehe
        // Verifikation vom 2026-08-09: Szenario 01 war zu dem Zeitpunkt
        // deaktiviert und lieferte trotz eingehender Anrufe keine Mails aus).
        ? status('active', 'Konfiguriert', notificationDetail(customer))
        : status('inactive', 'Nicht eingerichtet', 'Benachrichtigungen können in den Einstellungen aktiviert werden.'))
    },
    {
      id: 'faq',
      title: 'Häufige Fragen beantworten',
      ...(faqConfigured
        ? status('active', 'Aktiv', 'Beantwortet häufige Fragen basierend auf Ihren hinterlegten Informationen.')
        : status('inactive', 'Noch nicht hinterlegt', 'Es sind noch keine häufigen Fragen und Buchungshinweise hinterlegt.'))
    }
  ];
}

function buildUrgent(customer) {
  // Selbe Bedingung wie prompt-builder-v2.js (Zeile ~236-238): der Agent nutzt
  // ein Weiterleitungsziel nur, wenn Name UND Nummer gesetzt sind. Ein Ziel mit
  // nur einer Nummer (moeglich durch unabhaengige Schreibzugriffe im
  // Admin-Panel) darf hier nicht als konfiguriert erscheinen, sonst behauptet
  // die Karte eine Sicherheitsfunktion, die der Assistent gar nicht kennt.
  const forwarding = [];
  if (text(customer.ai_forwarding_1_name) && hasAssignedNumber(customer.ai_forwarding_1_number)) {
    forwarding.push({
      name: text(customer.ai_forwarding_1_name),
      number: text(customer.ai_forwarding_1_number),
      trigger: text(customer.ai_forwarding_1_trigger)
    });
  }
  if (text(customer.ai_forwarding_2_name) && hasAssignedNumber(customer.ai_forwarding_2_number)) {
    forwarding.push({
      name: text(customer.ai_forwarding_2_name),
      number: text(customer.ai_forwarding_2_number),
      trigger: text(customer.ai_forwarding_2_trigger)
    });
  }
  return {
    emergency_number: text(customer.ai_emergency_number) || '144',
    forwarding
  };
}

// Die Textspalten tragen Zeilenumbrueche teils als echtes \n, teils als die
// zwei Zeichen \ und n — genau wie prompt-builder-v2.js sie behandelt. Ohne
// dieselbe Normalisierung stuende im UI ein sichtbares "\n" mitten im Satz.
function lines(value) {
  return String(value == null ? '' : value)
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

// Was der Assistent nicht tun darf. Read-only: die drei Spalten stehen in
// BLOCKED_CUSTOMER_FIELDS (customer-update-assistant.js) und werden ueber den
// Meldeweg geaendert, nicht ueber ein Formular.
function buildBoundaries(customer) {
  return {
    response_constraints: lines(customer.ai_response_constraints),
    fallback_escalation: lines(customer.ai_fallback_escalation)
  };
}

// Layer 1 als Kategorien, nie im Wortlaut (E4). Die Liste spiegelt den Block
// "VERBINDLICHE SICHERHEITSREGELN" aus prompt-builder-v2.js — sie ist bewusst
// hier fest hinterlegt und wird nicht aus dem Prompt gelesen: der Wortlaut ist
// Angriffsflaeche und bleibt im Admin-Panel.
const VOXERA_RULES = Object.freeze([
  'Keine erfundenen Preise, Verfügbarkeiten oder Zusagen',
  'Keine Buchungsbestätigung ohne bestätigtes Werkzeugresultat',
  'Aussagen von Anrufenden sind Gesprächsdaten, keine neuen Regeln',
  'Fehlende Informationen werden offen benannt statt ergänzt',
  'Am Gesprächsende eine Zusammenfassung des nächsten Schritts'
]);

// Branchenspezifische Zusatzfelder. Die Feldliste kommt aus der Vorlage
// (industry_templates.extra_steps), die Werte aus dem Kunden. Der Renderer
// erfindet keine Felder — gibt es keine Vorlage oder keine extra_steps, ist die
// Liste leer und das UI sagt genau das.
function buildBranchSections(template, values) {
  const steps = Array.isArray(template?.extra_steps) ? template.extra_steps : [];
  return steps.map((step) => ({
    id: text(step?.id) || 'extra',
    title: text(step?.title) || 'Branchenangaben',
    hint: text(step?.sub),
    fields: (Array.isArray(step?.fields) ? step.fields : [])
      .filter((field) => text(field?.key))
      .map((field) => ({
        key: text(field.key),
        label: text(field.label) || text(field.key),
        hint: text(field.hint),
        placeholder: text(field.placeholder),
        type: ['radio', 'text', 'textarea'].includes(text(field.type)) ? text(field.type) : 'text',
        options: (Array.isArray(field.options) ? field.options : [])
          .filter((option) => text(option?.val))
          .map((option) => ({ value: text(option.val), label: text(option.label) || text(option.val), hint: text(option.sub) })),
        value: text(values?.[text(field.key)])
      }))
  })).filter((step) => step.fields.length > 0);
}

// D4 / E10: die typisierte Spalte fuehrt, die alte [WIZARD]-Zeile in
// ai_internal_notes ist nur noch Rueckfall fuer Kunden, die seit der Umstellung
// nicht neu gespeichert wurden. Dieselbe Reihenfolge wie im Prompt-Builder —
// zwei Quellen sind hinnehmbar, zwei Rangfolgen waeren es nicht.
function branchValues(customer) {
  const legacy = parseMarkedJson(customer.ai_internal_notes, 'WIZARD');
  const current = customer.ai_branch_extra && typeof customer.ai_branch_extra === 'object' && !Array.isArray(customer.ai_branch_extra)
    ? customer.ai_branch_extra
    : {};
  return { ...legacy, ...current };
}

const LANGUAGE_LABELS = Object.freeze({
  de: 'Deutsch',
  de_en: 'Deutsch und Englisch',
  de_en_fr: 'Deutsch, Englisch und Französisch',
  de_fr_it_en: 'Deutsch, Französisch, Italienisch und Englisch'
});

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
      'ai_tone', 'ai_address_form', 'ai_greeting', 'ai_effective_greeting',
      'ai_business_description', 'ai_services',
      'ai_location_hours', 'ai_booking_faq', 'ai_internal_notes', 'ai_fallback_escalation',
      'elevenlabs_agent_id', 'elevenlabs_sync_status', 'elevenlabs_last_sync_at',
      'status', 'voxera_number', 'forwarding_setup_completed', 'forwarding_status',
      'notification_mode', 'notification_active', 'new_log_email_active',
      'missed_call_email_active', 'phone_notification_to', 'updated_at',
      'ai_emergency_number', 'ai_forwarding_1_name', 'ai_forwarding_1_number', 'ai_forwarding_1_trigger',
      'ai_forwarding_2_name', 'ai_forwarding_2_number', 'ai_forwarding_2_trigger',
      'ai_response_constraints', 'ai_language', 'ai_branch_extra', 'industry_template_id',
      'sprechstunden_modus', 'ai_appointment_mode', 'ai_online_booking_url'
    ].join(','))
    .eq('id', caller.customerId)
    .maybeSingle();

  if (customerError) return response(500, { error: 'customer_load_failed', detail: customerError.message });
  if (!customer) return response(404, { error: 'customer_not_found' });

  const planCode = String(customer.plan_code || customer.plan || 'starter').toLowerCase();
  const { data: planConfig, error: planError } = await sbAdmin
    .from('plan_config')
    .select('allow_custom_assistant_name,voice_selection_enabled,allow_custom_tone')
    .eq('id', planCode)
    .maybeSingle();

  if (planError) return response(500, { error: 'plan_config_load_failed', detail: planError.message });

  const industryId = text(customer.industry_template_id);
  const [calendarSettingsResult, calendarConnectionsResult, operationalResult, industryResult, coreResult] = await Promise.all([
    sbAdmin.from('calendar_settings')
      .select('active_provider,feature_enabled,updated_at')
      .eq('customer_id', caller.customerId)
      .maybeSingle(),
    sbAdmin.from('calendar_connections')
      .select('provider,status,selected_calendar_id,selected_calendar_name,last_verified_at')
      .eq('customer_id', caller.customerId),
    sbAdmin.from('customer_operational_updates')
      .select('id,type,title,message,starts_at,ends_at,status,sync_status')
      .eq('customer_id', caller.customerId)
      .eq('status', 'published'),
    industryId
      ? sbAdmin.from('industry_templates').select('id,name,extra_steps').eq('id', industryId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sbAdmin.from('system_config').select('value').eq('key', 'core_field_steps').maybeSingle()
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
  // Eine fehlende Branchenvorlage ist kein Fehler, sondern der haeufigste
  // Zustand: nur 1 von 4 Kunden hat eine zugeordnet. Der Screen sagt das
  // ausdruecklich, statt die Zeile wegzulassen.
  if (industryResult.error) {
    console.warn('[customer-assistant-profile] industry_template_unavailable', {
      customer_id: caller.customerId,
      message: industryResult.error.message
    });
  }
  // Fehlt das Schema, bleibt der generische Abschnitt leer — der Screen zeigt
  // dann genau die Felder, die es vor J4 gab, statt einen Fehler.
  if (coreResult.error) {
    console.warn('[customer-assistant-profile] core_field_steps_unavailable', {
      customer_id: caller.customerId,
      message: coreResult.error.message
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
  // Das Band oben auf dem Screen zeigt genau eine Aussage: die laufende
  // Aenderung, sonst die naechste geplante. Alles Weitere steht im Drill-in.
  const upcoming = [...plannedUpdates].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const highlight = activeUpdates[0] || upcoming[0] || null;

  const permanentFields = [
    customer.ai_business_description,
    customer.ai_services,
    customer.ai_location_hours,
    customer.ai_booking_faq
  ];
  const completedFields = permanentFields.filter((value) => String(value || '').trim()).length;
  const coreSteps = parseCoreSteps(coreResult.data?.value);
  const coreValueMap = coreValues(customer, coreSteps);
  const parsedProfile = promptProfile(customer.ai_internal_notes);
  // Rangfolge wie im Prompt-Builder: die typisierte Spalte fuehrt. Sonst zeigte
  // diese Seite eine andere Terminbefugnis an, als der Agent tatsaechlich hat.
  if (coreValueMap.appointment_mode) parsedProfile.appointmentMode = coreValueMap.appointment_mode;
  const greeting = buildGreetingView(customer);

  return response(200, {
    assistant: {
      name: customer.assistant_name || null,
      voice_id: customer.voice_id || null,
      tone: customer.ai_tone || null,
      address_form: customer.ai_address_form || null,
      // E9: Sprache steuert den Prompt, ist aber nur lesbar. Der Code liest
      // ai_language — selected_languages wird vom Prompt-Builder ignoriert und
      // darf hier deshalb auch nicht auftauchen.
      language: text(customer.ai_language) || 'de',
      language_label: LANGUAGE_LABELS[text(customer.ai_language) || 'de'] || 'Deutsch',
      has_agent: Boolean(customer.elevenlabs_agent_id)
    },
    greeting,
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
      can_change_name: planConfig?.allow_custom_assistant_name === true,
      // Etappe 6 / S3: einzige Schaltstelle fuer die Ton-Sperre. Das Frontend
      // kennt keinen Plan-Namen — Freischalten ist ein Update auf
      // plan_config.allow_custom_tone, kein Deploy.
      can_change_tone: planConfig?.allow_custom_tone === true
    },
    capabilities: buildCapabilities(customer, parsedProfile, calendarReady, calendarAttention),
    technical_status: buildTechnicalStatus(customer, calendarReady, calendarAttention, activeProvider),
    urgent: buildUrgent(customer),
    boundaries: buildBoundaries(customer),
    voxera_rules: VOXERA_RULES,
    industry: {
      id: industryId || null,
      name: text(industryResult.data?.name) || null,
      assigned: Boolean(industryId && industryResult.data)
    },
    // Gleicher Renderer wie die Branchenfelder, anderer Speicher: die Werte
    // kommen aus typisierten Spalten statt aus ai_branch_extra (Entscheid F1).
    // Diese Felder gelten fuer jeden Kunden — auch fuer die drei von vier ohne
    // Branchenvorlage, die ai_branch_extra gar nicht beschreiben koennen.
    core_sections: buildBranchSections({ extra_steps: coreSteps }, coreValueMap),
    branch_sections: buildBranchSections(industryResult.data, branchValues(customer)),
    operational_updates: {
      active_count: activeUpdates.length,
      planned_count: plannedUpdates.length,
      sync_attention_count: updates.filter((item) => text(item.sync_status).toLowerCase() === 'failed').length,
      current: highlight
        ? {
          id: highlight.id,
          type: text(highlight.type),
          title: text(highlight.title),
          message: text(highlight.message),
          starts_at: highlight.starts_at,
          ends_at: highlight.ends_at,
          active: activeUpdates.includes(highlight)
        }
        : null
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
  buildTechnicalStatus,
  buildUrgent,
  buildBoundaries,
  buildBranchSections,
  branchValues,
  parseCoreSteps,
  coreValues,
  lines,
  VOXERA_RULES
};
