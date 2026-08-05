(function loadVoxeraCustomerDesignSystem(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerDesignFoundationInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxCustomerDesignFoundationInstalled = true;

  // Styling lives exclusively in explicit CSS modules.
  const stylesheets = [
    '/shared/customer-design-system.css?v=20260804-1',
    '/shared/customer-assistant-components.css?v=20260803-1',
    '/shared/customer-assistant-status.css?v=20260803-1',
    '/shared/customer-navigation-components.css?v=20260803-1',
    '/shared/customer-settings-components.css?v=20260803-2',
    '/shared/customer-support-components.css?v=20260802-2',
    '/shared/customer-call-log-components.css?v=20260805-3'
  ];

  stylesheets.forEach((href) => {
    if (root.document.querySelector(`link[data-vx-customer-stylesheet="${href}"]`)) return;
    const link = root.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.vxCustomerStylesheet = href;
    root.document.head.appendChild(link);
  });

  const loadSequentialScripts = (sources) => {
    const next = (index) => {
      if (index >= sources.length) return;
      const source = sources[index];
      if (root.document.querySelector(`script[data-vx-customer-runtime="${source}"]`)) {
        next(index + 1);
        return;
      }
      const script = root.document.createElement('script');
      script.src = source;
      script.async = false;
      script.dataset.vxCustomerRuntime = source;
      script.onload = () => next(index + 1);
      script.onerror = () => next(index + 1);
      root.document.head.appendChild(script);
    };
    next(0);
  };

  loadSequentialScripts([
    '/shared/customer-call-view-model.js?v=20260805-11',
    '/shared/customer-call-log-model.js?v=20260805-6',
    '/shared/customer-runtime-call-log-owner.js?v=20260805-6',
    '/shared/customer-runtime-call-detail-lifecycle.js?v=20260805-2',
    '/shared/customer-call-diagnostics.js?v=20260805-1',
    '/shared/customer-call-diagnostics-panel.js?v=20260805-1'
  ]);

  const markDocument = () => {
    root.document.documentElement.classList.add('vx-customer-design-foundation-html');
    root.document.body?.classList.add('vx-customer-design-foundation');
  };

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', markDocument, { once: true });
  } else {
    markDocument();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
