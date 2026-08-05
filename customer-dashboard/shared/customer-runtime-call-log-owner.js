(function initCustomerCallLogOwner(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerCallLogOwnerInstalled) return;
  root.__vxCustomerCallLogOwnerInstalled = true;

  var latestActivityRecords = [];
  var installed = false;
  var detailInstalled = false;
  var splitDetailInstalled = false;
  var store = null;
  var lastMarkup = '';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char];
    });
  }

  function text(value) { return String(value == null ? '' : value).trim(); }
  function lower(value) { return text(value).toLowerCase(); }
  function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

  function fields(record) {
    return record && record.fields && typeof record.fields === 'object' ? record.fields : {};
  }

  function read(record, key) {
    if (record && record[key] !== undefined && record[key] !== null && text(record[key]) !== '') return record[key];
    var nested = fields(record);
    if (nested[key] !== undefined && nested[key] !== null && text(nested[key]) !== '') return nested[key];
    return '';
  }

  function first(record, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var value = read(record, keys[i]);
      if (value !== '') return value;
    }
    return '';
  }

  function isManual(record) {
    try { return typeof root.isManualTaskRecord === 'function' && root.isManualTaskRecord(record); }
    catch (_error) { return false; }
  }

  function lifecycle(record) {
    var viewModel = root.VoxeraCustomerCallViewModel;
    if (viewModel && typeof viewModel.lifecycle === 'function') {
      try { return viewModel.lifecycle(record); } catch (_error) {}
    }
    var liveState = lower(first(record, ['live_status', 'call_status', 'telephony_status']));
    if (['incoming', 'ringing', 'queued', 'in_progress', 'active', 'live', 'ongoing', 'started', 'läuft', 'laufend'].indexOf(liveState) !== -1) return 'live';
    if (['analyzing', 'analysing', 'processing', 'transcribing', 'pending_analysis'].indexOf(liveState) !== -1) return 'analysing';
    return '';
  }

  function isUnreadExcludedRecord(record) {
    if (!record || isManual(record)) return false;
    var state = lifecycle(record);
    return state === 'live' || state === 'analysing';
  }

  function priorityRecords() {
    try {
      if (typeof _dashPriorityAllRecords !== 'undefined') return list(_dashPriorityAllRecords);
    } catch (_error) {}
    return [];
  }

  function recordId(record) {
    return text(first(record, [
      'elevenlabs_conversation_id',
      'conversation_id',
      'call_id',
      'id'
    ]));
  }

  function detailId(record) {
    return text(first(record, ['id', 'call_id', 'task_id'])) || recordId(record);
  }

  function allRecords() {
    return priorityRecords().concat(latestActivityRecords).filter(Boolean);
  }

  function mergeCallRecords() {
    return allRecords().filter(function (record) { return !isManual(record); });
  }

  function formatTime(model) {
    var value = model && model.timestamp;
    if (!value) return '';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function dateKey(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  }

  function manualEntry(record) {
    var plannedAt = first(record, ['follow_up_at', 'due_at', 'scheduled_at']);
    var planned = Boolean(plannedAt);
    return {
      record: record,
      model: {
        id: detailId(record),
        lifecycle: planned ? 'planned' : 'working',
        lifecycleMeta: planned
          ? { label: 'Geplant', tone: 'attention' }
          : { label: 'Offen', tone: 'info' },
        name: text(first(record, ['title', 'task_title', 'next_action'])) || 'Aufgabe',
        phone: text(first(record, ['phone', 'caller_phone', 'phone_number'])) || null,
        summary: text(first(record, ['note', 'notes', 'description'])),
        category: null,
        outcome: 'Manuelle Aufgabe',
        timestamp: plannedAt || first(record, ['created_at', 'updated_at'])
      }
    };
  }

  function taskEntries(state) {
    var seen = new Set();
    var calls = list(state && state.tasks);
    var manual = priorityRecords().filter(isManual).map(manualEntry);
    return calls.concat(manual).filter(function (entry) {
      if (!entry || !entry.model) return false;
      var id = recordId(entry.record) || detailId(entry.record) || text(entry.model.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function isImportantNow(entry) {
    if (!entry || !entry.model) return false;
    if (entry.model.lifecycle !== 'planned') return true;
    var due = first(entry.record, ['follow_up_at', 'callback_at', 'due_at', 'scheduled_at']);
    if (!due) return false;
    var dueKey = dateKey(due);
    var todayKey = dateKey(new Date());
    return Boolean(dueKey && todayKey && dueKey <= todayKey);
  }

  function canonicalImportantNowCount() {
    var state = store && typeof store.current === 'function' ? store.current() : null;
    if (!state) return null;
    return taskEntries(state).filter(isImportantNow).length;
  }

  function installTodayKpiRule() {
    var previousCounts = root.vxGetHeuteKpiCounts;
    if (typeof previousCounts !== 'function' || previousCounts._vxCallLogOwnerWrapped) return;

    var wrapped = function customerCallLogKpiCounts(records, manualTasks) {
      var base = previousCounts(records, manualTasks) || {};
      var importantNowCount = canonicalImportantNowCount();
      if (importantNowCount !== null) base.importantNow = importantNowCount;
      return base;
    };
    wrapped._vxCallLogOwnerWrapped = true;
    root.vxGetHeuteKpiCounts = wrapped;
  }

  function readVisibleCount(id) {
    var node = root.document.getElementById(id);
    var value = node ? parseInt(text(node.textContent), 10) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function syncTodayMetrics(tasks) {
    var entries = list(tasks);
    var plannedCount = entries.filter(function (entry) {
      return entry && entry.model && entry.model.lifecycle === 'planned';
    }).length;
    var importantNowCount = entries.filter(isImportantNow).length;
    var openCount = readVisibleCount('kpi-today-new');

    var importantValue = root.document.getElementById('kpi-done-new');
    if (importantValue) importantValue.textContent = String(importantNowCount);

    var importantNote = root.document.getElementById('kpi-done-note');
    if (importantNote) importantNote.textContent = importantNowCount > 0 ? 'Konkrete nächste Schritte' : 'Aktuell nichts dringend';

    var greetingSub = root.document.getElementById('dash-greeting-sub');
    if (greetingSub) {
      var parts = [];
      if (openCount > 0) parts.push(openCount + ' offen');
      if (plannedCount > 0) parts.push(plannedCount + ' geplant');
      if (importantNowCount > 0) parts.push(importantNowCount + ' priorisiert');
      greetingSub.textContent = parts.length ? parts.join(' · ') : 'Keine offenen Anfragen oder Aufgaben';
    }
  }

  var ICONS = {
    'clipboard-check': '<path d="M9 5h6"/><path d="M9 3h6a2 2 0 0 1 2 2v1h2v15H5V6h2V5a2 2 0 0 1 2-2Z"/><path d="m9 14 2 2 4-4"/>',
    'phone-incoming': '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.9.32 1.84.55 2.8.68A2 2 0 0 1 22 16.92Z"/>',
    'phone-call': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.9.32 1.84.55 2.8.68A2 2 0 0 1 22 16.92Z"/><path d="M14.05 2a9 9 0 0 1 8 8"/><path d="M14.05 6A5 5 0 0 1 18 10"/>',
    'audio-lines': '<path d="M2 10v4"/><path d="M6 6v12"/><path d="M10 3v18"/><path d="M14 8v8"/><path d="M18 5v14"/><path d="M22 10v4"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>'
  };

  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  function icon(name) {
    return '<span class="vx-call-log-icon" aria-hidden="true">' + svg(name) + '</span>';
  }

  function status(model) {
    var meta = model && model.lifecycleMeta || {};
    return '<span class="vx-call-log-status" data-tone="' + esc(meta.tone || 'info') + '">' + esc(meta.label || 'Neu') + '</span>';
  }

  function chevron() {
    return '<span class="vx-call-log-chevron" aria-hidden="true">' + svg('chevron-right') + '</span>';
  }

  function row(entry, mode) {
    var model = entry.model;
    var id = detailId(entry.record) || model.id || recordId(entry.record);
    var taskMode = mode === 'task';
    var manual = isManual(entry.record);
    var primaryMeta = taskMode
      ? (model.outcome || model.lifecycleMeta.label)
      : formatTime(model);
    var secondaryMeta = model.phone || '';
    var metaLine = [primaryMeta, secondaryMeta].filter(Boolean).join(' · ');
    var summaryText = text(model.summary);
    var summary = summaryText
      ? '<div class="vx-call-log-row__summary">' + esc(summaryText) + '</div>'
      : '';

    return '<div class="vx-call-log-row" role="button" tabindex="0" data-vx-call-id="' + esc(id) + '">' +
      icon(manual ? 'clipboard-check' : 'phone-incoming') +
      '<div class="vx-call-log-row__main">' +
        '<div class="vx-call-log-row__title">' + esc(model.name) + '</div>' +
        '<div class="vx-call-log-row__meta">' + esc(metaLine || (taskMode ? 'Nächster Schritt' : 'Anruf')) + '</div>' +
        summary +
      '</div>' +
      '<div class="vx-call-log-row__aside">' + status(model) + chevron() + '</div>' +
    '</div>';
  }

  function activeCard(entry, analysing) {
    if (!entry) return '';
    var model = entry.model;
    var label = analysing ? 'Wird ausgewertet' : 'Anruf läuft';
    var detail = analysing
      ? 'Zusammenfassung und nächste Schritte werden erstellt.'
      : 'Lara spricht gerade mit dem Anrufer.';
    var liveMeta = [model.phone || 'Nummer wird ermittelt', formatTime(model)].filter(Boolean).join(' · ');

    return '<section class="vx-call-log-card" data-vx-call-log-section="active">' +
      '<div class="vx-call-log-card__head">' +
        '<div><div class="vx-call-log-card__title">' + label + '</div><div class="vx-call-log-card__subtitle">' + detail + '</div></div>' +
        '<span class="vx-call-log-status" data-tone="live">' + (analysing ? 'Analyse' : 'Live') + '</span>' +
      '</div>' +
      '<div class="vx-call-log-list">' +
        '<div class="vx-call-log-row">' +
          icon(analysing ? 'audio-lines' : 'phone-call') +
          '<div class="vx-call-log-row__main"><div class="vx-call-log-row__title">' + esc(model.name) + '</div>' +
          '<div class="vx-call-log-row__meta">' + esc(liveMeta) + '</div></div>' +
          '<div class="vx-call-log-row__aside"></div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function section(title, subtitle, entries, mode, emptyText, key, hideWhenEmpty) {
    if (hideWhenEmpty && !entries.length) return '';
    return '<section class="vx-call-log-card" data-vx-call-log-section="' + key + '">' +
      '<div class="vx-call-log-card__head">' +
        '<div><div class="vx-call-log-card__title">' + title + '</div><div class="vx-call-log-card__subtitle">' + subtitle + '</div></div>' +
        '<span class="vx-call-log-count">' + entries.length + '</span>' +
      '</div>' +
      (entries.length
        ? '<div class="vx-call-log-list">' + entries.map(function (entry) { return row(entry, mode); }).join('') + '</div>'
        : '<div class="vx-call-log-empty">' + emptyText + '</div>') +
    '</section>';
  }

  function ensureHost() {
    var priority = root.document.getElementById('dash-priority-section');
    var host = root.document.getElementById('vx-customer-call-log');
    if (!host && priority && priority.parentNode) {
      host = root.document.createElement('div');
      host.id = 'vx-customer-call-log';
      priority.parentNode.insertBefore(host, priority);
    }
    if (!host) return null;

    ['dash-priority-section', 'dash-activity-section', 'dash-today-calls-section', 'dash-today-done-section'].forEach(function (id) {
      var node = root.document.getElementById(id);
      if (node) node.remove();
    });
    return host;
  }

  function openRecord(id) {
    if (!id) return;
    var record = allRecords().find(function (item) {
      return detailId(item) === id || recordId(item) === id;
    });
    if (!record) return;

    var targetId = detailId(record) || id;
    try {
      if (isManual(record)) {
        if (typeof root.showTaskDetail === 'function') root.showTaskDetail(targetId);
        else if (typeof root.openManualTaskDetail === 'function') root.openManualTaskDetail(record);
        else if (typeof root.openTaskDetail === 'function') root.openTaskDetail(record);
        return;
      }
      if (typeof root.showCallDetail === 'function') root.showCallDetail(targetId, { forceFullscreen: true });
      else if (typeof root.openCallDetail === 'function') root.openCallDetail(record);
      else if (typeof root.openInquiryDetail === 'function') root.openInquiryDetail(targetId);
    } catch (_error) {}
  }

  function bindRows(host) {
    host.querySelectorAll('[data-vx-call-id]').forEach(function (rowNode) {
      function activate() { openRecord(rowNode.getAttribute('data-vx-call-id')); }
      rowNode.addEventListener('click', activate);
      rowNode.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });
    });
  }

  function installInboxBadgeRule() {
    var previousEligible = root.vxIsUnreadEligibleRecord;
    if (typeof previousEligible !== 'function' || previousEligible._vxCallLogOwnerWrapped) return;

    var wrapped = function customerCallLogUnreadEligibility(record) {
      if (isUnreadExcludedRecord(record)) return false;
      return previousEligible(record);
    };
    wrapped._vxCallLogOwnerWrapped = true;
    root.vxIsUnreadEligibleRecord = wrapped;

    try {
      if (typeof root.vxUpdateAnfragenNavBadges === 'function') root.vxUpdateAnfragenNavBadges();
    } catch (_error) {}
  }

  function render() {
    var modelApi = root.VoxeraCustomerCallLogModel;
    if (!modelApi || typeof modelApi.createStableStore !== 'function') return;
    if (!store) store = modelApi.createStableStore({ liveGraceMs: 12000 });

    var update = store.update(mergeCallRecords());
    var state = update.state;
    var tasks = taskEntries(state);
    var history = list(state.history);

    installTodayKpiRule();
    syncTodayMetrics(tasks);

    var markup = activeCard(state.active || state.analysing, Boolean(state.analysing)) +
      section('Offene Aufgaben', 'Priorisierte Rückrufe und nächste Schritte.', tasks, 'task', '', 'tasks', true) +
      section('Letzte Anrufe', 'Die neuesten Gespräche auf einen Blick.', history.slice(0, 5), 'history', 'Heute sind noch keine abgeschlossenen Anrufe vorhanden.', 'history', false);

    if (markup === lastMarkup && root.document.getElementById('vx-customer-call-log')) return;
    var host = ensureHost();
    if (!host) return;

    host.innerHTML = markup;
    lastMarkup = markup;
    bindRows(host);
  }

  function sameZurichDay(a, b) {
    return Boolean(a && b && dateKey(a) === dateKey(b));
  }

  function formatDetailTimestamp(value) {
    if (!value) return '';
    var date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';

    var now = new Date();
    var yesterday = new Date(now.getTime() - 86400000);
    var time = new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit'
    }).format(date);
    if (sameZurichDay(date, now)) return 'Heute, ' + time;
    if (sameZurichDay(date, yesterday)) return 'Gestern, ' + time;
    return new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(date) + ', ' + time;
  }

  function formatDuration(seconds) {
    var value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return '';
    value = Math.round(value);
    if (value < 60) return value + ' Sek.';
    var minutes = Math.floor(value / 60);
    var remainder = value % 60;
    return remainder ? minutes + ' Min. ' + remainder + ' Sek.' : minutes + ' Min.';
  }

  function initials(name) {
    var parts = text(name).split(/\s+/).filter(Boolean);
    if (!parts.length || /^unbekannter anrufer$/i.test(text(name))) return 'UA';
    return parts.map(function (part) { return text(part).charAt(0).toUpperCase(); }).join('').slice(0, 2) || 'UA';
  }

  function detailModel(record) {
    var vm = root.VoxeraCustomerCallViewModel;
    if (vm && typeof vm.build === 'function') {
      try { return vm.build(record || {}); } catch (_error) {}
    }
    var timestamp = '';
    try {
      timestamp = typeof root.getRecordTimestamp === 'function'
        ? root.getRecordTimestamp(record)
        : first(record, ['started_at', 'call_started_at', 'start_time', 'created_at', 'updated_at']);
    } catch (_error2) {
      timestamp = first(record, ['started_at', 'call_started_at', 'start_time', 'created_at', 'updated_at']);
    }
    return {
      id: detailId(record),
      lifecycle: lifecycle(record) || 'new',
      lifecycleMeta: { label: 'Neu', tone: 'info' },
      name: text(first(record, ['caller_name', 'contact_name', 'name'])) || 'Unbekannter Anrufer',
      phone: text(first(record, ['caller_phone', 'caller_number', 'phone_number', 'from_number'])) || null,
      summary: text(first(record, ['call_summary_short', 'call_summary', 'summary'])),
      category: text(first(record, ['category', 'intent', 'request_type'])) || null,
      leadQuality: text(first(record, ['lead_quality', 'relevance'])) || null,
      outcome: null,
      durationSeconds: Number(first(record, ['duration_seconds', 'duration', 'call_duration_secs'])) || null,
      timestamp: timestamp
    };
  }

  function meaningfulNextAction(record, model) {
    var raw = text(first(record, ['next_action', 'action_required', 'recommended_action']));
    var normalized = lower(raw);
    if (/^(keine?|nicht|ohne)\b/.test(normalized) || /kein(?:e|en|er|es)?\s+(?:aktion|handlungsbedarf|nächster schritt)|nichts zu tun|nicht erforderlich/.test(normalized)) raw = '';
    if (raw) return { title: text(model && model.outcome) || 'Nächster Schritt', text: raw };
    if (model && model.outcome) return { title: model.outcome, text: 'Die Anfrage benötigt eine konkrete Folgeaktion.' };
    return null;
  }

  function detailTone(model) {
    var meta = model && model.lifecycleMeta || {};
    return text(meta.tone || 'info');
  }

  function actionMarkup(model) {
    var lifecycleState = text(model && model.lifecycle);
    var phoneButton = model && model.phone
      ? '<button type="button" class="vx-call-detail-lite__action vx-call-detail-lite__action--primary" onclick="vxCallDetailAnrufen()"><i class="ph-bold ph-phone" aria-hidden="true"></i><span>Anrufen</span></button>'
      : '';
    var callbackButton = '<button type="button" class="vx-call-detail-lite__action' + (phoneButton ? '' : ' vx-call-detail-lite__action--primary') + '" onclick="vxCallDetailFaelligkeit({ mode: \'callback\' })"><i class="ph-bold ph-calendar-plus" aria-hidden="true"></i><span>Rückruf planen</span></button>';
    var doneButton = lifecycleState !== 'done' && lifecycleState !== 'archived'
      ? '<button type="button" class="vx-call-detail-lite__action vx-call-detail-lite__action--quiet" onclick="vxCallDetailErledigt()"><i class="ph-bold ph-check" aria-hidden="true"></i><span>Erledigen</span></button>'
      : '';
    return '<div class="vx-call-detail-lite__actions">' + phoneButton + callbackButton + doneButton + '</div>';
  }

  function detailCard(title, eyebrow, body, modifier) {
    if (!text(body)) return '';
    return '<section class="vx-call-detail-lite__card' + (modifier ? ' ' + modifier : '') + '">' +
      '<div class="vx-call-detail-lite__card-head"><h2>' + esc(title) + '</h2>' +
      (eyebrow ? '<span>' + esc(eyebrow) + '</span>' : '') + '</div>' +
      '<div class="vx-call-detail-lite__card-body">' + esc(body) + '</div>' +
    '</section>';
  }

  function detailBodyMarkup(record, options) {
    options = options || {};
    var model = detailModel(record);
    var stateMeta = model.lifecycleMeta || { label: 'Neu', tone: 'info' };
    var timestamp = formatDetailTimestamp(model.timestamp);
    var duration = formatDuration(model.durationSeconds);
    var meta = [timestamp, duration].filter(Boolean).join(' · ');
    var nextAction = meaningfulNextAction(record, model);
    var summary = text(model.summary);
    if (!summary && model.lifecycle === 'analysing') summary = 'Das Gespräch wird noch ausgewertet. Die Zusammenfassung erscheint automatisch, sobald die Analyse abgeschlossen ist.';
    if (!summary) summary = 'Für dieses Gespräch ist keine Zusammenfassung verfügbar.';

    var details = [
      { label: 'Kategorie', value: model.category || 'Nicht erkannt' },
      { label: 'Relevanz', value: model.leadQuality || 'Nicht bewertet' },
      { label: 'Status', value: stateMeta.label || 'Neu' },
      { label: 'Dauer', value: duration || 'Nicht verfügbar' }
    ];

    var detailRows = details.map(function (item) {
      return '<div class="vx-call-detail-lite__detail-row"><span>' + esc(item.label) + '</span><strong>' + esc(item.value) + '</strong></div>';
    }).join('');

    var avatarId = options.embedded ? '' : ' id="call-detail-avatar"';
    var titleId = options.embedded ? '' : ' id="call-detail-title"';
    var subtitleId = options.embedded ? '' : ' id="call-detail-subtitle"';
    var archiveAction = model.lifecycle === 'archived' ? '' :
      '<button type="button" class="vx-call-detail-lite__archive" onclick="vxCallDetailArchivieren()"><i class="ph-bold ph-archive" aria-hidden="true"></i><span>Archivieren</span></button>';

    return '<div class="vx-call-detail-lite__shell' + (options.embedded ? ' vx-call-detail-lite__shell--embedded' : '') + '">' +
      '<section class="vx-call-detail-lite__identity">' +
        '<div class="vx-call-detail-lite__avatar"' + avatarId + '>' + esc(initials(model.name)) + '</div>' +
        '<div class="vx-call-detail-lite__identity-copy">' +
          '<h1' + titleId + '>' + esc(model.name || 'Unbekannter Anrufer') + '</h1>' +
          (model.phone ? '<a class="vx-call-detail-lite__phone" href="tel:' + esc(model.phone) + '">' + esc(model.phone) + '</a>' : '') +
          '<div class="vx-call-detail-lite__meta"' + subtitleId + '>' + esc(meta || 'Anruf') + '</div>' +
        '</div>' +
        '<span class="vx-call-detail-lite__status" data-tone="' + esc(detailTone(model)) + '">' + esc(stateMeta.label || 'Neu') + '</span>' +
      '</section>' +
      actionMarkup(model) +
      '<div class="vx-call-detail-lite__body">' +
        detailCard('Zusammenfassung', 'Automatisch erstellt', summary, '') +
        (nextAction ? detailCard(nextAction.title, 'Empfehlung', nextAction.text, 'vx-call-detail-lite__card--next') : '') +
        '<details class="vx-call-detail-lite__details">' +
          '<summary><span>Weitere Details</span><i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary>' +
          '<div class="vx-call-detail-lite__details-grid">' + detailRows + '</div>' +
        '</details>' +
        archiveAction +
      '</div>' +
    '</div>';
  }

  function topbarMarkup() {
    return '<div class="vx-call-detail-lite__topbar-inner">' +
      '<button type="button" class="vx-call-detail-lite__nav" aria-label="Zurück zu Anfragen" onclick="event.stopPropagation();vxHandleDetailBack();">' +
        '<i class="ph-bold ph-arrow-left" aria-hidden="true"></i>' +
      '</button>' +
      '<div class="vx-call-detail-lite__topbar-copy"><span>Anfrage</span><strong>Anrufdetails</strong></div>' +
      '<div id="call-detail-quick-actions" class="vx-call-detail-lite__topbar-actions">' +
        '<button type="button" class="vx-call-detail-lite__nav" aria-label="Detail schliessen" onclick="event.stopPropagation();vxHandleDetailBack();"><i class="ph-bold ph-x" aria-hidden="true"></i></button>' +
      '</div>' +
      '<span id="call-detail-banner-date" hidden></span>' +
    '</div>';
  }

  function renderOwnedCallDetail(record) {
    if (!record) return;
    var page = root.document.getElementById('call-detail-page');
    if (!page) return;
    var pageOpen = page.classList.contains('is-open') || page.style.display === 'block' || page.style.display === 'flex';
    if (!pageOpen) return;

    var banner = root.document.getElementById('call-detail-banner');
    var content = root.document.getElementById('call-detail-content');
    var statsWrap = root.document.getElementById('call-detail-stats-wrap');
    var scrollWrap = root.document.getElementById('call-detail-scroll-wrap');
    var bottomBar = root.document.getElementById('vx-cd-bottom-bar');

    page.classList.add('vx-call-detail-lite');
    if (scrollWrap) scrollWrap.classList.add('vx-call-detail-lite__scroll');
    if (banner) {
      banner.className = 'vx-call-detail-lite__topbar';
      banner.removeAttribute('style');
      banner.innerHTML = topbarMarkup();
    }
    if (statsWrap) statsWrap.style.display = 'none';
    if (bottomBar) bottomBar.style.display = 'none';
    if (content) {
      content.className = 'vx-call-detail-lite__content';
      content.innerHTML = detailBodyMarkup(record, { embedded: false });
    }
  }

  function renderOwnedSplitDetail(record, options) {
    options = options || {};
    var host = options.hostEl || root.document.getElementById('requests-detail-v2');
    if (!host || !record) return;
    host.classList.add('vx-call-detail-lite-host');
    host.innerHTML = detailBodyMarkup(record, { embedded: true });
  }

  function installDetailOwner() {
    var current = root.renderCallDetailPage;
    if (typeof current !== 'function') return false;
    if (current._vxCallLogDetailOwner) {
      detailInstalled = true;
      return true;
    }
    var owned = function customerCallLogDetailOwner(call) {
      return renderOwnedCallDetail(call);
    };
    owned._vxCallLogDetailOwner = true;
    owned._vxPrevious = current;
    root.renderCallDetailPage = owned;
    detailInstalled = true;
    return true;
  }

  function installSplitDetailOwner() {
    var current = root.vxRenderRequestsDetailV2;
    if (typeof current !== 'function') return false;
    if (current._vxCallLogSplitDetailOwner) {
      splitDetailInstalled = true;
      return true;
    }
    var owned = function customerCallLogSplitDetailOwner(record, options) {
      return renderOwnedSplitDetail(record, options);
    };
    owned._vxCallLogSplitDetailOwner = true;
    owned._vxPrevious = current;
    root.vxRenderRequestsDetailV2 = owned;
    try { vxRenderRequestsDetailV2 = owned; } catch (_error) {}
    splitDetailInstalled = true;
    return true;
  }

  function installOverrides() {
    if (installed) return;
    if (typeof root.vxHeuteRenderActivityList !== 'function' || typeof root.renderDashPriorityList !== 'function') return;
    installed = true;

    installInboxBadgeRule();
    installTodayKpiRule();
    root.vxHeuteRenderActivityList = function customerCallLogActivityOwner(records) {
      latestActivityRecords = list(records);
      installInboxBadgeRule();
      installTodayKpiRule();
      render();
    };
    root.vxHeuteRenderScopedList = function customerCallLogScopedOwner() { render(); };
    root.renderDashPriorityList = function customerCallLogPriorityOwner() { render(); };
    root.vxDashShowAllImportant = function customerCallLogOpenTasks() {
      var target = root.document.querySelector('[data-vx-call-log-section="tasks"]');
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return false;
    };
    render();
  }

  var attempts = 0;
  var timer = root.setInterval(function () {
    attempts += 1;
    installDetailOwner();
    installSplitDetailOwner();
    installOverrides();
    if ((installed && detailInstalled && splitDetailInstalled) || attempts > 200) root.clearInterval(timer);
  }, 50);
})(typeof globalThis !== 'undefined' ? globalThis : this);
