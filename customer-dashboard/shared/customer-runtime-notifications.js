(function installCustomerNotificationBridge(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerNotificationBridgeInstalledV5) return;
  root.__vxCustomerNotificationBridgeInstalledV5 = true;

  const doc = root.document;
  let previousPageId = 'tab-dashboard';
  const EXPLICIT_SELECTOR = [
    '[data-notifications-trigger]','[data-notification-trigger]','#notification-button','#notifications-button',
    '#notification-bell','#notifications-bell','[aria-label*="Benachrichtigung" i]',
    '[title*="Benachrichtigung" i]','[aria-label*="notification" i]','[title*="notification" i]'
  ].join(',');
  const BELL_ICON_SELECTOR = '[class*="ph-bell" i],[data-lucide*="bell" i],svg[class*="bell" i],i[class*="bell" i]';
  const BACK_ICON_SELECTOR = '[class*="ph-arrow-left" i],[data-lucide*="arrow-left" i],svg[class*="arrow-left" i],i[class*="arrow-left" i]';

  function getPath(event) {
    if (event && typeof event.composedPath === 'function') return event.composedPath();
    const path = [];
    let node = event && event.target;
    while (node) { path.push(node); node = node.parentNode; }
    return path;
  }

  function resolveTriggerFromNode(node) {
    if (!node || node.nodeType !== 1) return null;
    const explicit = node.closest && node.closest(EXPLICIT_SELECTOR);
    if (explicit) return explicit.closest('button,a,[role="button"],[tabindex]') || explicit;
    const icon = node.matches && node.matches(BELL_ICON_SELECTOR) ? node : (node.closest && node.closest(BELL_ICON_SELECTOR));
    if (!icon) return null;
    return icon.closest('button,a,[role="button"],[tabindex],div,span') || icon;
  }

  function resolveTrigger(event) {
    const path = getPath(event);
    for (let i = 0; i < path.length; i += 1) {
      const trigger = resolveTriggerFromNode(path[i]);
      if (trigger) return trigger;
    }
    return null;
  }

  function clearLegacyVisibilityOverrides() {
    doc.querySelectorAll('.tab-page').forEach(function (page) {
      page.style.removeProperty('display');
      page.removeAttribute('hidden');
      page.removeAttribute('aria-hidden');
    });
  }

  function rememberCurrentPage() {
    const active = Array.from(doc.querySelectorAll('.tab-page.active')).find(function (page) {
      return page.id !== 'tab-benachrichtigungen';
    });
    if (active && active.id) previousPageId = active.id;
  }

  function prepareNativePage() {
    if (typeof root.vxBellUpdateBadge === 'function') root.vxBellUpdateBadge();
    if (typeof root.vxBellRender === 'function') root.vxBellRender();
    if (typeof root.vxBellPageRender === 'function') root.vxBellPageRender();
  }

  function navigateTo(tabName, trigger) {
    clearLegacyVisibilityOverrides();
    if (typeof root.showTab === 'function') {
      try {
        root.showTab(tabName, trigger || undefined);
        return true;
      } catch (error) {
        console.error('[customer-notifications] showTab failed', error);
      }
    }
    const page = doc.getElementById('tab-' + tabName);
    if (!page) return false;
    doc.querySelectorAll('.tab-page').forEach(function (item) { item.classList.toggle('active', item === page); });
    return true;
  }

  function openNativeNotifications(trigger) {
    rememberCurrentPage();
    prepareNativePage();
    if (!doc.getElementById('tab-benachrichtigungen')) return false;
    const opened = navigateTo('benachrichtigungen', trigger);
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: 0, behavior: 'auto' });
    return opened;
  }

  function restorePreviousPage() {
    const candidates = [previousPageId, 'tab-dashboard', 'tab-heute', 'tab-home'];
    let page = null;
    for (let i = 0; i < candidates.length && !page; i += 1) page = candidates[i] && doc.getElementById(candidates[i]);
    if (!page) return false;
    const restored = navigateTo(String(page.id).replace(/^tab-/, ''));
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: 0, behavior: 'auto' });
    return restored;
  }

  function isNotificationBackAction(event) {
    const page = doc.getElementById('tab-benachrichtigungen');
    const target = event && event.target;
    if (!page || !target || !page.contains(target)) return false;
    const control = target.closest && target.closest('button,a,[role="button"],[tabindex],div');
    if (!control || !page.contains(control)) return false;
    const label = String(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent || '').trim();
    return /zurück|back/i.test(label) || (control.matches && control.matches(BACK_ICON_SELECTOR)) || !!(control.querySelector && control.querySelector(BACK_ICON_SELECTOR));
  }

  function bindTrigger(trigger) {
    if (!trigger || trigger.dataset.vxNotificationsBound === 'native-v5') return;
    trigger.dataset.vxNotificationsBound = 'native-v5';
    trigger.setAttribute('role', trigger.getAttribute('role') || 'button');
    trigger.setAttribute('tabindex', trigger.getAttribute('tabindex') || '0');
    trigger.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Benachrichtigungen öffnen');
    trigger.style.setProperty('pointer-events', 'auto', 'important');
    trigger.style.setProperty('cursor', 'pointer', 'important');
    trigger.style.setProperty('position', trigger.style.position || 'relative', 'important');
    trigger.style.setProperty('z-index', '1301', 'important');
  }

  function prepareTriggers() {
    const candidates = new Set();
    doc.querySelectorAll(EXPLICIT_SELECTOR + ',' + BELL_ICON_SELECTOR).forEach(function (node) {
      const trigger = resolveTriggerFromNode(node) || node;
      if (trigger) candidates.add(trigger);
    });
    candidates.forEach(bindTrigger);
  }

  function handleActivation(event) {
    if (isNotificationBackAction(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      restorePreviousPage();
      return;
    }
    const trigger = resolveTrigger(event);
    if (!trigger) return;
    bindTrigger(trigger);
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    openNativeNotifications(trigger);
  }

  doc.addEventListener('pointerdown', handleActivation, true);
  doc.addEventListener('click', handleActivation, true);
  doc.addEventListener('touchend', handleActivation, true);
  doc.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') handleActivation(event);
  }, true);

  root.vxOpenCustomerNotifications = openNativeNotifications;
  root.vxCloseCustomerNotifications = restorePreviousPage;

  function boot() {
    clearLegacyVisibilityOverrides();
    prepareTriggers();
    new MutationObserver(prepareTriggers).observe(doc.documentElement, { childList: true, subtree: true });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
