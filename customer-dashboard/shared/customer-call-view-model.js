(function initCustomerCallViewModel(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.VoxeraCustomerCallViewModel = api;
    root.vxGetCanonicalCallTimestamp = api.timestamp;

    // Compatibility bridge for the existing detail renderer in index.html.
    // The canonical call timestamp owner prefers the real call start over record creation time.
    const installTimestampBridge = () => {
      if (typeof root.getRecordTimestamp !== 'function') return false;
      root.getRecordTimestamp = api.timestamp;
      return true;
    };

    if (!installTimestampBridge() && root.document && typeof root.setInterval === 'function') {
      let attempts = 0;
      const timer = root.setInterval(() => {
        attempts += 1;
        if (installTimestampBridge() || attempts > 160) root.clearInterval(timer);
      }, 50);
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCustomerCallViewModel() {
  'use strict';

  const ZURICH_TIME_ZONE = 'Europe/Zurich';
  const START_CREATED_AT_TOLERANCE_MS = 15 * 60 * 1000;
  const LIVE_STATUSES = new Set([
    'incoming', 'ringing', 'queued', 'in_progress', 'active', 'live',
    'ongoing', 'started', 'läuft', 'laufend'
  ]);
  const ANALYSING_STATUSES = new Set([
    'analyzing', 'analysing', 'processing', 'transcribing', 'pending_analysis'
  ]);
  const TERMINAL_STATUSES = new Set(['done', 'completed', 'ended', 'failed', 'aborted', 'interrupted', 'beendet']);
  const ARCHIVED_STATUSES = new Set(['archived', 'archiviert']);
  const DONE_STATUSES = new Set(['done', 'completed', 'resolved', 'erledigt', 'abgeschlossen', 'closed']);
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

  function allValues(record, keys) {
    const nested = fields(record);
    const result = [];
    for (const key of keys) {
      if (record && record[key] !== undefined && record[key] !== null && text(record[key]) !== '') {
        result.push(lower(record[key]));
      }
      if (nested[key] !== undefined && nested[key] !== null && text(nested[key]) !== '') {
        result.push(lower(nested[key]));
      }
    }
    return result;
  }

  function isLive(record) {
    const states = allValues(record, ['live_status', 'call_status', 'telephony_status']);
    if (states.some((state) => TERMINAL_STATUSES.has(state) || ANALYSING_STATUSES.has(state) || ARCHIVED_STATUSES.has(state))) {
      return false;
    }
    if (states.some((state) => LIVE_STATUSES.has(state))) return true;
    return truthy(read(record, 'is_live'));
  }

  function isAnalysisPending(record) {
    if (isLive(record)) return false;
    const states = allValues(record, ['live_status', 'call_status', 'telephony_status']);
    if (states.some((state) => ANALYSING_STATUSES.has(state))) return true;
    const summary = text(first(record, ['call_summary', 'summary', 'call_summary_short']));
    const conversationId = text(first(record, ['elevenlabs_conversation_id', 'conversation_id']));
    return Boolean(conversationId && states.some((state) => TERMINAL_STATUSES.has(state)) && !summary);
  }

  function workflowState(record) {
    const states = allValues(record, ['dashboard_status', 'workflow_status', 'status']);

    // A terminal customer workflow state must win over stale wrapper values such as
    // top-level "Offen" or "In Bearbeitung".
    if (states.some((state) => ARCHIVED_STATUSES.has(state))) return 'archived';
    if (states.some((state) => DONE_STATUSES.has(state))) return 'done';
    if (states.some((state) => PLANNED_STATUSES.has(state)) || text(first(record, ['follow_up_at', 'callback_at', 'due_at']))) return 'planned';
    if (states.some((state) => WORKING_STATUSES.has(state)) || text(read(record, 'read_at'))) return 'working';
    if (states.some((state) => OPEN_STATUSES.has(state)) || !states.length) return 'new';
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
    if (!next) return null;
    if (/^(keine?|nicht|ohne)\b|kein(?:e|en|er|es)?\s+(?:aktion|handlungsbedarf|nächster schritt)|nichts zu tun|nicht erforderlich/.test(next)) return null;
    if (/rückruf|rueckruf|callback|zurückrufen|zurueckrufen|erneut versuchen/.test(next)) return 'Rückruf empfohlen';
    if (/termin|appointment/.test(next)) return 'Termin prüfen';
    if (/offerte|angebot|quote/.test(next)) return 'Offerte prüfen';
    if (/information|info\b|e-?mail|unterlagen|dokument|nachricht|zusenden|senden/.test(next)) return 'Information senden';
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

  function hasExplicitOffset(value) {
    const raw = text(value);
    return /[Zz]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw);
  }

  function qualifyZurichLocalTimestamp(value) {
    const raw = text(value);
    if (!raw) return '';
    if (hasExplicitOffset(raw)) return raw;

    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if (!match) return raw;

    const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
    const zoneName = new Intl.DateTimeFormat('en-US', {
      timeZone: ZURICH_TIME_ZONE,
      timeZoneName: 'longOffset'
    }).formatToParts(probe).find((part) => part.type === 'timeZoneName');
    const offsetMatch = zoneName && /^GMT([+-]\d{2}:\d{2})$/.exec(zoneName.value);
    if (!offsetMatch) return raw;

    const seconds = match[6] || '00';
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${seconds}${offsetMatch[1]}`;
  }

  function parsedTime(value) {
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(time) ? time : NaN;
  }

  function timestamp(record) {
    const startedAt = text(first(record, ['started_at', 'call_started_at', 'start_time']));
    const createdAt = text(first(record, ['created_at']));
    if (!startedAt) return createdAt || text(first(record, ['updated_at'])) || null;
    if (hasExplicitOffset(startedAt)) return startedAt;

    const localCandidate = qualifyZurichLocalTimestamp(startedAt);
    if (!createdAt) return localCandidate || startedAt;

    const localTime = parsedTime(localCandidate);
    const createdTime = parsedTime(createdAt);
    if (!Number.isFinite(localTime) || !Number.isFinite(createdTime)) return localCandidate || createdAt;

    // Legacy call rows stored offsetless start values as Europe/Zurich wall-clock.
    // New provider snapshots can expose the same UTC clock value without its trailing Z.
    // The calls table creates its row at call start in UTC, so a matching instant confirms
    // the local interpretation; a two-hour mismatch means created_at is the safe source.
    return Math.abs(localTime - createdTime) <= START_CREATED_AT_TOLERANCE_MS
      ? localCandidate
      : createdAt;
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
    timestamp,
    formatZurichDateTime,
    build
  });
});
