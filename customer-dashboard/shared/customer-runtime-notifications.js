(function installCustomerNotificationBridge(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerNotificationBridgeInstalledV3) return;
  root.__vxCustomerNotificationBridgeInstalledV3 = true;

  const doc = root.document;
  const EXPLICIT_SELECTOR = [
    '[data-notifications-trigger]',
    '[data-notification-trigger]',
    '#notification-button',
    '#notifications-button',
    '#notification-bell',
    '#notifications-bell',
    '[aria-label*="Benachrichtigung" i]',
    '[title*="Benachrichtigung" i]',
    '[aria-label*="notification" i]',
    '[title*="notification" i]'
  ].join(',');
  const BELL_ICON_SELECTOR = '[class*="ph-bell" i],[data-lucide*="bell" i],svg[class*="bell" i],i[class*="bell" i]';

  function containsBellIcon(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches && node.matches(BELL_ICON_SELECTOR)) return true;
    return !!(node.querySelector && node.querySelector(BELL_ICON_SELECTOR));
  }

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
    for (let index = 0; index < path.length; index += 1) {
      const node = path[index];
      const trigger = resolveTriggerFromNode(node);
      if (trigger) return trigger;
    }
    return null;
  }

  function prepareNativePage() {
    if (typeof root.vxBellUpdateBadge === 'function') root.vxBellUpdateBadge();
    if (typeof root.vxBellRender === 'function') root.vxBellRender();
    if (typeof root.vxBellPageRender === 'function') root.vxBellPageRender();
  }

  function openNativeNotifications(trigger) {
    prepareNativePage();
    const page = doc.getElementById('tab-benachrichtigungen');
    if (!page) {
      console.error('[customer-notifications] native page missing');
      return false;
    }

    if (typeof root.showTab === 'function') {
      try { root.showTab('benachrichtigungen', trigger || undefined); }
      catch (error) { console.error('[customer-notifications] showTab failed', error); }
    }

    doc.querySelectorAll('.tab-page').forEach(function (item) {
      const active = item === page;
      item.classList.toggle('active', active);
      item.style.display = active ? '' : 'none';
      item.hidden = !active;
      item.setAttribute('aria-hidden', active ? 'false' : 'true');
    });

    page.classList.add('active');
    page.style.display = '';
    page.hidden = false;
    page.setAttribute('aria-hidden', 'false');
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }

  function bindTrigger(trigger) {
    if (!trigger || trigger.dataset.vxNotificationsBound === 'native-v3') return;
    trigger.dataset.vxNotificationsBound = 'native-v3';
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
    return candidates.size > 0;
  }

  function handleActivation(event) {
    const trigger = resolveTrigger(event);
    if (!trigger) return;
    bindTrigger(trigger);
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    openNativeNotifications(trigger);
  }

  doc.addEventListener('pointerdown', handleActivation, true);
  doc.addEventListener('click', handleActivation, true);
  doc.addEventListener('touchend', handleActivation, true);
  doc.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    handleActivation(event);
  }, true);

  root.vxOpenCustomerNotifications = openNativeNotifications;

  function boot() {
    prepareTriggers();
    const observer = new MutationObserver(function () { prepareTriggers(); });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
