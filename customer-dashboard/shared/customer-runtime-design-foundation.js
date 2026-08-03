(function loadVoxeraCustomerDesignSystem(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerDesignFoundationInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxCustomerDesignFoundationInstalled = true;

  // Styling lives exclusively in explicit CSS modules.
  const stylesheets = [
    '/shared/customer-design-system.css?v=20260803-1',
    '/shared/customer-dashboard-components.css?v=20260803-1',
    '/shared/customer-assistant-components.css?v=20260803-1',
    '/shared/customer-assistant-status.css?v=20260803-1',
    '/shared/customer-navigation-components.css?v=20260803-1',
    '/shared/customer-settings-components.css?v=20260803-2',
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

  const markDashboard = () => {
    const page = root.document.getElementById('tab-dashboard');
    if (!page) return;
    page.dataset.customerSurface = 'dashboard';
    page.querySelectorAll('.dash-status-title,.dash-glass-title,.vx-jetzt-title').forEach((node) => {
      node.dataset.customerTitle = 'dashboard';
    });
    page.querySelectorAll('.dash-status-hero,.dash-kpi,.dash-focus-card,.dash-glass,.vx-jetzt-section').forEach((node) => {
      node.dataset.customerCard = 'dashboard';
    });
    page.querySelectorAll('.dash-kpi[onclick],.dash-glass-link[onclick],.vx-jetzt-link[onclick]').forEach((node) => {
      node.dataset.customerAction = 'dashboard';
    });
  };

  const markDocument = () => {
    root.document.documentElement.classList.add('vx-customer-design-foundation-html');
    root.document.body?.classList.add('vx-customer-design-foundation');
    markDashboard();
  };

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', markDocument, { once: true });
  } else {
    markDocument();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
