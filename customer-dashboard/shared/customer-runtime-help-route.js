(function initVoxeraCustomerHelpRoute(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerHelpRouteInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxCustomerHelpRouteInstalled = true;

  let opening = false;

  function textLabel(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function settingsList() {
    const main = document.getElementById('mehr-main');
    return main?.querySelector('.vx-page-header')?.nextElementSibling || null;
  }

  function findSettingsHelpEntry() {
    const list = settingsList();
    if (!list) return null;

    return Array.from(list.children).find((entry) => {
      const leafLabels = Array.from(entry.querySelectorAll('div,span'))
        .filter((node) => node.children.length === 0)
        .map((node) => textLabel(node));
      return leafLabels.includes('Hilfe') || textLabel(entry) === 'Hilfe';
    }) || null;
  }

  function restoreSettingsRoot() {
    const main = document.getElementById('mehr-main');
    if (main) main.style.display = '';
    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => {
      node.style.display = 'none';
    });
  }

  function openSupportFallback() {
    if (typeof root.requestSupport !== 'function') return false;
    root.requestSupport();
    return true;
  }

  function openSettingsHelp() {
    if (opening) return;
    opening = true;

    if (typeof root.showTab === 'function') {
      root.showTab('mehr');
    } else {
      document.getElementById('nav-mehr')?.click();
    }

    let attempts = 0;
    const open = () => {
      attempts += 1;
      restoreSettingsRoot();

      const entry = findSettingsHelpEntry();
      if (entry && typeof entry.click === 'function') {
        entry.dataset.vxSettingsHelpEntry = '1';
        entry.click();
        opening = false;
        return;
      }

      if (attempts < 8) {
        root.setTimeout(open, 100);
        return;
      }

      opening = false;
      if (!openSupportFallback() && typeof root.toast === 'function') {
        root.toast('Hilfe konnte nicht geöffnet werden.');
      }
    };

    root.setTimeout(open, 0);
  }

  function isDesktopSidebarHelp(node) {
    if (!node || textLabel(node) !== 'Hilfe') return false;
    if (node.closest('#tab-mehr')) return false;
    if (node.closest('.mobile-bottom-nav,.bottom-nav,[data-mobile-nav]')) return false;
    if (typeof root.matchMedia === 'function' && !root.matchMedia('(min-width:721px)').matches) return false;

    if (node.closest('aside,.sidebar,#sidebar,[class*="sidebar"],[class*="side-nav"]')) return true;

    const id = String(node.id || '').toLowerCase();
    const onclick = String(node.getAttribute?.('onclick') || '').toLowerCase();
    return /help|hilfe/.test(id) || /showtab\s*\([^)]*(help|hilfe)/.test(onclick);
  }

  function findClickedHelpControl(target) {
    let node = target instanceof Element ? target : null;
    let depth = 0;
    while (node && node !== document.body && depth < 7) {
      if (isDesktopSidebarHelp(node)) return node;
      node = node.parentElement;
      depth += 1;
    }
    return null;
  }

  function interceptHelpClick(event) {
    const control = findClickedHelpControl(event.target);
    if (!control) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openSettingsHelp();
  }

  document.addEventListener('click', interceptHelpClick, true);
})(typeof globalThis !== 'undefined' ? globalThis : this);
