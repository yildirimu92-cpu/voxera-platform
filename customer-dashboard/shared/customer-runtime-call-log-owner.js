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

  function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

  function isManual(record) {
    try { return typeof root.isManualTaskRecord === 'function' && root.isManualTaskRecord(record); }
    catch (_error) { return false; }
  }

  function priorityRecords() {
    try {
      if (typeof _dashPriorityAllRecords !== 'undefined') return list(_dashPriorityAllRecords);
    } catch (_error) {}
    return [];
  }

  function recordId(record) {
    return String(record && (record.elevenlabs_conversation_id || record.conversation_id || record.call_id || record.id) || '').trim();
  }

  function mergeRecords() {
    return priorityRecords().concat(latestActivityRecords).filter(function (record) {
      return Boolean(record) && !isManual(record);
    });
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

  function metadata(model) {
    return [model.category, model.outcome].filter(Boolean).map(function (item) {
      return '<span class="vx-ops-pill">' + esc(item) + '</span>';
    }).join('');
  }

  function activeCard(entry, analysing) {
    if (!entry) return '';
    var model = entry.model;
    var label = analysing ? 'Wird ausgewertet' : 'Anruf läuft';
    var detail = analysing ? 'Zusammenfassung und nächste Schritte werden erstellt.' : 'Lara spricht gerade mit dem Anrufer.';
    return '<section class="vx-ops-card" data-vx-call-log-section="active">' +
      '<div class="vx-ap-head"><div><div class="vx-ops-title">' + label + '</div><div class="vx-ops-sub">' + detail + '</div></div>' +
      '<span class="vx-ops-pill active">' + (analysing ? 'Analyse' : 'Live') + '</span></div>' +
      '<div class="vx-ops-list"><div class="vx-ops-row"><div class="vx-ops-row-main"><div class="vx-ops-row-title">' + esc(model.name) + '</div>' +
      '<div class="vx-ops-row-meta">' + esc(model.phone || 'Nummer wird ermittelt') + (formatTime(model) ? ' · ' + esc(formatTime(model)) : '') + '</div></div></div></div></section>';
  }

  function taskRows(entries) {
    return list(entries).map(function (entry) {
      var model = entry.model;
      return '<button type="button" class="vx-ops-row" data-vx-call-id="' + esc(model.id || recordId(entry.record)) + '">' +
        '<div class="vx-ops-row-main"><div class="vx-ops-row-title">' + esc(model.name) + '</div>' +
        '<div class="vx-ops-row-meta">' + esc(model.outcome || model.lifecycleMeta.label) + (model.phone ? ' · ' + esc(model.phone) : '') + '</div>' +
        (model.summary ? '<div class="vx-ops-row-summary">' + esc(model.summary) + '</div>' : '') + '</div>' +
        '<span class="vx-ops-pill">' + esc(model.lifecycleMeta.label) + '</span></button>';
    }).join('');
  }

  function historyRows(entries) {
    return list(entries).slice(0, 10).map(function (entry) {
      var model = entry.model;
      return '<button type="button" class="vx-ops-row" data-vx-call-id="' + esc(model.id || recordId(entry.record)) + '">' +
        '<div class="vx-ops-row-main"><div class="vx-ops-row-title">' + esc(model.name) + '</div>' +
        '<div class="vx-ops-row-meta">' + esc(formatTime(model)) + (model.phone ? ' · ' + esc(model.phone) : '') + '</div>' +
        (model.summary ? '<div class="vx-ops-row-summary">' + esc(model.summary) + '</div>' : '') + '</div>' +
        '<div class="vx-ops-row-tags">' + metadata(model) + '<span class="vx-ops-pill">' + esc(model.lifecycleMeta.label) + '</span></div></button>';
    }).join('');
  }

  function section(title, subtitle, entries, rows, emptyText, key) {
    return '<section class="vx-ops-card" data-vx-call-log-section="' + key + '">' +
      '<div class="vx-ap-head"><div><div class="vx-ops-title">' + title + '</div><div class="vx-ops-sub">' + subtitle + '</div></div>' +
      '<span class="vx-ops-pill">' + entries.length + '</span></div>' +
      '<div class="vx-ops-list">' + (entries.length ? rows : '<div class="vx-ops-empty">' + emptyText + '</div>') + '</div></section>';
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
    ['dash-priority-section','dash-activity-section','dash-today-calls-section','dash-today-done-section'].forEach(function (id) {
      var node = root.document.getElementById(id);
      if (node) node.remove();
    });
    return host;
  }

  function openCall(id) {
    if (!id) return;
    var record = mergeRecords().find(function (item) { return recordId(item) === id || String(item.id || '') === id; });
    if (!record) return;
    try {
      if (typeof root.openCallDetail === 'function') root.openCallDetail(record);
      else if (typeof root.openInquiryDetail === 'function') root.openInquiryDetail(record.id || id);
    } catch (_error) {}
  }

  function render() {
    var modelApi = root.VoxeraCustomerCallLogModel;
    if (!modelApi || typeof modelApi.createStableStore !== 'function') return;
    if (!store) store = modelApi.createStableStore({ liveGraceMs: 12000 });
    var update = store.update(mergeRecords());
    if (!update.changed && root.document.getElementById('vx-customer-call-log')) return;
    var state = update.state;
    var markup = activeCard(state.active || state.analysing, Boolean(state.analysing)) +
      section('Offene Aufgaben', 'Nur Anrufe mit einem konkreten nächsten Schritt.', state.tasks, taskRows(state.tasks), 'Keine offenen Aufgaben aus Anrufen.', 'tasks') +
      section('Letzte Anrufe', 'Chronologisch, ohne doppelte Darstellung.', state.history, historyRows(state.history), 'Heute sind noch keine abgeschlossenen Anrufe vorhanden.', 'history');
    if (markup === lastMarkup && root.document.getElementById('vx-customer-call-log')) return;
    var host = ensureHost();
    if (!host) return;
    host.innerHTML = markup;
    lastMarkup = markup;
    host.querySelectorAll('[data-vx-call-id]').forEach(function (button) {
      button.addEventListener('click', function () { openCall(button.getAttribute('data-vx-call-id')); });
    });
    try { if (typeof root.refreshLucideIcons === 'function') root.refreshLucideIcons(); } catch (_error) {}
  }

  function installOverrides() {
    if (installed) return;
    if (typeof root.vxHeuteRenderActivityList !== 'function' || typeof root.renderDashPriorityList !== 'function') return;
    installed = true;
    root.vxHeuteRenderActivityList = function customerCallLogActivityOwner(records) {
      latestActivityRecords = list(records);
      render();
    };
    root.vxHeuteRenderScopedList = function customerCallLogScopedOwner() { render(); };
    root.renderDashPriorityList = function customerCallLogPriorityOwner() { render(); };
    root.vxDashShowAllImportant = function customerCallLogOpenTasks() {
      var target = root.document.querySelector('[data-vx-call-log-section="tasks"]');
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior:'smooth', block:'start' });
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
