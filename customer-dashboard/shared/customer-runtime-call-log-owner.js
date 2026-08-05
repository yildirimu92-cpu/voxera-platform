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
    return record && record.fields ? record.fields : record || {};
  }

  function isManual(record) {
    try { return typeof root.isManualTaskRecord === 'function' && root.isManualTaskRecord(record); }
    catch (_error) { return false; }
  }

  function isActiveCallRecord(record) {
    if (!record || isManual(record)) return false;
    var f = fields(record);
    if (record.is_live === true || f.is_live === true) return true;
    var liveState = lower(
      record.live_status || f.live_status ||
      record.call_status || f.call_status
    );
    return ['ringing', 'queued', 'in_progress', 'active', 'ongoing', 'started', 'läuft', 'laufend'].indexOf(liveState) !== -1;
  }

  function priorityRecords() {
    try {
      if (typeof _dashPriorityAllRecords !== 'undefined') return list(_dashPriorityAllRecords);
    } catch (_error) {}
    return [];
  }

  function recordId(record) {
    return text(record && (
      record.elevenlabs_conversation_id ||
      record.conversation_id ||
      record.call_id ||
      record.id
    ));
  }

  function detailId(record) {
    var f = fields(record);
    return text(
      record && (record.id || record.call_id || record.task_id) ||
      f.id || f.call_id || f.task_id ||
      recordId(record)
    );
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
    var f = fields(record);
    var plannedAt = record && (record.follow_up_at || record.due_at || record.scheduled_at) || f.follow_up_at || f.due_at || f.scheduled_at;
    var planned = Boolean(plannedAt);
    return {
      record: record,
      model: {
        id: detailId(record),
        lifecycle: planned ? 'planned' : 'working',
        lifecycleMeta: planned
          ? { label: 'Geplant', tone: 'attention' }
          : { label: 'Offen', tone: 'info' },
        name: text(record && (record.title || record.task_title || record.next_action) || f.title || f.task_title || f.next_action) || 'Aufgabe',
        phone: null,
        summary: text(record && (record.note || record.notes || record.description) || f.note || f.notes || f.description),
        category: null,
        outcome: 'Manuelle Aufgabe',
        timestamp: plannedAt || record && (record.created_at || record.updated_at) || f.created_at || f.updated_at
      }
    };
  }

  function buildEntry(record) {
    if (!record) return null;
    if (isManual(record)) return manualEntry(record);
    var viewModel = root.VoxeraCustomerCallViewModel;
    if (!viewModel || typeof viewModel.build !== 'function') return null;
    return { record: record, model: viewModel.build(record) };
  }

  function taskEntries(state) {
    var excluded = new Set();
    [state.active, state.analysing].filter(Boolean).forEach(function (entry) {
      excluded.add(recordId(entry.record));
    });

    var seen = new Set();
    return priorityRecords().map(buildEntry).filter(function (entry) {
      if (!entry || !entry.model) return false;
      var id = recordId(entry.record) || detailId(entry.record) || text(entry.model.id);
      if (!id || excluded.has(id) || seen.has(id)) return false;
      if (entry.model.lifecycle === 'done' || entry.model.lifecycle === 'archived') return false;
      seen.add(id);
      return true;
    });
  }

  function icon(name) {
    return '<span class="vx-call-log-icon" aria-hidden="true"><i data-lucide="' + esc(name) + '"></i></span>';
  }

  function status(model) {
    var meta = model && model.lifecycleMeta || {};
    return '<span class="vx-call-log-status" data-tone="' + esc(meta.tone || 'info') + '">' + esc(meta.label || 'Neu') + '</span>';
  }

  function chevron() {
    return '<span class="vx-call-log-chevron" aria-hidden="true"><i data-lucide="chevron-right"></i></span>';
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
    var summary = taskMode && model.summary
      ? '<div class="vx-call-log-row__summary">' + esc(model.summary) + '</div>'
      : '';

    return '<div class="vx-call-log-row" role="button" tabindex="0" data-vx-call-id="' + esc(id) + '">' +
      icon(manual ? 'clipboard-check' : 'phone-incoming') +
      '<div class="vx-call-log-row__main">' +
        '<div class="vx-call-log-row__title">' + esc(model.name) + '</div>' +
        '<div class="vx-call-log-row__meta">' + esc(metaLine || 'Anruf') + '</div>' +
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
      if (isActiveCallRecord(record)) return false;
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
    if (!update.changed && root.document.getElementById('vx-customer-call-log')) return;

    var state = update.state;
    var tasks = taskEntries(state);
    var taskIds = new Set(tasks.map(function (entry) { return recordId(entry.record) || detailId(entry.record); }).filter(Boolean));
    var history = state.history.filter(function (entry) {
      return !taskIds.has(recordId(entry.record)) && !taskIds.has(detailId(entry.record));
    });

    var markup = activeCard(state.active || state.analysing, Boolean(state.analysing)) +
      section('Offene Aufgaben', 'Priorisierte Rückrufe und nächste Schritte.', tasks, 'task', '', 'tasks', true) +
      section('Letzte Anrufe', 'Die neuesten Gespräche auf einen Blick.', history.slice(0, 8), 'history', 'Heute sind noch keine abgeschlossenen Anrufe vorhanden.', 'history', false);

    if (markup === lastMarkup && root.document.getElementById('vx-customer-call-log')) return;
    var host = ensureHost();
    if (!host) return;

    host.innerHTML = markup;
    lastMarkup = markup;
    bindRows(host);
    try { if (typeof root.refreshLucideIcons === 'function') root.refreshLucideIcons(); } catch (_error) {}
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
