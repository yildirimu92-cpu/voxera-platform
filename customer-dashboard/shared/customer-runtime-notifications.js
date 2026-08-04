(function installCustomerNotifications(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerNotificationsInstalled) return;
  root.__vxCustomerNotificationsInstalled = true;

  let activeBell = null;
  let panel = null;

  function hasBellIcon(node) {
    if (!node || node.nodeType !== 1) return false;
    const ownClass = String((node.className && node.className.baseVal) || node.className || '');
    const lucide = String(node.getAttribute && node.getAttribute('data-lucide') || '');
    if (/(?:^|\s)ph(?:-[a-z]+)*-bell(?:-[a-z]+)*(?:\s|$)/i.test(ownClass)) return true;
    if (/bell/i.test(lucide)) return true;
    return !!(node.querySelector && node.querySelector('[class*="ph-bell" i],svg[data-lucide*="bell" i],svg[class*="bell" i],i[class*="bell" i]'));
  }

  function isBellTrigger(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches && node.matches([
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
    ].join(','))) return true;
    return hasBellIcon(node);
  }

  function findTriggerFromTarget(target) {
    if (!target || !target.closest) return null;
    const interactive = target.closest('button,a,[role="button"],[tabindex]');
    return interactive && isBellTrigger(interactive) ? interactive : null;
  }

  function allBellTriggers() {
    return Array.from(root.document.querySelectorAll('button,a,[role="button"],[tabindex]')).filter(isBellTrigger);
  }

  function ensureStyles() {
    if (root.document.getElementById('vx-customer-notifications-style')) return;
    const style = root.document.createElement('style');
    style.id = 'vx-customer-notifications-style';
    style.textContent = `
      #vx-customer-notifications{position:fixed;z-index:9999;display:none;width:min(360px,calc(100vw - 32px));box-sizing:border-box;background:#fff;border:1px solid rgba(226,232,240,.95);border-radius:24px;box-shadow:0 22px 55px rgba(15,35,71,.18);overflow:hidden;color:#111827;}
      #vx-customer-notifications.is-open{display:block;animation:vxNotificationsIn .16s ease-out;}
      .vx-notifications-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 22px 17px;border-bottom:1px solid #edf1f6;background:#fff;}
      .vx-notifications-title{font-size:21px;line-height:1.25;font-weight:750;color:#111827;}
      .vx-notifications-close{width:42px;height:42px;border:0;border-radius:14px;background:#f2f6fc;color:#475569;font-size:27px;line-height:1;display:grid;place-items:center;cursor:pointer;}
      .vx-notifications-close:focus-visible{outline:3px solid rgba(52,120,237,.24);outline-offset:2px;}
      .vx-notifications-body{padding:18px 20px 22px;}
      .vx-notifications-empty{min-height:154px;border:1px solid #e4eaf2;border-radius:18px;background:#f8fafc;display:grid;place-items:center;text-align:center;padding:22px;color:#64748b;font-size:15px;line-height:1.5;}
      .vx-notifications-empty strong{display:block;color:#111827;font-size:17px;line-height:1.35;margin-bottom:7px;}
      @keyframes vxNotificationsIn{from{opacity:0;transform:translateY(-7px) scale(.985)}to{opacity:1;transform:none}}
      @media(max-width:768px){#vx-customer-notifications{width:min(360px,calc(100vw - 24px));border-radius:22px}.vx-notifications-head{padding:20px 20px 16px}.vx-notifications-body{padding:16px 18px 20px}}
    `;
    root.document.head.appendChild(style);
  }

  function ensurePanel() {
    panel = root.document.getElementById('vx-customer-notifications');
    if (panel) return panel;

    panel = root.document.createElement('section');
    panel.id = 'vx-customer-notifications';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'vx-notifications-title');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = '<header class="vx-notifications-head"><div id="vx-notifications-title" class="vx-notifications-title">Benachrichtigungen</div><button type="button" class="vx-notifications-close" aria-label="Benachrichtigungen schliessen">×</button></header><div class="vx-notifications-body"><div class="vx-notifications-empty"><div><strong>Keine neuen Benachrichtigungen</strong>Wichtige Änderungen und Hinweise erscheinen künftig hier.</div></div></div>';
    root.document.body.appendChild(panel);

    panel.querySelector('.vx-notifications-close').addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    });
    panel.addEventListener('click', function (event) { event.stopPropagation(); });
    return panel;
  }

  function positionPanel() {
    if (!activeBell || !root.document.contains(activeBell)) return;
    const targetPanel = ensurePanel();
    const rect = activeBell.getBoundingClientRect();
    const margin = root.innerWidth <= 768 ? 12 : 16;
    const gap = 10;
    const width = Math.min(360, root.innerWidth - margin * 2);
    const left = Math.max(margin, Math.min(root.innerWidth - width - margin, rect.right - width));
    const maxTop = Math.max(margin, root.innerHeight - targetPanel.offsetHeight - margin);
    const top = Math.min(rect.bottom + gap, maxTop);

    targetPanel.style.width = width + 'px';
    targetPanel.style.left = Math.round(left) + 'px';
    targetPanel.style.right = 'auto';
    targetPanel.style.top = Math.round(top) + 'px';
  }

  function isOpen() {
    return !!(panel && panel.classList.contains('is-open'));
  }

  function closePanel() {
    if (!panel) return;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    allBellTriggers().forEach(function (trigger) { trigger.setAttribute('aria-expanded', 'false'); });
  }

  function openPanel(trigger) {
    activeBell = trigger;
    ensureStyles();
    ensurePanel();
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    allBellTriggers().forEach(function (item) { item.setAttribute('aria-expanded', item === trigger ? 'true' : 'false'); });
    positionPanel();
  }

  function togglePanel(trigger) {
    if (isOpen() && activeBell === trigger) closePanel();
    else openPanel(trigger);
  }

  function prepareTriggers() {
    const triggers = allBellTriggers();
    triggers.forEach(function (trigger) {
      trigger.dataset.vxNotificationsBound = 'delegated-v3';
      trigger.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Benachrichtigungen öffnen');
      trigger.setAttribute('aria-haspopup', 'dialog');
      if (!trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'false');
      if (trigger.tagName !== 'BUTTON' && trigger.tagName !== 'A' && !trigger.hasAttribute('tabindex')) trigger.setAttribute('tabindex', '0');
    });
    return triggers.length > 0;
  }

  function boot(attempt) {
    ensureStyles();
    ensurePanel();
    if (prepareTriggers()) return;
    if (attempt < 80) root.setTimeout(function () { boot(attempt + 1); }, 100);
  }

  root.document.addEventListener('click', function (event) {
    const trigger = findTriggerFromTarget(event.target);
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      togglePanel(trigger);
      return;
    }
    if (panel && panel.contains(event.target)) return;
    closePanel();
  });

  root.document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { closePanel(); return; }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = findTriggerFromTarget(event.target);
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    togglePanel(trigger);
  });

  root.addEventListener('resize', function () { if (isOpen()) positionPanel(); });
  root.addEventListener('scroll', function () { if (isOpen()) positionPanel(); }, true);

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', function () { boot(0); }, { once: true });
  } else {
    boot(0);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
