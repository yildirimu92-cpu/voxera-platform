(function installCustomerCallDiagnosticsPanel(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerCallDiagnosticsPanelInstalled) return;
  root.__vxCustomerCallDiagnosticsPanelInstalled = true;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function fields(record) {
    return record && record.fields && typeof record.fields === 'object' ? record.fields : {};
  }

  function value(record, key) {
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
      [record && record[key], nested[key]].forEach(function (candidate) {
        var normalized = text(candidate);
        if (normalized && result.indexOf(normalized) === -1) result.push(normalized);
      });
    });
    return result;
  }

  function currentCallIds() {
    var result = [];
    [root._vxCurrentCallId, root._vxCurrentCallRecordId].forEach(function (candidate) {
      var normalized = text(candidate);
      if (normalized && result.indexOf(normalized) === -1) result.push(normalized);
    });
    return result;
  }

  function matchesCurrent(record, ids) {
    if (!record || !ids.length) return false;
    return identityKeys(record).some(function (key) { return ids.indexOf(key) !== -1; });
  }

  function findOriginalRecord() {
    var ids = currentCallIds();
    var all = Array.isArray(root.allRecords) ? root.allRecords : [];
    return all.find(function (record) { return matchesCurrent(record, ids); }) || null;
  }

  function canonicalTimestamp(record) {
    try {
      if (root.VoxeraCustomerCallViewModel && typeof root.VoxeraCustomerCallViewModel.timestamp === 'function') {
        return root.VoxeraCustomerCallViewModel.timestamp(record);
      }
    } catch (_error) {}
    return null;
  }

  function formattedTimestamp(timestamp) {
    try {
      if (root.VoxeraCustomerCallViewModel && typeof root.VoxeraCustomerCallViewModel.formatZurichDateTime === 'function') {
        return root.VoxeraCustomerCallViewModel.formatZurichDateTime(timestamp);
      }
    } catch (_error) {}
    return null;
  }

  function escapeHtml(value) {
    return String(value == null ? '—' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function valuePair(pair) {
    if (!pair) return '—';
    return 'top=' + text(pair.top || '—') + '\nfields=' + text(pair.nested || '—');
  }

  function row(label, data) {
    return '<div style="display:grid;grid-template-columns:132px minmax(0,1fr);gap:10px;padding:8px 0;border-bottom:1px solid #e5d79a;">' +
      '<strong style="font-size:11px;color:#6b5a16;">' + escapeHtml(label) + '</strong>' +
      '<pre style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#10213f;">' +
      escapeHtml(data) + '</pre></div>';
  }

  function latestTrace() {
    if (typeof root.vxGetCallDiagnostics !== 'function') return null;
    var traces = root.vxGetCallDiagnostics();
    if (!Array.isArray(traces) || !traces.length) return null;
    var ids = currentCallIds();
    for (var index = traces.length - 1; index >= 0; index -= 1) {
      var trace = traces[index] || {};
      var traceIds = Array.isArray(trace.identities) ? trace.identities : [];
      if (!ids.length || traceIds.some(function (id) { return ids.indexOf(id) !== -1; })) return trace;
    }
    return traces[traces.length - 1];
  }

  function visibleDetailHost() {
    var mobilePage = root.document.getElementById('call-detail-page');
    if (mobilePage && mobilePage.classList.contains('show')) {
      return {
        mode: 'mobile-fullscreen',
        host: root.document.getElementById('call-detail-content') || mobilePage,
        meta: mobilePage.querySelector('.vx-call-detail-lite__meta')
      };
    }

    var split = root.document.getElementById('requests-detail-v2');
    if (split) {
      var style = root.getComputedStyle ? root.getComputedStyle(split) : null;
      var visible = !style || (style.display !== 'none' && style.visibility !== 'hidden');
      if (visible && text(split.textContent)) {
        return {
          mode: 'desktop-split',
          host: split,
          meta: split.querySelector('.vx-call-detail-lite__meta')
        };
      }
    }
    return null;
  }

  function renderPanel() {
    var target = visibleDetailHost();
    if (!target || !target.host) return;

    var original = findOriginalRecord();
    var trace = latestTrace();
    var timestamp = original ? canonicalTimestamp(original) : null;
    var formatted = formattedTimestamp(timestamp);
    var ids = currentCallIds();

    var panel = target.host.querySelector('#vx-call-diagnostics-panel');
    if (!panel) {
      panel = root.document.createElement('section');
      panel.id = 'vx-call-diagnostics-panel';
      panel.style.cssText = 'margin:18px 24px 160px;padding:16px;border:3px solid #e6a700;border-radius:16px;background:#fff8d6;box-shadow:0 8px 24px rgba(16,33,63,.12);';
      target.host.appendChild(panel);
    }

    panel.innerHTML = '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;">' +
      '<div><strong style="display:block;font-size:16px;color:#10213f;">Temporäre Call-Diagnose</strong>' +
      '<span style="display:block;margin-top:3px;font-size:12px;color:#6b5a16;">Diese Karte vollständig fotografieren.</span></div>' +
      '<span style="padding:5px 8px;border-radius:999px;background:#e6a700;color:#10213f;font-size:11px;font-weight:800;">' + escapeHtml(target.mode) + '</span></div>' +
      row('Current IDs', ids.length ? ids.join('\n') : 'KEINE CURRENT CALL ID') +
      row('allRecords', Array.isArray(root.allRecords) ? String(root.allRecords.length) : 'nicht vorhanden') +
      row('Original gefunden', original ? 'JA' : 'NEIN') +
      row('Original IDs', original ? identityKeys(original).join('\n') : '—') +
      row('started_at', original ? valuePair(value(original, 'started_at')) : '—') +
      row('call_started_at', original ? valuePair(value(original, 'call_started_at')) : '—') +
      row('start_time', original ? valuePair(value(original, 'start_time')) : '—') +
      row('created_at', original ? valuePair(value(original, 'created_at')) : '—') +
      row('updated_at', original ? valuePair(value(original, 'updated_at')) : '—') +
      row('Canonical timestamp', timestamp || '—') +
      row('Canonical Zürich', formatted || '—') +
      row('Detail header', text(target.meta && target.meta.textContent || '—')) +
      row('Trace vorhanden', trace ? 'JA: ' + text(trace.view) : 'NEIN') +
      row('Trace canonical', trace ? text(trace.canonicalTimestamp || '—') : '—') +
      row('Trace Zürich', trace ? text(trace.formattedZurich || '—') : '—');
  }

  var attempts = 0;
  var timer = root.setInterval(function () {
    attempts += 1;
    renderPanel();
    if (attempts > 2400) root.clearInterval(timer);
  }, 250);
})(typeof globalThis !== 'undefined' ? globalThis : this);
