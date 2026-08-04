(function installCustomerNotificationBridge(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerNotificationBridgeInstalled) return;
  root.__vxCustomerNotificationBridgeInstalled = true;

  const TRIGGER_SELECTOR = [
    '[data-notifications-trigger]',
    '[data-notification-trigger]',
    '#notification-button',
    '#notifications-button',
    '#notification-bell',
    '#notifications-bell',
    'button[aria-label*="Benachrichtigung" i]',
    '[role="button"][aria-label*="Benachrichtigung" i]',
    'button[title*="Benachrichtigung" i]',
    'button[aria-label*="notification" i]',
    '[role="button"][aria-label*="notification" i]'
  ].join(',');

  function containsBellIcon(node) {
    if (!node || node.nodeType !== 1) return false;
    const ownClass = String((node.className && node.className.baseVal) || node.className || '');
    const lucide = String(node.getAttribute && node.getAttribute('data-lucide') || '');
    if (/(?:^|\s)ph(?:-[a-z]+)*-bell(?:-[a-z]+)*(?:\s|$)/i.test(ownClass)) return true;
    if (/bell/i.test(lucide)) return true;
    return !!(node.querySelector && node.querySelector('[class*="ph-bell" i],svg[data-lucide*="bell" i],svg[class*="bell" i],i[class*="bell" i]'));
  }

  function resolveTrigger(target) {
    if (!target || !target.closest) return null;
    const explicit = target.closest(TRIGGER_SELECTOR);
    if (explicit) return explicit.closest('button,a,[role="button"],[tabindex]') || explicit;
    const interactive = target.closest('button,a,[role="button"],[tabindex]');
    return interactive && containsBellIcon(interactive) ? interactive : null;
  }

  function prepareNativePage() {
    if (typeof root.vxBellUpdateBadge === 'function') root.vxBellUpdateBadge();
    if (typeof root.vxBellRender === 'function') root.vxBellRender();
    if (typeof root.vxBellPageRender === 'function') root.vxBellPageRender();
  }

  function openNativeNotifications(trigger) {
    prepareNativePage();

    const page = root.document.getElementById('tab-benachrichtigungen');
    if (!page) {
      console.error('[customer-notifications] native page missing');
      return false;
    }

    if (typeof root.showTab === 'function') {
      try {
        root.showTab('benachrichtigungen', trigger || undefined);
      } catch (error) {
        console.error('[customer-notifications] showTab failed', error);
      }
    }

    root.document.querySelectorAll('.tab-page').forEach(function (item) {
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
    root.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }

  function prepareTriggers() {
    const candidates = Array.from(root.document.querySelectorAll('button,a,[role="button"],[tabindex]'))
      .filter(function (node) { return node.matches(TRIGGER_SELECTOR) || containsBellIcon(node); });
    candidates.forEach(function (trigger) {
      trigger.dataset.vxNotificationsBound = 'native-v1';
      trigger.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Benachrichtigungen öffnen');
      trigger.setAttribute('aria-haspopup', 'true');
    });
    return candidates.length > 0;
  }

  function boot(attempt) {
    if (prepareTriggers()) return;
    if (attempt < 80) root.setTimeout(function () { boot(attempt + 1); }, 100);
  }

  root.document.addEventListener('click', function (event) {
    const trigger = resolveTrigger(event.target);
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openNativeNotifications(trigger);
  }, true);

  root.document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = resolveTrigger(event.target);
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openNativeNotifications(trigger);
  }, true);

  root.vxOpenCustomerNotifications = openNativeNotifications;

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', function () { boot(0); }, { once: true });
  } else {
    boot(0);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
