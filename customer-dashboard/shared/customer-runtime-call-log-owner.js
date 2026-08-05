(function initCustomerCallLogOwner(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerCallLogOwnerInstalled) return;
  root.__vxCustomerCallLogOwnerInstalled = true;

  var latestActivityRecords = [];
  var installed = false;
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

  var ICONS = {
    'clipboard-check': '<path d="M9 5h6"/><path d="M9 3h6a2 2 0 0 1 2 2v1h2v15H5V6h2V5a2 2 0 0 1 2-2Z"/><path d="m9 14 2 2 4-4"/>',
    'phone-incoming': '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.9.32 1.84.55 2.8.68A2 2 0 0 1 22 16.92Z"/>',
    'phone-call': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.9.32 1.84.55 2.8.68A2 2 0 0 1 22 16.92Z"/><path d="M14.05 2a9 9 0 0 1 8 8"/><path d="M14.05 6A5 5 0 0 1 18 10"/>',
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

  function installOverrides() {
    if (installed) return;
    if (typeof root.vxHeuteRenderActivityList !== 'function' || typeof root.renderDashPriorityList !== 'function') return;
    installed = true;

    installInboxBadgeRule();
    root.vxHeuteRenderActivityList = function customerCallLogActivityOwner(records) {
      latestActivityRecords = list(records);
      installInboxBadgeRule();
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
    installOverrides();
    if (installed || attempts > 160) root.clearInterval(timer);
  }, 50);
})(typeof globalThis !== 'undefined' ? globalThis : this);
