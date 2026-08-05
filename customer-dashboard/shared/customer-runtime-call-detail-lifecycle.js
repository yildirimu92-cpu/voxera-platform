(function initCustomerCallDetailLifecycleOwner(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerCallDetailLifecycleInstalled) return;
  root.__vxCustomerCallDetailLifecycleInstalled = true;

  var ownedDetailRenderer = null;
  var ownedSplitRenderer = null;

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
