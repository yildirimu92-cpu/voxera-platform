(function installCustomerSettingsNavigation(root) {
  'use strict';
  if (!root || !root.document || root.__vxSettingsNavigationInstalled) return;
  root.__vxSettingsNavigationInstalled = true;

  function ensureReportShortcut() {
    const list = root.document.querySelector('#mehr-main .vx-settings-list');
    if (!list || root.document.getElementById('vx-settings-report-shortcut')) return !!list;

    const button = root.document.createElement('button');
    button.type = 'button';
    button.id = 'vx-settings-report-shortcut';
    button.className = 'vx-settings-entry';
    button.innerHTML = '<span class="vx-settings-entry-icon"><i class="ph-bold ph-chart-bar" aria-hidden="true"></i></span>'
      + '<span class="vx-settings-entry-copy"><span class="vx-settings-entry-title">Bericht</span>'
      + '<span class="vx-settings-entry-subtitle">Anrufstatistiken &amp; Auswertung</span></span>'
      + '<i class="ph-bold ph-caret-right vx-settings-entry-caret" aria-hidden="true"></i>';
    button.addEventListener('click', function () {
      if (typeof root.showTab === 'function') {
        const target = root.document.getElementById('nav-auswertung') || root.document.getElementById('mnav-auswertung');
        root.showTab('auswertung', target || undefined);
      }
    });

    const firstEntry = list.querySelector('.vx-settings-entry');
    list.insertBefore(button, firstEntry || null);
    return true;
  }

  function boot(attempt) {
    if (ensureReportShortcut()) return;
    if (attempt < 60) root.setTimeout(function () { boot(attempt + 1); }, 100);
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', function () { boot(0); }, { once: true });
  } else {
    boot(0);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
