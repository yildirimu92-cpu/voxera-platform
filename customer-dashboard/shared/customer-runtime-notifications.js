(function installCustomerNotificationBridge(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerNotificationBridgeInstalledV4) return;
  root.__vxCustomerNotificationBridgeInstalledV4 = true;

  const doc = root.document;
  let previousPageId = '';
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
  const BACK_ICON_SELECTOR = '[class*="ph-arrow-left" i],[data-lucide*="arrow-left" i],svg[class*="arrow-left" i],i[class*="arrow-left" i]';

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

  function rememberCurrentPage() {
    const active = Array.from(doc.querySelectorAll('.tab-page')).find(function (item) {
      return item.id !== 'tab-benachrichtigungen' && (item.classList.contains('active') || (!item.hidden && item.style.display !== 'none'));
    });
    if (active && active.id) previousPageId = active.id;
    if (!previousPageId) previousPageId = 'tab-dashboard';
  }

  function activateOnly(page) {
    if (!page) return false;
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
    return true;
  }

  function openNativeNotifications(trigger) {
    rememberCurrentPage();
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

    activateOnly(page);
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }

  function restorePreviousPage() {
    const fallbackIds = [previousPageId, 'tab-dashboard', 'tab-heute', 'tab-home'];
    let page = null;
    for (let index = 0; index < fallbackIds.length && !page; index += 1) {
      if (fallbackIds[index]) page = doc.getElementById(fallbackIds[index]);
    }
    if (!page) page = Array.from(doc.querySelectorAll('.tab-page')).find(function (item) { return item.id !== 'tab-benachrichtigungen'; });
    if (!page) return false;

    const tabName = String(page.id || '').replace(/^tab-/, '');
    if (typeof root.showTab === 'function' && tabName) {
      try { root.showTab(tabName); }
      catch (error) { console.error('[customer-notifications] restore showTab failed', error); }
    }
    activateOnly(page);
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }

  function isNotificationBackAction(event) {
    const page = doc.getElementById('tab-benachrichtigungen');
    const target = event && event.target;
    if (!page || !target || !page.contains(target)) return false;
    const control = target.closest && target.closest('button,a,[role="button"],[tabindex],div');
    if (!control || !page.contains(control)) return false;
    const label = String(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent || '').trim();
    return /zurück|back/i.test(label) || !!(control.matches && control.matches(BACK_ICON_SELECTOR)) || !!(control.querySelector && control.querySelector(BACK_ICON_SELECTOR));
  }

  function bindTrigger(trigger) {
    if (!trigger || trigger.dataset.vxNotificationsBound === 'native-v4') return;
    trigger.dataset.vxNotificationsBound = 'native-v4';
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
    if (isNotificationBackAction(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      restorePreviousPage();
      return;
    }
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
  root.vxCloseCustomerNotifications = restorePreviousPage;

  function boot() {
    prepareTriggers();
    const observer = new MutationObserver(function () { prepareTriggers(); });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
