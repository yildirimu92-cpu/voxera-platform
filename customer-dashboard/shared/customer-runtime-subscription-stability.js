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

  function installCommercialMobileStyles() {
    if (root.document.getElementById('vx-commercial-mobile-stability')) return;
    const style = root.document.createElement('style');
    style.id = 'vx-commercial-mobile-stability';
    style.textContent = `
      #vx-commercial-overlay {
        z-index: 9400 !important;
      }

      #vx-commercial-overlay .vx-commercial-modal {
        overflow: hidden;
      }

      #vx-commercial-overlay .modal-shell {
        min-height: 0;
      }

      #vx-commercial-overlay .modal-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 42px;
        align-items: start;
        gap: 12px;
      }

      #vx-commercial-overlay .modal-close {
        display: inline-grid !important;
        place-items: center;
        width: 42px !important;
        min-width: 42px !important;
        height: 42px !important;
        min-height: 42px !important;
        padding: 0 !important;
        border-radius: 12px !important;
      }

      @media (max-width: 768px) {
        #vx-commercial-overlay.overlay--sheet {
          align-items: flex-end !important;
          padding: 0 !important;
        }

        #vx-commercial-overlay .vx-commercial-modal {
          width: 100% !important;
          max-width: none !important;
          max-height: calc(100dvh - 72px) !important;
          margin: 0 !important;
          border-radius: 24px 24px 0 0 !important;
          background: #fff !important;
          box-shadow: 0 -20px 60px rgba(15, 35, 71, 0.22) !important;
        }

        #vx-commercial-overlay .modal-shell {
          display: grid !important;
          grid-template-rows: auto minmax(0, 1fr) auto !important;
          max-height: calc(100dvh - 72px) !important;
          overflow: hidden !important;
        }

        #vx-commercial-overlay .modal-head {
          position: relative !important;
          z-index: 2 !important;
          padding: 20px 20px 16px !important;
          border-bottom: 1px solid rgba(148, 163, 184, 0.2) !important;
          background: #0d1f3c !important;
        }

        #vx-commercial-overlay .modal-title {
          color: #fff !important;
          font-size: 21px !important;
          line-height: 1.2 !important;
        }

        #vx-commercial-overlay .modal-sub {
          margin-top: 4px !important;
          color: rgba(255, 255, 255, 0.66) !important;
          font-size: 13px !important;
          line-height: 1.4 !important;
        }

        #vx-commercial-overlay .modal-close {
          border: 1px solid rgba(255, 255, 255, 0.16) !important;
          background: rgba(255, 255, 255, 0.1) !important;
          color: #fff !important;
        }

        #vx-commercial-overlay .vx-commercial-body {
          min-height: 0 !important;
          padding: 16px !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }

        #vx-commercial-overlay .vx-commercial-choice-grid {
          gap: 10px !important;
        }

        #vx-commercial-overlay .vx-commercial-choice {
          min-height: 86px !important;
          padding: 15px 16px !important;
          border-radius: 15px !important;
        }

        #vx-commercial-overlay .vx-commercial-summary {
          padding: 15px 16px !important;
          border-radius: 15px !important;
        }

        #vx-commercial-overlay .vx-commercial-actions {
          display: grid !important;
          grid-template-columns: 1fr !important;
          gap: 8px !important;
          padding: 12px 16px calc(14px + env(safe-area-inset-bottom, 0px)) !important;
          border-top: 1px solid rgba(148, 163, 184, 0.2) !important;
          background: rgba(255, 255, 255, 0.98) !important;
        }

        #vx-commercial-overlay .vx-commercial-actions .modal-btn {
          width: 100% !important;
          min-height: 48px !important;
        }

        #vx-commercial-overlay .vx-commercial-actions .modal-btn-s {
          order: 2;
        }
      }
    `;
    root.document.head.appendChild(style);
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

  function installPlanFallback() {
    if (root.__vxCommercialPlanFallbackInstalled) return true;
    if (typeof root.vxAboUpgrade !== 'function' || typeof root.vxCommercialRender !== 'function' || typeof root.vxCommercialOpen !== 'function') return false;

    const original = root.vxAboUpgrade;
    root.vxAboUpgrade = function stablePlanUpgradeOpen() {
      let state = null;
      try {
        state = typeof root.getUpgradeModalState === 'function' ? root.getUpgradeModalState() : null;
      } catch (error) {
        reportAsyncError('upgrade state failed', error);
      }

      const upgrades = state && Array.isArray(state.upgrades) ? state.upgrades : [];
      if (upgrades.length) return original.apply(this, arguments);

      const currentPlan = String((root.customerMeta && root.customerMeta.plan) || '').toLowerCase();
      const order = ['starter', 'business', 'professional'];
      const labels = { starter: 'Starter', business: 'Business', professional: 'Professional' };
      const currentIndex = order.indexOf(currentPlan);
      const fallbackPlans = order.slice(Math.max(0, currentIndex + 1));
      const options = fallbackPlans.map(function (plan) {
        return {
          value: plan,
          title: labels[plan],
          meta: 'Konditionen und verfügbares Minutenvolumen werden vor der Umstellung geprüft.'
        };
      });

      root.vxCommercialState = {
        type: 'plan_upgrade',
        selected: '',
        options: options,
        estimatedAmount: null,
        submitting: false
      };
      root.vxCommercialRender();

      if (!options.length) {
        const body = root.document.getElementById('vx-commercial-body');
        const submit = root.document.getElementById('vx-commercial-submit');
        if (body) {
          body.innerHTML = '<div class="vx-commercial-summary"><strong>Aktuell kein höherer Standardplan verfügbar</strong><p>Ihr bestehender Plan ist bereits die höchste reguläre Stufe. Für ein individuelles Volumen oder Sonderkonditionen kann Voxera eine separate Lösung prüfen.</p></div>';
        }
        if (submit) submit.disabled = true;
      }

      root.vxCommercialOpen();
    };

    root.__vxCommercialPlanFallbackInstalled = true;
    return true;
  }

  function installWrappers() {
    installCommercialMobileStyles();
    const documentsReady = wrapDocumentLoader();
    const subscriptionReady = wrapSubscriptionInitializer();
    const commercialReady = installPlanFallback();
    if (documentsReady && subscriptionReady && commercialReady) return;

    installAttempts += 1;
    if (installAttempts < 160) root.setTimeout(installWrappers, 100);
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', installWrappers, { once: true });
  } else {
    installWrappers();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
