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

  function installWrappers() {
    const documentsReady = wrapDocumentLoader();
    const subscriptionReady = wrapSubscriptionInitializer();
    if (documentsReady && subscriptionReady) return;

    installAttempts += 1;
    if (installAttempts < 160) root.setTimeout(installWrappers, 100);
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', installWrappers, { once: true });
  } else {
    installWrappers();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
