(function initCustomerCallDetailLifecycleOwner(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerCallDetailLifecycleInstalled) return;
  root.__vxCustomerCallDetailLifecycleInstalled = true;

  var ownedDetailRenderer = null;
  var ownedSplitRenderer = null;
  var mobileNavigationInstalled = false;

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

  function findOriginalRecord(callId) {
    var normalizedId = text(callId);
    if (!normalizedId) return null;
    var records = Array.isArray(root.allRecords) ? root.allRecords : [];
    return records.find(function (record) {
      return identityKeys(record).indexOf(normalizedId) !== -1;
    }) || null;
  }

  function isMobileViewport() {
    try { return root.matchMedia('(max-width: 768px)').matches; }
    catch (_error) { return (root.innerWidth || 0) <= 768; }
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
    page.setAttribute('aria-hidden', 'false');
    if (page.style.display === 'none') page.style.display = '';
    root.document.documentElement.classList.add('vx-call-detail-open');
    if (root.document.body) root.document.body.classList.add('vx-call-detail-open');
    return true;
  }

  function openCanonicalMobileDetail(callId) {
    if (!isMobileViewport()) return false;
    var original = findOriginalRecord(callId);
    var canonicalId = original ? (identityKeys(original)[0] || text(callId)) : text(callId);

    try {
      if (typeof root.showCallDetail === 'function') {
        root.showCallDetail(canonicalId, { forceFullscreen: true });
      } else if (original && ownedDetailRenderer) {
        ownedDetailRenderer(original, []);
      } else {
        return false;
      }
    } catch (_error) {
      if (original && ownedDetailRenderer) {
        try { ownedDetailRenderer(original, []); } catch (_renderError) { return false; }
      } else {
        return false;
      }
    }

    root.setTimeout(function () {
      var page = root.document.getElementById('call-detail-page');
      var visible = page && (page.classList.contains('show') || page.getAttribute('aria-hidden') === 'false');
      if (!visible && original && ownedDetailRenderer) {
        try { ownedDetailRenderer(original, []); } catch (_error) {}
      }
      ensureFullscreenVisible();
    }, 0);
    return true;
  }

  function installMobileNavigation() {
    if (mobileNavigationInstalled) return;
    mobileNavigationInstalled = true;

    root.document.addEventListener('click', function (event) {
      if (!isMobileViewport()) return;
      var row = event.target && event.target.closest ? event.target.closest('[data-vx-call-id]') : null;
      if (!row) return;
      var callId = text(row.getAttribute('data-vx-call-id'));
      if (!callId) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openCanonicalMobileDetail(callId);
    }, true);

    root.document.addEventListener('keydown', function (event) {
      if (!isMobileViewport() || (event.key !== 'Enter' && event.key !== ' ')) return;
      var row = event.target && event.target.closest ? event.target.closest('[data-vx-call-id]') : null;
      if (!row) return;
      var callId = text(row.getAttribute('data-vx-call-id'));
      if (!callId) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openCanonicalMobileDetail(callId);
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

  installMobileNavigation();

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
