(function initCustomerCallViewModel(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VoxeraCustomerCallViewModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCustomerCallViewModel() {
  'use strict';

  const ZURICH_TIME_ZONE = 'Europe/Zurich';
  const LIVE_STATUSES = new Set([
    'incoming', 'ringing', 'queued', 'in_progress', 'active', 'live',
    'ongoing', 'started', 'läuft', 'laufend'
  ]);
  const ANALYSING_STATUSES = new Set([
    'analyzing', 'analysing', 'processing', 'transcribing', 'pending_analysis'
  ]);
  const TERMINAL_STATUSES = new Set(['done', 'completed', 'ended', 'failed', 'aborted', 'interrupted', 'beendet']);
  const ARCHIVED_STATUSES = new Set(['archived', 'archiviert']);
  const DONE_STATUSES = new Set(['done', 'completed', 'resolved', 'erledigt', 'abgeschlossen']);
  const PLANNED_STATUSES = new Set(['planned', 'scheduled', 'follow_up', 'callback_planned', 'geplant', 'rückruf geplant', 'rueckruf geplant']);
  const WORKING_STATUSES = new Set(['in_progress', 'processing', 'working', 'in bearbeitung', 'bearbeitung']);
  const OPEN_STATUSES = new Set(['open', 'offen', 'new', 'neu']);

  const text = (value) => String(value == null ? '' : value).trim();
  const lower = (value) => text(value).toLowerCase();
  const truthy = (value) => value === true || ['true', '1', 'yes', 'ja'].includes(lower(value));

  function fields(record) {
    return record && record.fields && typeof record.fields === 'object' ? record.fields : {};
  }

  function read(record, key) {
    if (record && record[key] !== undefined && record[key] !== null && text(record[key]) !== '') return record[key];
    const nested = fields(record);
    if (nested[key] !== undefined && nested[key] !== null && text(nested[key]) !== '') return nested[key];
    return '';
  }

  function first(record, keys) {
    for (const key of keys) {
      const value = read(record, key);
      if (value !== '') return value;
    }
    return '';
  }

  function isLive(record) {
    const live = lower(first(record, ['live_status', 'call_status', 'telephony_status', 'status']));
    if (LIVE_STATUSES.has(live)) return true;
    if (TERMINAL_STATUSES.has(live) || ANALYSING_STATUSES.has(live) || ARCHIVED_STATUSES.has(live)) return false;
    return truthy(read(record, 'is_live'));
  }

  function isAnalysisPending(record) {
    if (isLive(record)) return false;
    const live = lower(first(record, ['live_status', 'call_status', 'telephony_status']));
    if (ANALYSING_STATUSES.has(live)) return true;
    const summary = text(first(record, ['call_summary', 'summary', 'call_summary_short']));
    const conversationId = text(first(record, ['elevenlabs_conversation_id', 'conversation_id']));
    return Boolean(conversationId && TERMINAL_STATUSES.has(live) && !summary);
  }

  function workflowState(record) {
    const dashboard = lower(first(record, ['dashboard_status', 'workflow_status', 'status']));
    if (ARCHIVED_STATUSES.has(dashboard)) return 'archived';
    if (PLANNED_STATUSES.has(dashboard) || text(read(record, 'follow_up_at'))) return 'planned';
    if (DONE_STATUSES.has(dashboard)) return 'done';
    if (WORKING_STATUSES.has(dashboard) || text(read(record, 'read_at'))) return 'working';
    if (OPEN_STATUSES.has(dashboard) || !dashboard) return 'new';
    return 'new';
  }

  function lifecycle(record) {
    if (isLive(record)) return 'live';
    if (isAnalysisPending(record)) return 'analysing';
    return workflowState(record);
  }

  const LIFECYCLE_META = Object.freeze({
    live: { label: 'Anruf läuft', tone: 'live', description: 'Lara spricht gerade mit dem Anrufer.' },
    analysing: { label: 'Wird ausgewertet', tone: 'neutral', description: 'Zusammenfassung und nächste Schritte werden erstellt.' },
    new: { label: 'Neu', tone: 'info', description: 'Noch nicht angesehen.' },
    working: { label: 'In Bearbeitung', tone: 'info', description: 'Die Anfrage wurde geöffnet oder bearbeitet.' },
    planned: { label: 'Rückruf geplant', tone: 'attention', description: 'Eine Folgeaktion ist terminiert.' },
    done: { label: 'Erledigt', tone: 'success', description: 'Die Anfrage ist abgeschlossen.' },
    archived: { label: 'Archiviert', tone: 'muted', description: 'Die Anfrage wurde abgelegt.' }
  });

  function category(record) {
    const raw = lower(first(record, ['category', 'intent', 'request_type']));
    if (!raw || ['inbound', 'incoming', 'eingehender anruf', 'call'].includes(raw)) return null;
    const map = {
      appointment: 'Terminanfrage', terminanfrage: 'Terminanfrage', appointment_request: 'Terminanfrage',
      callback: 'Rückrufwunsch', rueckruf: 'Rückrufwunsch', rückruf: 'Rückrufwunsch',
      quote: 'Offertenanfrage', offerte: 'Offertenanfrage', offertenanfrage: 'Offertenanfrage',
      support: 'Supportanfrage', information: 'Informationsanfrage', sonstiges: 'Sonstiges'
    };
    return map[raw] || text(first(record, ['category', 'intent', 'request_type']));
  }

  function leadQuality(record) {
    const raw = lower(first(record, ['lead_quality', 'relevance']));
    if (!['hot', 'warm', 'cold', 'kalt', 'heiss', 'heiß'].includes(raw)) return null;
    if (!category(record)) return null;
    if (['hot', 'heiss', 'heiß'].includes(raw)) return 'Hot';
    if (raw === 'warm') return 'Warm';
    return 'Kalt';
  }

  function outcome(record) {
    if (truthy(read(record, 'callback_requested'))) return 'Rückruf empfohlen';
    const next = lower(first(record, ['next_action', 'action_required']));
    if (/rückruf|rueckruf|callback|zurückrufen|zurueckrufen|erneut versuchen/.test(next)) return 'Rückruf empfohlen';
    if (/termin|appointment/.test(next)) return 'Termin prüfen';
    if (/offerte|angebot|quote/.test(next)) return 'Offerte prüfen';
    if (/information senden/.test(next)) return 'Information senden';
    return null;
  }

  function displayName(record) {
    return text(first(record, ['caller_name', 'contact_name', 'name'])) || 'Unbekannter Anrufer';
  }

  function phone(record) {
    return text(first(record, ['caller_phone', 'caller_number', 'phone_number', 'from_number'])) || null;
  }

  function summary(record) {
    return text(first(record, ['call_summary_short', 'call_summary', 'summary'])) || '';
  }

  function durationSeconds(record) {
    const value = Number(first(record, ['duration_seconds', 'duration', 'call_duration_secs']));
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }

  function timestamp(record) {
    return first(record, ['started_at', 'created_at', 'call_started_at', 'updated_at']) || null;
  }

  function formatZurichDateTime(value, options) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-CH', {
      timeZone: ZURICH_TIME_ZONE,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      ...(options || {})
    }).format(date);
  }

  function build(record) {
    const state = lifecycle(record || {});
    return {
      id: text(first(record, ['id', 'call_id', 'elevenlabs_conversation_id', 'conversation_id'])) || null,
      lifecycle: state,
      lifecycleMeta: LIFECYCLE_META[state],
      name: displayName(record),
      phone: phone(record),
      summary: summary(record),
      category: category(record),
      leadQuality: leadQuality(record),
      outcome: outcome(record),
      durationSeconds: durationSeconds(record),
      timestamp: timestamp(record),
      direction: 'inbound'
    };
  }

  return Object.freeze({
    ZURICH_TIME_ZONE,
    LIVE_STATUSES,
    ANALYSING_STATUSES,
    LIFECYCLE_META,
    read,
    lifecycle,
    category,
    leadQuality,
    outcome,
    formatZurichDateTime,
    build
  });
});
