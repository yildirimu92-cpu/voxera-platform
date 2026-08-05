(function installCustomerCallDiagnosticsPanel(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerCallDiagnosticsPanelInstalled) return;
  root.__vxCustomerCallDiagnosticsPanelInstalled = true;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function latestRelevantTrace() {
    if (typeof root.vxGetCallDiagnostics !== 'function') return null;
    var traces = root.vxGetCallDiagnostics();
    if (!Array.isArray(traces) || !traces.length) return null;
    var currentId = text(root._vxCurrentCallId || root._vxCurrentCallRecordId || '');
    for (var index = traces.length - 1; index >= 0; index -= 1) {
      var item = traces[index];
      if (!currentId) return item;
      var identities = Array.isArray(item && item.identities) ? item.identities : [];
      var originalIdentities = item && item.matchedOriginal && Array.isArray(item.matchedOriginal.identities)
        ? item.matchedOriginal.identities
        : [];
      if (identities.indexOf(currentId) !== -1 || originalIdentities.indexOf(currentId) !== -1) return item;
    }
    return traces[traces.length - 1];
  }

  function valuePair(pair) {
    if (!pair) return '—';
    return 'top=' + text(pair.top || '—') + '\nfields=' + text(pair.nested || '—');
  }

  function row(label, value) {
    return '<div style="display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid #e6ebf2;">' +
      '<strong style="font-size:11px;color:#66738a;">' + label + '</strong>' +
      '<pre style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#10213f;">' +
      String(value == null ? '—' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre></div>';
  }

  function renderPanel() {
    var page = root.document.querySelector('.vx-call-detail-lite, #call-detail-page');
    if (!page) return;
    var trace = latestRelevantTrace();
    if (!trace) return;

    var existing = root.document.getElementById('vx-call-diagnostics-panel');
    if (!existing) {
      existing = root.document.createElement('section');
      existing.id = 'vx-call-diagnostics-panel';
      existing.style.cssText = 'margin:16px 24px 140px;padding:16px;border:2px solid #e6a700;border-radius:16px;background:#fff8dc;box-shadow:0 8px 24px rgba(16,33,63,.08);';
      page.appendChild(existing);
    }

    var original = trace.matchedOriginal || {};
    existing.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">' +
      '<div><strong style="display:block;font-size:15px;color:#10213f;">Temporäre Call-Diagnose</strong>' +
      '<span style="font-size:12px;color:#66738a;">Screenshot dieser Karte senden</span></div>' +
      '<button type="button" onclick="vxCopyCallDiagnostics()" style="border:1px solid #d4dae4;background:#fff;border-radius:10px;padding:8px 10px;font-weight:700;">JSON kopieren</button></div>' +
      row('View', trace.view + ' / ' + trace.activeSurface) +
      row('IDs', (trace.identities || []).join('\n')) +
      row('Input shape', trace.recordShape) +
      row('Input started_at', valuePair(trace.raw && trace.raw.started_at)) +
      row('Input created_at', valuePair(trace.raw && trace.raw.created_at)) +
      row('Input updated_at', valuePair(trace.raw && trace.raw.updated_at)) +
      row('Input canonical', trace.canonicalTimestamp) +
      row('Input Zürich', trace.formattedZurich) +
      row('Original shape', original.recordShape) +
      row('Original started_at', valuePair(original.started_at)) +
      row('Original created_at', valuePair(original.created_at)) +
      row('Original updated_at', valuePair(original.updated_at)) +
      row('Original canonical', original.canonicalTimestamp) +
      row('Original Zürich', original.formattedZurich) +
      row('Status input', JSON.stringify(trace.raw && {
        dashboard_status: trace.raw.dashboard_status,
        workflow_status: trace.raw.workflow_status,
        status: trace.raw.status,
        live_status: trace.raw.live_status
      }, null, 2));
  }

  var attempts = 0;
  var timer = root.setInterval(function () {
    attempts += 1;
    renderPanel();
    if (attempts > 1200) root.clearInterval(timer);
  }, 250);
})(typeof globalThis !== 'undefined' ? globalThis : this);
