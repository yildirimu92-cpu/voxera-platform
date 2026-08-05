(function initCustomerCallDetailLifecycleOwner(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerCallDetailLifecycleInstalled) return;
  root.__vxCustomerCallDetailLifecycleInstalled = true;

  var ownedDetailRenderer = null;
  var ownedSplitRenderer = null;
  var navigationInstalled = false;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function fields(record) {
    return record && record.fields && typeof record.fields === 'object' ? record.fields : {};
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

  function allCallRecords() {
    var result = [];
    [root.allRecords, root.latestActivityRecords].forEach(function (collection) {
      (Array.isArray(collection) ? collection : []).forEach(function (record) {
        if (record && result.indexOf(record) === -1) result.push(record);
      });
    });
    return result;
  }

  function findOriginalRecord(callId) {
    var normalizedId = text(callId);
    if (!normalizedId) return null;
    return allCallRecords().find(function (record) {
      return identityKeys(record).indexOf(normalizedId) !== -1;
    }) || null;
  }

  function isMobileViewport() {
    try { return root.matchMedia('(max-width: 767px)').matches; }
    catch (_error) { return (root.innerWidth || 0) < 768; }
  }

  function isRequestsSurfaceActive() {
    var tab = root.document.getElementById('tab-anrufe');
    return !!(tab && tab.classList.contains('active'));
  }

  function clearOwnedDetailState() {
    var page = root.document.getElementById('call-detail-page');
    var scrollWrap = root.document.getElementById('call-detail-scroll-wrap');
    var content = root.document.getElementById('call-detail-content');
    var statsWrap = root.document.getElementById('call-detail-stats-wrap');
    var splitHost = root.document.getElementById('requests-detail-v2');

    if (page) page.classList.remove('vx-call-detail-lite');
    if (scrollWrap) scrollWrap.classList.remove('vx-call-detail-lite__scroll');
    if (content) content.classList.remove('vx-call-detail-lite__content');
    if (statsWrap) statsWrap.style.display = '';
    if (splitHost) splitHost.classList.remove('vx-call-detail-lite-host');
  }

  function resetRenderedDetailState(scope) {
    if (!scope) return;

    var reset = function () {
      var scrollers = [scope];
      var nestedScroller = scope.querySelector && scope.querySelector('#call-detail-scroll-wrap');
      if (nestedScroller && scrollers.indexOf(nestedScroller) === -1) scrollers.push(nestedScroller);

      scrollers.forEach(function (node) {
        if (!node) return;
        try { node.scrollTop = 0; } catch (_error) {}
        try { node.scrollLeft = 0; } catch (_error2) {}
      });

      if (scope.querySelectorAll) {
        scope.querySelectorAll('.vx-call-detail-lite__details[open]').forEach(function (details) {
          details.removeAttribute('open');
        });
      }
    };

    reset();
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(reset);
    else root.setTimeout(reset, 0);
  }

  function rememberCanonicalOwners() {
    if (typeof root.renderCallDetailPage === 'function' && root.renderCallDetailPage._vxCallLogDetailOwner) {
      ownedDetailRenderer = root.renderCallDetailPage;
    }
    if (typeof root.vxRenderRequestsDetailV2 === 'function' && root.vxRenderRequestsDetailV2._vxCallLogSplitDetailOwner) {
      ownedSplitRenderer = root.vxRenderRequestsDetailV2;
    }
  }

  function restoreCanonicalOwners() {
    if (ownedDetailRenderer && root.renderCallDetailPage !== ownedDetailRenderer) {
      root.renderCallDetailPage = ownedDetailRenderer;
      try { renderCallDetailPage = ownedDetailRenderer; } catch (_error) {}
    }
    if (ownedSplitRenderer && root.vxRenderRequestsDetailV2 !== ownedSplitRenderer) {
      root.vxRenderRequestsDetailV2 = ownedSplitRenderer;
      try { vxRenderRequestsDetailV2 = ownedSplitRenderer; } catch (_error) {}
    }
  }

  function ensureFullscreenVisible() {
    var page = root.document.getElementById('call-detail-page');
    if (!page) return false;
    page.classList.add('show');
    page.classList.add('is-fullscreen');
    page.setAttribute('aria-hidden', 'false');
    page.style.display = '';
    root.document.documentElement.classList.add('vx-call-detail-open');
    if (root.document.body) root.document.body.classList.add('vx-call-detail-open');
    return true;
  }

  function hideFullscreenDetail() {
    var page = root.document.getElementById('call-detail-page');
    if (!page) return;
    page.classList.remove('show');
    page.classList.remove('is-open');
    page.setAttribute('aria-hidden', 'true');
    page.style.display = 'none';
  }

  function rememberCurrentRecord(record) {
    var ids = identityKeys(record);
    var canonicalId = ids[0] || '';
    if (!canonicalId) return;
    root._vxCurrentCallId = canonicalId;
    root._vxCurrentCallRecordId = canonicalId;
    root._vxCurrentDetailType = 'call';
  }

  function renderCanonicalFullscreen(record) {
    rememberCanonicalOwners();
    restoreCanonicalOwners();
    if (!record || !ownedDetailRenderer) return false;
    try {
      ownedDetailRenderer(record, []);
      rememberCurrentRecord(record);
      ensureFullscreenVisible();
      resetRenderedDetailState(root.document.getElementById('call-detail-page'));
      return true;
    } catch (error) {
      try { root.console.error('[call-detail] canonical fullscreen render failed', error); } catch (_error) {}
      return false;
    }
  }

  function renderCanonicalSplit(record) {
    rememberCanonicalOwners();
    restoreCanonicalOwners();
    if (!record || !ownedSplitRenderer) return false;

    var host = root.document.getElementById('requests-detail-v2');
    var empty = root.document.getElementById('anrufe-split-empty');
    if (!host) return false;

    try {
      hideFullscreenDetail();
      if (empty) empty.style.display = 'none';
      host.style.display = 'block';
      ownedSplitRenderer(record, { hostEl: host });
      resetRenderedDetailState(host);
      rememberCurrentRecord(record);
      if (typeof root.vxSetActiveRequestRow === 'function') {
        root.vxSetActiveRequestRow(identityKeys(record)[0] || '');
      }
      return true;
    } catch (error) {
      try { root.console.error('[call-detail] canonical split render failed', error); } catch (_error) {}
      return false;
    }
  }

  function openCanonicalDetail(callId, sourceRow) {
    var original = findOriginalRecord(callId);
    if (!original) return false;

    var requestsRow = !!(sourceRow && sourceRow.closest && sourceRow.closest('#anrufe-list, #anrufe-split-left'));
    if (!isMobileViewport() && requestsRow && isRequestsSurfaceActive()) {
      return renderCanonicalSplit(original);
    }
    return renderCanonicalFullscreen(original);
  }

  function resolveRow(target) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(
      '[data-vx-call-id], ' +
      '#anrufe-list [data-id], #anrufe-list [data-record-id], #anrufe-list [data-call-id], ' +
      '#anrufe-list .dpr-card, #anrufe-list .vx-requests-item, #anrufe-list .vx-requests-row, ' +
      '#dash-priority-list [data-id], #dash-priority-list [data-record-id]'
    );
  }

  function rowCallId(row) {
    if (!row) return '';
    var candidates = [
      row.getAttribute && row.getAttribute('data-vx-call-id'),
      row.getAttribute && row.getAttribute('data-id'),
      row.getAttribute && row.getAttribute('data-record-id'),
      row.getAttribute && row.getAttribute('data-call-id'),
      row.dataset && row.dataset.vxCallId,
      row.dataset && row.dataset.id,
      row.dataset && row.dataset.recordId,
      row.dataset && row.dataset.callId
    ];
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = text(candidates[index]);
      if (candidate) return candidate;
    }

    var parent = row.closest && row.closest('[data-vx-call-id], [data-id], [data-record-id], [data-call-id]');
    if (parent && parent !== row) return rowCallId(parent);
    return '';
  }

  function isInteractiveControl(target, row) {
    if (!target || !target.closest) return false;
    var control = target.closest('button, a, input, textarea, select, [role="button"], .dpr-quick-btn, .vx-ibtn');
    return !!(control && control !== row);
  }

  function installCanonicalNavigation() {
    if (navigationInstalled) return;
    navigationInstalled = true;

    root.document.addEventListener('click', function (event) {
      var row = resolveRow(event.target);
      if (!row || isInteractiveControl(event.target, row)) return;
      var callId = rowCallId(row);
      if (!callId || !findOriginalRecord(callId)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openCanonicalDetail(callId, row);
    }, true);

    root.document.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = resolveRow(event.target);
      if (!row || isInteractiveControl(event.target, row)) return;
      var callId = rowCallId(row);
      if (!callId || !findOriginalRecord(callId)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openCanonicalDetail(callId, row);
    }, true);
  }

  function installResetBridge() {
    var previous = root.vxResetCallDetailViewState;
    if (typeof previous !== 'function' || previous._vxCallDetailLifecycleWrapped) return;

    var wrapped = function customerCallDetailResetBridge() {
      var result = previous.apply(this, arguments);
      clearOwnedDetailState();
      return result;
    };
    wrapped._vxCallDetailLifecycleWrapped = true;
    wrapped._vxPrevious = previous;
    root.vxResetCallDetailViewState = wrapped;
    try { vxResetCallDetailViewState = wrapped; } catch (_error) {}
  }

  function installTaskBridge() {
    var previous = root.showTaskDetail;
    if (typeof previous !== 'function' || previous._vxCallDetailLifecycleWrapped) return;

    var wrapped = function customerTaskDetailBridge() {
      clearOwnedDetailState();
      return previous.apply(this, arguments);
    };
    wrapped._vxCallDetailLifecycleWrapped = true;
    wrapped._vxPrevious = previous;
    root.showTaskDetail = wrapped;
    try { showTaskDetail = wrapped; } catch (_error) {}
  }

  installCanonicalNavigation();

  var attempts = 0;
  var timer = root.setInterval(function () {
    attempts += 1;
    rememberCanonicalOwners();
    restoreCanonicalOwners();
    installResetBridge();
    installTaskBridge();
    if (attempts > 200) root.clearInterval(timer);
  }, 50);
})(typeof globalThis !== 'undefined' ? globalThis : this);