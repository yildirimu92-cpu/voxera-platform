(function initCustomerCallViewModel(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VoxeraCustomerCallViewModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCustomerCallViewModel() {
  'use strict';

  const ZURICH_TIME_ZONE = 'Europe/Zurich';

  const IDENTITY_TYPES = Object.freeze({
    RECORD_ID: 'record_id',
    EXTERNAL_CALL_ID: 'external_call_id',
    CONVERSATION_PROVIDER_ID: 'conversation_provider_id',
    CALL_ID: 'call_id'
  });

  // Precedence is deliberately defined per canonical field. Customer runtime
  // wrappers store the persisted Supabase row under `fields`, while server-side
  // and test records may be flat. Provider identity aliases are not treated as
  // interchangeable unless the merged ingest contract proves that relationship.
  const FIELD_PRECEDENCE = Object.freeze({
    recordId: Object.freeze(['fields.id', 'record.id']),
    externalCallId: Object.freeze(['fields.external_call_id', 'record.external_call_id']),
    conversationProviderId: Object.freeze([
      'fields.conversation_provider_id',
      'record.conversation_provider_id',
      'fields.elevenlabs_conversation_id',
      'record.elevenlabs_conversation_id',
      'fields.conversation_id',
      'record.conversation_id'
    ]),
    callId: Object.freeze(['fields.call_id', 'record.call_id']),
    liveStatus: Object.freeze(['fields.live_status', 'record.live_status']),
    callStatus: Object.freeze(['fields.call_status', 'record.call_status']),
    dashboardStatus: Object.freeze(['fields.dashboard_status', 'record.dashboard_status']),
    workflowStatus: Object.freeze(['fields.workflow_status', 'record.workflow_status']),
    legacyStatus: Object.freeze(['fields.status', 'record.status']),
    isLive: Object.freeze(['fields.is_live', 'record.is_live']),
    followUpAt: Object.freeze(['fields.follow_up_at', 'record.follow_up_at']),
    readAt: Object.freeze(['fields.read_at', 'record.read_at']),
    callerName: Object.freeze(['fields.caller_name', 'record.caller_name']),
    contactName: Object.freeze(['fields.contact_name', 'record.contact_name']),
    legacyName: Object.freeze(['fields.name', 'record.name']),
    callerPhone: Object.freeze(['fields.caller_phone', 'record.caller_phone']),
    callerNumber: Object.freeze(['fields.caller_number', 'record.caller_number']),
    phoneNumber: Object.freeze(['fields.phone_number', 'record.phone_number']),
    fromNumber: Object.freeze(['fields.from_number', 'record.from_number']),
    callSummaryShort: Object.freeze(['fields.call_summary_short', 'record.call_summary_short']),
    callSummary: Object.freeze(['fields.call_summary', 'record.call_summary']),
    summary: Object.freeze(['fields.summary', 'record.summary']),
    category: Object.freeze(['fields.category', 'record.category']),
    intent: Object.freeze(['fields.intent', 'record.intent']),
    requestType: Object.freeze(['fields.request_type', 'record.request_type']),
    leadQuality: Object.freeze(['fields.lead_quality', 'record.lead_quality']),
    relevance: Object.freeze(['fields.relevance', 'record.relevance']),
    callbackRequested: Object.freeze(['fields.callback_requested', 'record.callback_requested']),
    nextAction: Object.freeze(['fields.next_action', 'record.next_action']),
    actionRequired: Object.freeze(['fields.action_required', 'record.action_required']),
    durationSeconds: Object.freeze(['fields.duration_seconds', 'record.duration_seconds']),
    callDurationSecs: Object.freeze(['fields.call_duration_secs', 'record.call_duration_secs']),
    duration: Object.freeze(['fields.duration', 'record.duration']),
    createdAt: Object.freeze(['fields.created_at', 'record.created_at']),
    updatedAt: Object.freeze(['fields.updated_at', 'record.updated_at']),
    direction: Object.freeze(['fields.direction', 'record.direction'])
  });

  const LIVE_STATUSES = new Set(['incoming', 'ringing', 'queued', 'in_progress', 'active', 'live', 'ongoing', 'started']);
  const TERMINAL_STATUSES = new Set(['done', 'completed', 'ended', 'failed', 'aborted', 'interrupted']);
  const ARCHIVED_STATUSES = new Set(['archived']);
  const DONE_STATUSES = new Set(['done', 'completed', 'resolved']);
  const PLANNED_STATUSES = new Set(['planned', 'scheduled', 'follow_up', 'callback_planned']);
  const WORKING_STATUSES = new Set(['open', 'in_progress', 'processing']);
  const TERMINAL_LIFECYCLES = new Set(['done', 'archived']);
  const LIFECYCLE_RANK = Object.freeze({ live: 1, analysing: 2, new: 3, working: 4, planned: 5, done: 6, archived: 7 });

  const text = (value) => String(value == null ? '' : value).trim();
  const lower = (value) => text(value).toLowerCase();
  const truthy = (value) => value === true || ['true', '1', 'yes'].includes(lower(value));

  function nestedFields(record) {
    return record && record.fields && typeof record.fields === 'object' ? record.fields : {};
  }

  function hasValue(value) {
    return value !== undefined && value !== null && text(value) !== '';
  }

  function valueAt(record, path) {
    const separator = path.indexOf('.');
    const scope = separator === -1 ? 'record' : path.slice(0, separator);
    const key = separator === -1 ? path : path.slice(separator + 1);
    const source = scope === 'fields' ? nestedFields(record) : (record || {});
    const value = source[key];
    return hasValue(value) ? value : undefined;
  }

  function firstByPrecedence(record, paths) {
    for (const path of paths || []) {
      const value = valueAt(record, path);
      if (value !== undefined) return value;
    }
    return '';
  }

  function firstCanonical(record, fieldNames) {
    for (const fieldName of fieldNames || []) {
      const value = firstByPrecedence(record, FIELD_PRECEDENCE[fieldName]);
      if (hasValue(value)) return value;
    }
    return '';
  }

  function typedIdentity(type, value) {
    const normalized = text(value);
    return normalized ? Object.freeze({ type, value: normalized }) : null;
  }

  function identityKeys(record) {
    const keys = [
      typedIdentity(IDENTITY_TYPES.RECORD_ID, firstByPrecedence(record, FIELD_PRECEDENCE.recordId)),
      typedIdentity(IDENTITY_TYPES.EXTERNAL_CALL_ID, firstByPrecedence(record, FIELD_PRECEDENCE.externalCallId)),
      typedIdentity(IDENTITY_TYPES.CONVERSATION_PROVIDER_ID, firstByPrecedence(record, FIELD_PRECEDENCE.conversationProviderId)),
      typedIdentity(IDENTITY_TYPES.CALL_ID, firstByPrecedence(record, FIELD_PRECEDENCE.callId))
    ].filter(Boolean);

    const seen = new Set();
    return Object.freeze(keys.filter((key) => {
      const token = JSON.stringify([key.type, key.value]);
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    }));
  }

  function canonicalIdentity(record) {
    return identityKeys(record)[0] || null;
  }

  function canonicalId(record) {
    return canonicalIdentity(record)?.value || null;
  }

  function telephonyStatus(record) {
    return lower(firstCanonical(record, ['liveStatus', 'callStatus']));
  }

  function workflowStatus(record) {
    return lower(firstCanonical(record, ['dashboardStatus', 'workflowStatus', 'legacyStatus']));
  }

  function isLive(record) {
    const status = telephonyStatus(record);
    if (TERMINAL_STATUSES.has(status) || ARCHIVED_STATUSES.has(status)) return false;
    if (LIVE_STATUSES.has(status)) return true;
    return truthy(firstByPrecedence(record, FIELD_PRECEDENCE.isLive));
  }

  function summary(record) {
    return text(firstCanonical(record, ['callSummaryShort', 'callSummary', 'summary']));
  }

  function isAnalysisPending(record) {
    if (isLive(record)) return false;
    const status = telephonyStatus(record);
    const conversationIdentity = firstByPrecedence(record, FIELD_PRECEDENCE.conversationProviderId);
    return Boolean(text(conversationIdentity) && TERMINAL_STATUSES.has(status) && !summary(record));
  }

  function workflowState(record) {
    const status = workflowStatus(record);
    if (ARCHIVED_STATUSES.has(status)) return 'archived';
    if (DONE_STATUSES.has(status)) return 'done';
    if (PLANNED_STATUSES.has(status) || text(firstByPrecedence(record, FIELD_PRECEDENCE.followUpAt))) return 'planned';
    if (text(firstByPrecedence(record, FIELD_PRECEDENCE.readAt)) || WORKING_STATUSES.has(status)) return 'working';
    return 'new';
  }

  function lifecycle(record) {
    if (isLive(record)) return 'live';
    if (isAnalysisPending(record)) return 'analysing';
    return workflowState(record || {});
  }

  const LIFECYCLE_META = Object.freeze({
    live: Object.freeze({ label: 'Anruf läuft', tone: 'live', description: 'Lara spricht gerade mit dem Anrufer.' }),
    analysing: Object.freeze({ label: 'Wird ausgewertet', tone: 'neutral', description: 'Zusammenfassung und nächste Schritte werden erstellt.' }),
    new: Object.freeze({ label: 'Neu', tone: 'info', description: 'Noch nicht angesehen.' }),
    working: Object.freeze({ label: 'In Bearbeitung', tone: 'info', description: 'Die Anfrage wurde geöffnet oder bearbeitet.' }),
    planned: Object.freeze({ label: 'Rückruf geplant', tone: 'attention', description: 'Eine Folgeaktion ist terminiert.' }),
    done: Object.freeze({ label: 'Erledigt', tone: 'success', description: 'Die Anfrage ist abgeschlossen.' }),
    archived: Object.freeze({ label: 'Archiviert', tone: 'muted', description: 'Die Anfrage wurde abgelegt.' })
  });

  function category(record) {
    const raw = lower(firstCanonical(record, ['category', 'intent', 'requestType']));
    if (!raw || ['inbound', 'incoming', 'eingehender anruf', 'call'].includes(raw)) return null;
    const map = {
      appointment: 'Terminanfrage',
      terminanfrage: 'Terminanfrage',
      appointment_request: 'Terminanfrage',
      callback: 'Rückrufwunsch',
      rueckruf: 'Rückrufwunsch',
      rückruf: 'Rückrufwunsch',
      quote: 'Offertenanfrage',
      offerte: 'Offertenanfrage',
      offertenanfrage: 'Offertenanfrage',
      support: 'Supportanfrage',
      information: 'Informationsanfrage',
      sonstiges: 'Sonstiges'
    };
    return map[raw] || text(firstCanonical(record, ['category', 'intent', 'requestType']));
  }

  function leadQuality(record) {
    const raw = lower(firstCanonical(record, ['leadQuality', 'relevance']));
    if (!['hot', 'warm', 'cold', 'kalt', 'heiss', 'heiß'].includes(raw)) return null;
    if (!category(record)) return null;
    if (['hot', 'heiss', 'heiß'].includes(raw)) return 'Hot';
    if (raw === 'warm') return 'Warm';
    return 'Kalt';
  }

  function outcome(record) {
    if (truthy(firstByPrecedence(record, FIELD_PRECEDENCE.callbackRequested))) return 'Rückruf empfohlen';
    const next = lower(firstCanonical(record, ['nextAction', 'actionRequired']));
    if (!next) return null;
    if (/^(keine?|nicht|ohne)\b|kein(?:e|en|er|es)?\s+(?:aktion|handlungsbedarf|nächster schritt)|nichts zu tun|nicht erforderlich/.test(next)) return null;
    if (/rückruf|rueckruf|callback|zurückrufen|zurueckrufen|erneut versuchen/.test(next)) return 'Rückruf empfohlen';
    if (/termin|appointment/.test(next)) return 'Termin prüfen';
    if (/offerte|angebot|quote/.test(next)) return 'Offerte prüfen';
    if (/information|info\b|e-?mail|unterlagen|dokument|nachricht|zusenden|senden/.test(next)) return 'Information senden';
    return null;
  }

  function displayName(record) {
    return text(firstCanonical(record, ['callerName', 'contactName', 'legacyName'])) || 'Unbekannter Anrufer';
  }

  function phone(record) {
    return text(firstCanonical(record, ['callerPhone', 'callerNumber', 'phoneNumber', 'fromNumber'])) || null;
  }

  function durationSeconds(record) {
    const value = Number(firstCanonical(record, ['durationSeconds', 'callDurationSecs', 'duration']));
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }

  function hasExplicitOffset(value) {
    const raw = text(value);
    return /[Zz]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw);
  }

  // The merged call ingest writes created_at/updated_at with Date#toISOString.
  // If one of those known database fields is offsetless, preserve its writer
  // semantics by qualifying it as UTC. Generic provider or legacy strings are
  // not qualified by formatZurichDateTime().
  function normalizeDatabaseTimestamp(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : '';
    const raw = text(value);
    if (!raw || hasExplicitOffset(raw)) return raw;
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) return raw;
    return raw.replace(' ', 'T') + 'Z';
  }

  function timestamp(record) {
    const createdAt = normalizeDatabaseTimestamp(firstByPrecedence(record, FIELD_PRECEDENCE.createdAt));
    if (createdAt) return createdAt;
    const updatedAt = normalizeDatabaseTimestamp(firstByPrecedence(record, FIELD_PRECEDENCE.updatedAt));
    return updatedAt || null;
  }

  function formatZurichDateTime(value, options) {
    if (!value) return '';
    if (typeof value === 'string' && !hasExplicitOffset(value) && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value)) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-CH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(options || {}),
      timeZone: ZURICH_TIME_ZONE
    }).format(date);
  }

  function freshnessTimestamp(record) {
    const value = normalizeDatabaseTimestamp(firstByPrecedence(record, FIELD_PRECEDENCE.updatedAt)) || timestamp(record);
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  function preferredRecord(current, candidate) {
    const currentLifecycle = lifecycle(current);
    const candidateLifecycle = lifecycle(candidate);
    const currentTerminal = TERMINAL_LIFECYCLES.has(currentLifecycle);
    const candidateTerminal = TERMINAL_LIFECYCLES.has(candidateLifecycle);

    if (currentTerminal !== candidateTerminal) return candidateTerminal ? candidate : current;
    if (currentTerminal && candidateTerminal && currentLifecycle !== candidateLifecycle) {
      return LIFECYCLE_RANK[candidateLifecycle] > LIFECYCLE_RANK[currentLifecycle] ? candidate : current;
    }

    return freshnessTimestamp(candidate) > freshnessTimestamp(current) ? candidate : current;
  }

  function identityToken(identity) {
    return JSON.stringify([identity.type, identity.value]);
  }

  function dedupe(records) {
    const groups = [];
    const withoutIdentity = [];

    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || typeof record !== 'object') return;
      const identities = identityKeys(record);
      if (!identities.length) {
        withoutIdentity.push(record);
        return;
      }

      const tokens = identities.map(identityToken);
      const matches = groups.filter((group) => tokens.some((token) => group.tokens.has(token)));
      if (!matches.length) {
        groups.push({ record, tokens: new Set(tokens) });
        return;
      }

      const primary = matches[0];
      let selected = preferredRecord(primary.record, record);
      tokens.forEach((token) => primary.tokens.add(token));

      matches.slice(1).forEach((group) => {
        selected = preferredRecord(selected, group.record);
        group.tokens.forEach((token) => primary.tokens.add(token));
        const index = groups.indexOf(group);
        if (index >= 0) groups.splice(index, 1);
      });

      primary.record = selected;
    });

    return [...groups.map((group) => group.record), ...withoutIdentity];
  }

  function build(record) {
    const source = record || {};
    const state = lifecycle(source);
    return {
      id: canonicalId(source),
      identityKeys: identityKeys(source),
      lifecycle: state,
      lifecycleMeta: LIFECYCLE_META[state],
      name: displayName(source),
      phone: phone(source),
      summary: summary(source),
      category: category(source),
      leadQuality: leadQuality(source),
      outcome: outcome(source),
      durationSeconds: durationSeconds(source),
      timestamp: timestamp(source),
      direction: lower(firstByPrecedence(source, FIELD_PRECEDENCE.direction)) || null
    };
  }

  return Object.freeze({
    ZURICH_TIME_ZONE,
    IDENTITY_TYPES,
    FIELD_PRECEDENCE,
    LIFECYCLE_META,
    identityKeys,
    canonicalIdentity,
    canonicalId,
    lifecycle,
    category,
    leadQuality,
    outcome,
    normalizeDatabaseTimestamp,
    timestamp,
    formatZurichDateTime,
    dedupe,
    build
  });
});
