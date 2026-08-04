(function installSubscriptionStabilityRuntime(root) {
  'use strict';
  if (!root || !root.document || root.__vxSubscriptionStabilityRuntimeInstalled) return;
  root.__vxSubscriptionStabilityRuntimeInstalled = true;

  const DOCUMENT_WAIT_MS = 2200;
  const SUBSCRIPTION_WAIT_MS = 900;
  let documentFlight = null;
  let installAttempts = 0;

  function delay(ms, value) {
    return new Promise((resolve) => root.setTimeout(function () { resolve(value); }, ms));
  }

  function reportAsyncError(scope, error) {
    if (root.console && typeof root.console.error === 'function') {
      root.console.error('[subscription-stability] ' + scope, error);
    }
  }

  function markDocumentLoadingAsBackground() {
    const contract = root.document.getElementById('abo-contract-documents');
    const invoices = root.document.getElementById('abo-invoices-list');
    [contract, invoices].filter(Boolean).forEach(function (node) {
      if (node.dataset.vxBackgroundLoadHint === '1') return;
      node.dataset.vxBackgroundLoadHint = '1';
      const empty = node.querySelector('.vx-abo-empty');
      if (empty && /wird geladen/i.test(String(empty.textContent || ''))) {
        empty.textContent = 'Wird im Hintergrund geladen …';
      }
    });
  }

  function wrapDocumentLoader() {
    if (root.__vxSubscriptionDocumentLoaderWrapped) return true;
    if (typeof root.vxLoadCustomerDocuments !== 'function') return false;

    const original = root.vxLoadCustomerDocuments;
    root.vxLoadCustomerDocuments = function stableCustomerDocumentLoad(forceReload) {
      if (!documentFlight || forceReload === true) {
        documentFlight = Promise.resolve()
          .then(function () { return original.call(root, forceReload); })
          .catch(function (error) {
            reportAsyncError('document load failed', error);
            return { loaded: false, error: error || new Error('document_load_failed') };
          })
          .finally(function () { documentFlight = null; });
      }

      const currentFlight = documentFlight;
      return Promise.race([
        currentFlight,
        delay(DOCUMENT_WAIT_MS, { loading: true, background: true })
      ]).then(function (result) {
        if (result && result.background) markDocumentLoadingAsBackground();
        return result;
      });
    };

    root.vxRetryCustomerDocuments = function retryCustomerDocuments() {
      return root.vxLoadCustomerDocuments(true);
    };
    root.__vxSubscriptionDocumentLoaderWrapped = true;
    return true;
  }

  function wrapSubscriptionInitializer() {
    if (root.__vxSubscriptionInitializerWrapped) return true;
    if (typeof root.vxInitAbonnement !== 'function') return false;

    const original = root.vxInitAbonnement;
    root.vxInitAbonnement = function responsiveSubscriptionInit() {
      const args = arguments;
      const context = this;
      const work = Promise.resolve()
        .then(function () { return original.apply(context, args); })
        .catch(function (error) {
          reportAsyncError('subscription initialization failed', error);
          return null;
        });

      return Promise.race([
        work,
        delay(SUBSCRIPTION_WAIT_MS, { loading: true, background: true })
      ]).then(function (result) {
        if (result && result.background) markDocumentLoadingAsBackground();
        return result;
      });
    };
    root.__vxSubscriptionInitializerWrapped = true;
    return true;
  }

  function isPortalLayer(node) {
    if (!node || node.nodeType !== 1) return false;
    const id = String(node.id || '').toLowerCase();
    const cls = String(node.className || '').toLowerCase();
    return id.includes('overlay') || id.includes('modal') || id.includes('popover') ||
      id.includes('notification') || id.includes('notif') || id.includes('bell') ||
      cls.includes('overlay') || cls.includes('modal') || cls.includes('popover') ||
      cls.includes('notification') || cls.includes('notif') || cls.includes('bell');
  }

  function shouldHoist(node) {
    if (!isPortalLayer(node) || node === root.document.body || node === root.document.documentElement) return false;
    if (node.parentElement === root.document.body) return false;
    const style = root.getComputedStyle ? root.getComputedStyle(node) : null;
    const positioned = style && (style.position === 'fixed' || style.position === 'absolute');
    const overlayLike = node.matches && node.matches('.overlay,.vx-custom-overlay,[role="dialog"],[aria-modal="true"]');
    return !!(positioned || overlayLike || /overlay|modal|popover/.test(String(node.id || '') + ' ' + String(node.className || '')));
  }

  function hoistPortalLayers() {
    const selectors = [
      '#vx-commercial-overlay',
      '#confirm-overlay',
      '#vx-upgrade-overlay',
      '#vx-minutes-overlay',
      '#upgrade-overlay',
      '#minutes-overlay',
      '[aria-modal="true"]',
      '.overlay',
      '.vx-custom-overlay',
      '[id*="popover"]',
      '[id*="notification"]',
      '[id*="notif"]',
      '[id*="bell"]'
    ];
    const seen = new Set();
    selectors.forEach(function (selector) {
      root.document.querySelectorAll(selector).forEach(function (node) {
        if (seen.has(node)) return;
        seen.add(node);
        if (shouldHoist(node)) {
          root.document.body.appendChild(node);
          node.dataset.vxPortalHoisted = '1';
        }
      });
    });
  }

  function layerIsOpen(node) {
    if (!node || node.nodeType !== 1) return false;
    const style = root.getComputedStyle ? root.getComputedStyle(node) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
    return node.classList.contains('open') || node.getAttribute('aria-hidden') === 'false' ||
      (style && (style.position === 'fixed' || style.position === 'absolute') && style.pointerEvents !== 'none');
  }

  function normalizeClosedLayers() {
    root.document.querySelectorAll('.overlay,.vx-custom-overlay,[id*="overlay"]').forEach(function (node) {
      const open = node.classList.contains('open') || node.getAttribute('aria-hidden') === 'false' || node.style.display === 'flex';
      if (!open) {
        node.style.pointerEvents = 'none';
      } else {
        node.style.pointerEvents = 'auto';
      }
    });
  }

  function releaseOrphanScrollLock() {
    const candidates = Array.from(root.document.querySelectorAll('.overlay,.vx-custom-overlay,[aria-modal="true"],[id*="overlay"]'));
    const anyOpen = candidates.some(layerIsOpen);
    if (anyOpen) return;
    root.document.documentElement.style.removeProperty('overflow');
    root.document.body.style.removeProperty('overflow');
    root.document.body.style.removeProperty('position');
    root.document.body.style.removeProperty('width');
    ['modal-open', 'overlay-open', 'no-scroll', 'vx-overlay-open'].forEach(function (name) {
      root.document.documentElement.classList.remove(name);
      root.document.body.classList.remove(name);
    });
  }

  function wrapLayerFunction(name) {
    const fn = root[name];
    if (typeof fn !== 'function' || fn.__vxPortalWrapped) return typeof fn === 'function';
    function wrapped() {
      hoistPortalLayers();
      normalizeClosedLayers();
      const result = fn.apply(this, arguments);
      root.setTimeout(function () {
        hoistPortalLayers();
        normalizeClosedLayers();
        releaseOrphanScrollLock();
      }, 0);
      return result;
    }
    wrapped.__vxPortalWrapped = true;
    root[name] = wrapped;
    return true;
  }

  function installPortalRepair() {
    hoistPortalLayers();
    normalizeClosedLayers();
    [
      'vxCommercialOpen',
      'vxCommercialClose',
      'vxAboUpgrade',
      'vxAboMinuten',
      'vxSubmitCancellationRequest',
      'vxSubmitReactivationRequest',
      'vxWithdrawCancellationRequest',
      'openConfirmModal',
      'closeConfirmModal',
      'vxBellToggle',
      'vxToggleBell',
      'toggleNotificationPanel'
    ].forEach(wrapLayerFunction);
  }

  root.document.addEventListener('click', function portalClickRepair(event) {
    const target = event.target && event.target.closest
      ? event.target.closest('button,a,[role="button"]')
      : null;
    if (!target) return;
    const signature = (String(target.id || '') + ' ' + String(target.className || '') + ' ' + String(target.getAttribute('aria-label') || '') + ' ' + String(target.textContent || '')).toLowerCase();
    if (/kündigung|plan wechseln|zusatzminuten|glocke|benachrichtigung|bell|notif/.test(signature)) {
      hoistPortalLayers();
      root.setTimeout(function () {
        hoistPortalLayers();
        normalizeClosedLayers();
        releaseOrphanScrollLock();
      }, 0);
      root.setTimeout(function () {
        hoistPortalLayers();
        normalizeClosedLayers();
        releaseOrphanScrollLock();
      }, 250);
    }
  }, true);

  const observer = new MutationObserver(function () {
    hoistPortalLayers();
    normalizeClosedLayers();
  });

  function installWrappers() {
    const documentsReady = wrapDocumentLoader();
    const subscriptionReady = wrapSubscriptionInitializer();
    installPortalRepair();
    if (documentsReady && subscriptionReady) return;

    installAttempts += 1;
    if (installAttempts < 160) root.setTimeout(installWrappers, 100);
  }

  function boot() {
    observer.observe(root.document.documentElement, { childList: true, subtree: true });
    installWrappers();
    root.setInterval(function () {
      installPortalRepair();
      releaseOrphanScrollLock();
    }, 1000);
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
