(function loadVoxeraCustomerDesignSystem(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerDesignFoundationInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxCustomerDesignFoundationInstalled = true;

  // Styling lives exclusively in explicit CSS modules.
  const stylesheets = [
    '/shared/customer-design-system.css?v=20260802-3',
    '/shared/customer-assistant-components.css?v=20260802-2',
    '/shared/customer-assistant-status.css?v=20260802-1',
    '/shared/customer-navigation-components.css?v=20260802-2',
    '/shared/customer-support-components.css?v=20260802-2'
  ];

  stylesheets.forEach((href) => {
    if (root.document.querySelector(`link[data-vx-customer-stylesheet="${href}"]`)) return;
    const link = root.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.vxCustomerStylesheet = href;
    root.document.head.appendChild(link);
  });

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
