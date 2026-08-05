(function initCustomerRequestsListOwner(root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCustomerRequestsListOwner(root) {
  'use strict';

  var installed = false;
  var latestVisibleRecords = [];

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function lower(value) {
    return text(value).toLowerCase();
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char];
    });
  }

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
    for (var index = 0; index < keys.length; index += 1) {
      var value = read(record, keys[index]);
      if (value !== '') return value;
    }
    return '';
  }

  function isManual(record) {
    try { return typeof root.isManualTaskRecord === 'function' && root.isManualTaskRecord(record); }
    catch (_error) { return false; }
  }

  function identityKeys(record) {
    var result = [];
    [
      'id', 'call_id', 'task_id', 'source_call_id', 'provider_call_id',
      'external_call_id', 'elevenlabs_conversation_id', 'conversation_id'
    ].forEach(function (key) {
      var value = text(read(record, key));
      if (value && result.indexOf(value) === -1) result.push(value);
    });
    return result;
  }

  function recordId(record) {
    return identityKeys(record)[0] || '';
  }

  function lifecycle(record) {
    if (!isManual(record)) {
      var viewModel = root.VoxeraCustomerCallViewModel;
      if (viewModel && typeof viewModel.lifecycle === 'function') {
        try { return viewModel.lifecycle(record); } catch (_error) {}
      }
    }

    var raw = lower(first(record, ['dashboard_status', 'workflow_status', 'status']));
    if (['archived', 'archiviert'].indexOf(raw) !== -1) return 'archived';
    if (['done', 'completed', 'resolved', 'closed', 'erledigt', 'abgeschlossen'].indexOf(raw) !== -1) return 'done';
    if (['planned', 'scheduled', 'follow_up', 'follow_up_scheduled', 'callback_planned', 'geplant'].indexOf(raw) !== -1) return 'planned';
    if (['working', 'in_progress', 'processing', 'in bearbeitung', 'bearbeitung'].indexOf(raw) !== -1) return 'working';
    return 'new';
  }

  function lifecycleMeta(state) {
    var fallback = {
      live: { label: 'Anruf läuft', tone: 'live' },
      analysing: { label: 'Wird ausgewertet', tone: 'neutral' },
      new: { label: 'Neu', tone: 'info' },
      working: { label: 'In Bearbeitung', tone: 'info' },
      planned: { label: 'Rückruf geplant', tone: 'attention' },
      done: { label: 'Erledigt', tone: 'success' },
      archived: { label: 'Archiviert', tone: 'muted' }
    };
    return fallback[state] || fallback.new;
  }

  function timestamp(record, state) {
    if (state === 'done' || state === 'archived') {
      var completed = first(record, ['completed_at', 'closed_at', 'done_at', 'archived_at', 'resolved_at']);
      if (completed) return completed;
    }
    if (state === 'planned') {
      var planned = first(record, ['follow_up_at', 'callback_at', 'due_at', 'scheduled_at']);
      if (planned) return planned;
    }
    var viewModel = root.VoxeraCustomerCallViewModel;
    if (!isManual(record) && viewModel && typeof viewModel.timestamp === 'function') {
      try { return viewModel.timestamp(record); } catch (_error) {}
    }
    return first(record, ['started_at', 'call_started_at', 'start_time', 'created_at', 'updated_at']);
  }

  function buildModel(record) {
    var manual = isManual(record);
    if (!manual) {
      var viewModel = root.VoxeraCustomerCallViewModel;
      if (viewModel && typeof viewModel.build === 'function') {
        try {
          var built = viewModel.build(record);
          if (built) return {
            id: recordId(record) || text(built.id),
            lifecycle: built.lifecycle,
            lifecycleMeta: built.lifecycleMeta || lifecycleMeta(built.lifecycle),
            name: text(built.name) || 'Unbekannter Anrufer',
            phone: text(built.phone),
            summary: text(built.summary),
            timestamp: built.timestamp,
            manual: false
          };
        } catch (_error) {}
      }
    }

    var state = lifecycle(record);
    var title = text(first(record, manual
      ? ['title', 'task_title', 'next_action', 'name']
      : ['caller_name', 'contact_name', 'name']));
    return {
      id: recordId(record),
      lifecycle: state,
      lifecycleMeta: lifecycleMeta(state),
      name: title || (manual ? 'Aufgabe' : 'Unbekannter Anrufer'),
      phone: text(first(record, ['caller_phone', 'caller_number', 'phone', 'phone_number', 'from_number'])),
      summary: text(first(record, manual
        ? ['note', 'notes', 'description', 'next_action']
        : ['call_summary_short', 'call_summary', 'summary'])),
      timestamp: timestamp(record, state),
      manual: manual
    };
  }

  function isUnread(record, model) {
    if (model.manual || model.lifecycle === 'live' || model.lifecycle === 'analysing') return false;
    try { return typeof root.vxIsUnreadRecord === 'function' && root.vxIsUnreadRecord(record); }
    catch (_error) { return !text(first(record, ['read_at'])); }
  }

  function dedupe(records) {
    var seen = new Set();
    return (Array.isArray(records) ? records : []).filter(Boolean).filter(function (record) {
      var keys = identityKeys(record);
      var key = keys[0];
      if (!key) return false;
      if (keys.some(function (candidate) { return seen.has(candidate); })) return false;
      keys.forEach(function (candidate) { seen.add(candidate); });
      return true;
    });
  }

  function entries(records) {
    return dedupe(records).map(function (record) {
      return { record: record, model: buildModel(record) };
    }).filter(function (entry) {
      return entry.model.id && entry.model.lifecycle !== 'live' && entry.model.lifecycle !== 'analysing';
    });
  }

  function canonicalCounts(records) {
    var counts = { new: 0, planned: 0, done: 0, archived: 0, unreadNew: 0, total: 0, all: 0 };
    entries(records).forEach(function (entry) {
      var state = entry.model.lifecycle;
      if (state === 'archived') {
        counts.archived += 1;
        return;
      }
      counts.all += 1;
      counts.total += 1;
      if (state === 'planned') counts.planned += 1;
      else if (state === 'done') counts.done += 1;
      else counts.new += 1;
      if (state === 'new' && isUnread(entry.record, entry.model)) counts.unreadNew += 1;
    });
    return counts;
  }

  function sourceRecords() {
    try {
      if (typeof root.vxGetAnfragenSourceRecords === 'function') return root.vxGetAnfragenSourceRecords();
    } catch (_error) {}
    return [].concat(
      Array.isArray(root.allRecords) ? root.allRecords : [],
      Array.isArray(root.allManualTaskRecords) ? root.allManualTaskRecords : []
    ).filter(Boolean);
  }

  function syncCounts() {
    var counts = canonicalCounts(sourceRecords());
    var count = root.document.getElementById('anrufe-split-count');
    if (count) count.textContent = counts.new + ' offen · ' + counts.planned + ' geplant · ' + counts.done + ' erledigt';

    var filters = root.document.querySelector('#anrufe-split-left .vx-requests-filters');
    if (filters) {
      var open = filters.querySelector('[data-filter="offen"]');
      var planned = filters.querySelector('[data-filter="geplant"]');
      var done = filters.querySelector('[data-filter="abgeschlossen"]');
      var archive = filters.querySelector('[data-filter="archiv"]');
      if (open) open.textContent = 'Offen (' + counts.new + ')';
      if (planned) planned.textContent = 'Geplant (' + counts.planned + ')';
      if (done) done.textContent = 'Erledigt (' + counts.done + ')';
      if (archive) archive.textContent = 'Archiv' + (counts.archived ? ' (' + counts.archived + ')' : '');
    }

    var unread = root.document.querySelector('#anrufe-inbox-subfilters [data-inbox-subfilter="unread"]');
    if (unread) unread.textContent = 'Nur ungelesene' + (counts.unreadNew ? ' (' + counts.unreadNew + ')' : '');

    try {
      if (typeof root.vxUpdateAnfragenNavBadges === 'function') root.vxUpdateAnfragenNavBadges(counts);
    } catch (_error2) {}
    return counts;
  }

  function parseDate(value) {
    if (!value) return null;
    var date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function dayKey(value) {
    var date = parseDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  }

  function groupLabel(value) {
    var date = parseDate(value);
    if (!date) return 'Ohne Datum';
    var today = new Date();
    var yesterday = new Date(today.getTime() - 86400000);
    var key = dayKey(date);
    if (key === dayKey(today)) return 'Heute';
    if (key === dayKey(yesterday)) return 'Gestern';
    return new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric'
    }).format(date);
  }

  function timeLabel(value) {
    var date = parseDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function groupEntries(list) {
    var groups = [];
    var byLabel = new Map();
    list.forEach(function (entry) {
      var label = groupLabel(entry.model.timestamp);
      if (!byLabel.has(label)) {
        var group = { label: label, entries: [] };
        byLabel.set(label, group);
        groups.push(group);
      }
      byLabel.get(label).entries.push(entry);
    });
    return groups;
  }

  function statusClass(model) {
    if (model.lifecycle === 'done' || model.lifecycle === 'archived') return ' is-done';
    if (model.lifecycle === 'planned') return ' is-planned';
    if (model.lifecycle === 'new') return ' is-new';
    return '';
  }

  function iconName(model) {
    return model.manual ? 'clipboard-text' : 'phone-incoming';
  }

  function rowMarkup(entry) {
    var model = entry.model;
    var unread = isUnread(entry.record, model);
    var meta = [timeLabel(model.timestamp), model.phone].filter(Boolean).join(' · ');
    var summary = model.summary;
    if (summary.length > 118) summary = summary.slice(0, 115) + '…';
    var callIdentity = model.manual ? '' : ' data-vx-call-id="' + esc(model.id) + '"';

    return '<article class="dpr-card vx-requests-owned-card' + (unread ? ' is-unread' : '') + '" data-id="' + esc(model.id) + '" data-record-id="' + esc(model.id) + '">' +
      '<div class="vx-heute-row' + (unread ? ' is-unread' : '') + '" role="button" tabindex="0" data-record-id="' + esc(model.id) + '"' + callIdentity + '>' +
        '<div class="vx-row-icon' + (model.manual ? '' : ' is-call') + '"><i class="ph-bold ph-' + iconName(model) + '" aria-hidden="true"></i></div>' +
        '<div class="vx-row-body">' +
          '<div class="vx-row-name">' + esc(model.name) + '</div>' +
          (meta ? '<div class="vx-row-time">' + esc(meta) + '</div>' : '') +
          (summary ? '<div class="vx-row-summary">' + esc(summary) + '</div>' : '') +
          '<div class="vx-requests-pills"><span class="vx-ops-pill vx-requests-pill' + statusClass(model) + '">' + esc((model.lifecycleMeta || lifecycleMeta(model.lifecycle)).label) + '</span></div>' +
        '</div>' +
        '<span class="vx-requests-owned-chevron" aria-hidden="true"><i class="ph-bold ph-caret-right"></i></span>' +
      '</div>' +
    '</article>';
  }

  function emptyMarkup(filter) {
    var message = 'Keine Anfragen.';
    try {
      if (typeof root.vxInquiryFilterEmptyText === 'function') message = root.vxInquiryFilterEmptyText(filter);
    } catch (_error) {}
    return '<div class="vx-ops-empty vx-requests-empty"><i class="ph-bold ph-tray" aria-hidden="true"></i><span>' + esc(message) + '</span></div>';
  }

  function renderInbox(containerId, records, activeFilter) {
    var host = root.document.getElementById(containerId);
    if (!host) return;
    var visible = entries(records);
    latestVisibleRecords = visible.map(function (entry) { return entry.record; });

    host.classList.remove('dpr-command-center', 'call-list');
    host.classList.add('vx-ops-list', 'vx-requests-list', 'vx-requests-list--owned');

    if (!visible.length) {
      host.innerHTML = emptyMarkup(activeFilter);
    } else {
      host.innerHTML = groupEntries(visible).map(function (group) {
        return '<div class="vx-ops-meta vx-requests-date"><i class="ph-bold ph-calendar-dots" aria-hidden="true"></i>' + esc(group.label) + '</div>' +
          group.entries.map(rowMarkup).join('');
      }).join('');
    }

    try {
      if (typeof root.vxRenderInboxSelectionToolbar === 'function') root.vxRenderInboxSelectionToolbar();
      syncCounts();
      if (root._vxActiveRecordId && typeof root.vxSetActiveRequestRow === 'function') root.vxSetActiveRequestRow(root._vxActiveRecordId);
      if (typeof root.vxApplyPendingRowHighlight === 'function') root.vxApplyPendingRowHighlight();
    } catch (_error) {}
  }

  function resolveRecord(id) {
    var normalized = text(id);
    if (!normalized) return null;
    var sources = latestVisibleRecords.concat(
      Array.isArray(root.allRecords) ? root.allRecords : [],
      Array.isArray(root.allManualTaskRecords) ? root.allManualTaskRecords : []
    );
    return sources.find(function (record) {
      return identityKeys(record).indexOf(normalized) !== -1;
    }) || null;
  }

  function openRecord(record, id) {
    if (!record) return false;
    var normalizedId = text(id) || recordId(record);
    try {
      if (typeof root.vxSetActiveRequestRow === 'function') root.vxSetActiveRequestRow(normalizedId);
      root._vxActiveRecordId = normalizedId;
      root._vxLastAnfragenRecordId = normalizedId;

      if (isManual(record)) {
        if (typeof root.showTaskDetail === 'function') root.showTaskDetail(normalizedId);
        else if (typeof root.openManualTaskDetail === 'function') root.openManualTaskDetail(record);
        return true;
      }

      var mobile = root.matchMedia ? root.matchMedia('(max-width: 767px)').matches : (root.innerWidth || 0) < 768;
      var tab = root.document.getElementById('tab-anrufe');
      var requestsActive = !!(tab && tab.classList.contains('active'));
      if (!mobile && requestsActive && typeof root.vxRenderRequestsDetailV2 === 'function') {
        var host = root.document.getElementById('requests-detail-v2');
        var empty = root.document.getElementById('anrufe-split-empty');
        if (host) {
          if (empty) empty.style.display = 'none';
          host.style.display = 'block';
          root.vxRenderRequestsDetailV2(record, { hostEl: host });
          return true;
        }
      }

      if (typeof root.showCallDetail === 'function') {
        root.showCallDetail(normalizedId, { forceFullscreen: true });
        return true;
      }
      if (typeof root.openCallDetail === 'function') {
        root.openCallDetail(record);
        return true;
      }
    } catch (_error) {}
    return false;
  }

  function interactive(target) {
    return !!(target && target.closest && target.closest('button, a, input, textarea, select, .vx-row-menu, [data-action]'));
  }

  function bindHost() {
    var host = root.document.getElementById('anrufe-list');
    if (!host || host.dataset.vxRequestsOwnerBound) return;
    host.dataset.vxRequestsOwnerBound = '1';

    host.addEventListener('click', function (event) {
      var row = event.target && event.target.closest ? event.target.closest('[data-record-id]') : null;
      if (!row || interactive(event.target)) return;
      var id = text(row.getAttribute('data-record-id') || row.getAttribute('data-id'));
      var record = resolveRecord(id);
      if (!record) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openRecord(record, id);
    }, true);

    host.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target && event.target.closest ? event.target.closest('[data-record-id]') : null;
      if (!row || interactive(event.target)) return;
      var id = text(row.getAttribute('data-record-id') || row.getAttribute('data-id'));
      var record = resolveRecord(id);
      if (!record) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openRecord(record, id);
    }, true);
  }

  function installOwner() {
    if (installed) return true;
    if (typeof root.renderAnrufeInbox !== 'function') return false;

    var owned = function customerRequestsListOwner(containerId, records, activeFilter) {
      renderInbox(containerId, records, activeFilter);
      bindHost();
    };
    owned._vxRequestsListOwner = true;
    owned._vxPrevious = root.renderAnrufeInbox;
    root.renderAnrufeInbox = owned;
    try { renderAnrufeInbox = owned; } catch (_error) {}
    installed = true;

    bindHost();
    try { if (typeof root.renderAnrufe === 'function') root.renderAnrufe(); } catch (_error) {}
    return true;
  }

  function install() {
    var attempts = 0;
    var timer = root.setInterval(function () {
      attempts += 1;
      if (installOwner() || attempts > 240) root.clearInterval(timer);
    }, 50);
  }

  return {
    install: install,
    buildModel: buildModel,
    entries: entries,
    groupEntries: groupEntries,
    rowMarkup: rowMarkup,
    canonicalCounts: canonicalCounts
  };
});