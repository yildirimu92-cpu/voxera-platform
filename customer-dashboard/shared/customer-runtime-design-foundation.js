(function loadVoxeraCustomerDesignSystem(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerDesignFoundationInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxCustomerDesignFoundationInstalled = true;

  const href = '/shared/customer-design-system.css?v=20260802-2';
  if (!root.document.querySelector(`link[data-vx-customer-design-system="${href}"]`)) {
    const link = root.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.vxCustomerDesignSystem = href;
    root.document.head.appendChild(link);
  }

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
