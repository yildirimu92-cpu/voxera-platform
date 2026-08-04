(function repairVoxeraMobileNavigationContainment(root) {
  'use strict';
  if (!root || !root.document || root.__vxMobileNavigationContainmentRepairInstalled) return;
  root.__vxMobileNavigationContainmentRepairInstalled = true;

  const MOBILE_NAV_IDS = [
    'mnav-dashboard',
    'mnav-anrufe',
    'mnav-assistent',
    'mnav-auswertung',
    'mnav-mehr'
  ];

  function repair() {
    const nodes = MOBILE_NAV_IDS.map((id) => root.document.getElementById(id)).filter(Boolean);
    const container = nodes[0]?.parentElement;
    if (!container || !nodes.every((node) => node.parentElement === container)) return false;

    const settingsTab = root.document.getElementById('tab-einstellungen') || root.document.getElementById('tab-mehr');
    if (!settingsTab || !settingsTab.contains(container)) return true;

    const globalHost = settingsTab.parentElement;
    if (!globalHost) return false;
    globalHost.insertBefore(container, settingsTab.nextSibling);
    container.dataset.vxNavigationContainmentRepaired = '1';
    return true;
  }

  function boot() {
    if (repair()) return;
    root.setTimeout(boot, 100);
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
