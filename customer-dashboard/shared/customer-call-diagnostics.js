(function installCustomerCallDiagnostics(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerCallDiagnosticsInstalled) return;
  root.__vxCustomerCallDiagnosticsInstalled = true;

  var STORAGE_KEY = 'vx_call_diagnostics_v1';
  var traces = [];

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function fields(record) {
    return record && record.fields && typeof record.fields === 'object' ? record.fields : {};
  }

  function values(record, key) {
    var nested = fields(record);
    return {
      top: record && record[key] != null ? record[key] : null,
      nested: nested[key] != null ? nested[key] : null
    };
  }

  function identityKeys(record) {
    var nested = fields(record);
    var result = [];
    [
      'id', 'call_id', 'source_call_id', 'provider_call_id', 'external_call_id',
      'elevenlabs_conversation_id', 'conversation_id'
    ].forEach(function (key) {
      [record && record[key], nested[key]].forEach(function (value) {
        var normalized = text(value);
        if (normalized && result.indexOf(normalized) === -1) result.push(normalized);
      });
    });
    return result;
  }

  function sameRecord(candidate, keys) {
    if (!candidate || !keys.length) return false;
    return identityKeys(candidate).some(function (key) { return keys.indexOf(key) !== -1; });
  }

  function sourceRecord(record) {
    var keys = identityKeys(record);
    var all = Array.isArray(root.allRecords) ? root.allRecords : [];
    return all.find(function (candidate) { return sameRecord(candidate, keys); }) || null;
  }

  function activeSurface() {
    var active = root.document.querySelector('.nav-item.active, .bottom-nav-item.active, [data-section].active');
    var label = active && text(active.textContent).toLowerCase();
    if (label.indexOf('anfragen') !== -1) return 'requests';
    if (label.indexOf('heute') !== -1) return 'today';
    return 'unknown';
  }

  function canonicalTimestamp(record) {
    try {
      if (root.VoxeraCustomerCallViewModel && typeof root.VoxeraCustomerCallViewModel.timestamp === 'function') {
        return root.VoxeraCustomerCallViewModel.timestamp(record);
      }
    } catch (_error) {}
    return null;
  }

  function formattedTimestamp(value) {
    try {
      if (root.VoxeraCustomerCallViewModel && typeof root.VoxeraCustomerCallViewModel.formatZurichDateTime === 'function') {
        return root.VoxeraCustomerCallViewModel.formatZurichDateTime(value);
      }
    } catch (_error) {}
    return null;
  }

  function snapshot(view, record, extra) {
    if (!record) return null;
    var original = sourceRecord(record);
    var canonical = canonicalTimestamp(record);
    var originalCanonical = original ? canonicalTimestamp(original) : null;
    return {
      capturedAt: new Date().toISOString(),
      view: view,
      activeSurface: activeSurface(),
      identities: identityKeys(record),
      recordShape: record.fields && typeof record.fields === 'object' ? 'record-with-fields' : 'flat-record',
      raw: {
        started_at: values(record, 'started_at'),
        call_started_at: values(record, 'call_started_at'),
        start_time: values(record, 'start_time'),
        created_at: values(record, 'created_at'),
        updated_at: values(record, 'updated_at'),
        dashboard_status: values(record, 'dashboard_status'),
        workflow_status: values(record, 'workflow_status'),
        status: values(record, 'status'),
        live_status: values(record, 'live_status')
      },
      canonicalTimestamp: canonical,
      formattedZurich: formattedTimestamp(canonical),
      matchedOriginal: original ? {
        identities: identityKeys(original),
        recordShape: original.fields && typeof original.fields === 'object' ? 'record-with-fields' : 'flat-record',
        started_at: values(original, 'started_at'),
        call_started_at: values(original, 'call_started_at'),
        start_time: values(original, 'start_time'),
        created_at: values(original, 'created_at'),
        updated_at: values(original, 'updated_at'),
        dashboard_status: values(original, 'dashboard_status'),
        workflow_status: values(original, 'workflow_status'),
        status: values(original, 'status'),
        live_status: values(original, 'live_status'),
        canonicalTimestamp: originalCanonical,
        formattedZurich: formattedTimestamp(originalCanonical)
      } : null,
      extra: extra || null
    };
  }

  function persist() {
    try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(traces.slice(-80))); } catch (_error) {}
  }

  function trace(view, record, extra) {
    var item = snapshot(view, record, extra);
    if (!item) return;
    traces.push(item);
    if (traces.length > 80) traces = traces.slice(-80);
    persist();
    try { root.console.info('[VOXERA CALL TRACE]', item); } catch (_error) {}
  }

  function relevantTraces() {
    var currentId = text(root._vxCurrentCallId || root._vxCurrentCallRecordId || '');
    if (!currentId) return traces.slice(-20);
    return traces.filter(function (item) {
      return item.identities.indexOf(currentId) !== -1 ||
        (item.matchedOriginal && item.matchedOriginal.identities.indexOf(currentId) !== -1);
    }).slice(-20);
  }

  function copyDiagnostics() {
    var payload = JSON.stringify({
      generatedAt: new Date().toISOString(),
      location: String(root.location && root.location.href || ''),
      currentCallId: root._vxCurrentCallId || null,
      traces: relevantTraces()
    }, null, 2);

    function done() {
      root.alert('Call-Diagnose wurde kopiert. Bitte im Chat einfügen.');
    }

    if (root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.writeText === 'function') {
      root.navigator.clipboard.writeText(payload).then(done).catch(function () {
        root.prompt('Call-Diagnose kopieren:', payload);
      });
      return;
    }
    root.prompt('Call-Diagnose kopieren:', payload);
  }

  root.vxCopyCallDiagnostics = copyDiagnostics;
  root.vxGetCallDiagnostics = function () { return traces.slice(); };
  root.vxClearCallDiagnostics = function () {
    traces = [];
    try { root.localStorage.removeItem(STORAGE_KEY); } catch (_error) {}
  };

  try {
    var stored = JSON.parse(root.localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) traces = stored.slice(-80);
  } catch (_error) {}

  function addDetailButton() {
    var host = root.document.getElementById('call-detail-quick-actions');
    if (!host || host.querySelector('[data-vx-call-diagnostics]')) return;
    var button = root.document.createElement('button');
    button.type = 'button';
    button.className = 'vx-call-detail-lite__nav';
    button.setAttribute('data-vx-call-diagnostics', 'true');
    button.setAttribute('aria-label', 'Call-Diagnose kopieren');
    button.title = 'Call-Diagnose kopieren';
    button.innerHTML = '<span aria-hidden="true">⌘</span>';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      copyDiagnostics();
    });
    host.insertBefore(button, host.firstChild || null);
  }

  function installWrappers() {
    if (typeof root.showCallDetail === 'function' && !root.showCallDetail._vxDiagnosticsWrapped) {
      var previousShow = root.showCallDetail;
      var wrappedShow = function diagnosticShowCallDetail(callId, options) {
        var all = Array.isArray(root.allRecords) ? root.allRecords : [];
        var record = all.find(function (candidate) {
          return identityKeys(candidate).indexOf(text(callId)) !== -1;
        }) || null;
        trace('showCallDetail:' + activeSurface(), record, { callId: callId, options: options || null });
        return previousShow.apply(this, arguments);
      };
      wrappedShow._vxDiagnosticsWrapped = true;
      wrappedShow._vxPrevious = previousShow;
      root.showCallDetail = wrappedShow;
    }

    if (typeof root.renderCallDetailPage === 'function' && !root.renderCallDetailPage._vxDiagnosticsWrapped) {
      var previousDetail = root.renderCallDetailPage;
      var wrappedDetail = function diagnosticRenderCallDetail(record) {
        trace('detail-render-input', record, null);
        var result = previousDetail.apply(this, arguments);
        root.setTimeout(addDetailButton, 0);
        return result;
      };
      wrappedDetail._vxDiagnosticsWrapped = true;
      wrappedDetail._vxPrevious = previousDetail;
      root.renderCallDetailPage = wrappedDetail;
    }

    if (typeof root.vxRenderRequestsDetailV2 === 'function' && !root.vxRenderRequestsDetailV2._vxDiagnosticsWrapped) {
      var previousSplit = root.vxRenderRequestsDetailV2;
      var wrappedSplit = function diagnosticRequestsDetail(record, options) {
        trace('requests-detail-input', record, options || null);
        return previousSplit.apply(this, arguments);
      };
      wrappedSplit._vxDiagnosticsWrapped = true;
      wrappedSplit._vxPrevious = previousSplit;
      root.vxRenderRequestsDetailV2 = wrappedSplit;
    }

    if (typeof root.vxHeuteRenderActivityList === 'function' && !root.vxHeuteRenderActivityList._vxDiagnosticsWrapped) {
      var previousToday = root.vxHeuteRenderActivityList;
      var wrappedToday = function diagnosticTodayRecords(records) {
        (Array.isArray(records) ? records : []).forEach(function (record) {
          trace('today-list-input', record, null);
        });
        return previousToday.apply(this, arguments);
      };
      wrappedToday._vxDiagnosticsWrapped = true;
      wrappedToday._vxPrevious = previousToday;
      root.vxHeuteRenderActivityList = wrappedToday;
    }

    addDetailButton();
  }

  var attempts = 0;
  var timer = root.setInterval(function () {
    attempts += 1;
    installWrappers();
    if (attempts > 400) root.clearInterval(timer);
  }, 50);
})(typeof globalThis !== 'undefined' ? globalThis : this);
