(function installCustomerNotificationsDesign(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerNotificationsDesignInstalled) return;
  root.__vxCustomerNotificationsDesignInstalled = true;

  const doc = root.document;

  function installStyles() {
    if (doc.getElementById('vx-customer-notifications-design')) return;
    const style = doc.createElement('style');
    style.id = 'vx-customer-notifications-design';
    style.textContent = `
      #tab-benachrichtigungen {
        box-sizing: border-box;
        width: 100%;
        max-width: 1180px;
        margin: 0 auto;
        padding: 28px 28px 120px;
      }

      #tab-benachrichtigungen > :first-child {
        border-radius: 24px !important;
        min-height: 112px;
        padding: 22px 28px !important;
        box-sizing: border-box;
        box-shadow: none !important;
      }

      #tab-benachrichtigungen > :first-child h1,
      #tab-benachrichtigungen > :first-child h2,
      #tab-benachrichtigungen > :first-child [class*="title" i] {
        font-size: clamp(26px, 3vw, 38px) !important;
        line-height: 1.08 !important;
        letter-spacing: -0.03em !important;
        font-weight: 750 !important;
      }

      #tab-benachrichtigungen > :first-child button,
      #tab-benachrichtigungen > :first-child [role="button"] {
        border-radius: 16px !important;
      }

      #tab-benachrichtigungen > :not(:first-child) {
        box-sizing: border-box;
      }

      #tab-benachrichtigungen .notification-empty,
      #tab-benachrichtigungen [class*="empty" i],
      #tab-benachrichtigungen [data-empty-state] {
        max-width: 720px;
        margin: 28px auto 0 !important;
        padding: 52px 32px !important;
        border: 1px solid rgba(148, 163, 184, .22) !important;
        border-radius: 24px !important;
        background: #fff !important;
        box-shadow: 0 8px 24px rgba(15, 35, 71, .05) !important;
      }

      #tab-benachrichtigungen .notification-empty :is(i, svg),
      #tab-benachrichtigungen [class*="empty" i] :is(i, svg),
      #tab-benachrichtigungen [data-empty-state] :is(i, svg) {
        width: 34px !important;
        height: 34px !important;
        padding: 15px;
        border-radius: 18px;
        background: #eef4ff;
        color: #3478ed !important;
        box-sizing: content-box;
      }

      #tab-benachrichtigungen .notification-item,
      #tab-benachrichtigungen [class*="notification-card" i],
      #tab-benachrichtigungen [class*="notification-item" i] {
        border: 1px solid rgba(148, 163, 184, .22) !important;
        border-radius: 20px !important;
        background: #fff !important;
        box-shadow: 0 5px 18px rgba(15, 35, 71, .045) !important;
      }

      @media (max-width: 768px) {
        #tab-benachrichtigungen {
          padding: 26px 16px 116px !important;
        }

        #tab-benachrichtigungen > :first-child {
          min-height: 104px;
          padding: 20px 18px !important;
          border-radius: 22px !important;
        }

        #tab-benachrichtigungen > :first-child h1,
        #tab-benachrichtigungen > :first-child h2,
        #tab-benachrichtigungen > :first-child [class*="title" i] {
          font-size: 28px !important;
        }

        #tab-benachrichtigungen .notification-empty,
        #tab-benachrichtigungen [class*="empty" i],
        #tab-benachrichtigungen [data-empty-state] {
          margin-top: 18px !important;
          padding: 40px 22px !important;
          border-radius: 22px !important;
        }
      }
    `;
    doc.head.appendChild(style);
  }

  function markEmptyState() {
    const page = doc.getElementById('tab-benachrichtigungen');
    if (!page) return;
    Array.from(page.querySelectorAll('div,section')).forEach(function (node) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.includes('Keine Benachrichtigungen') && text.length < 220) {
        node.classList.add('notification-empty');
      }
    });
  }

  function boot() {
    installStyles();
    markEmptyState();
    new MutationObserver(markEmptyState).observe(doc.documentElement, { childList: true, subtree: true });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
