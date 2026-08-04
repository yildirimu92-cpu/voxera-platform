(function installCustomerNotificationsDesign(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerNotificationsDesignInstalledV2) return;
  root.__vxCustomerNotificationsDesignInstalledV2 = true;

  const doc = root.document;

  function installStyles() {
    let style = doc.getElementById('vx-customer-notifications-design');
    if (!style) {
      style = doc.createElement('style');
      style.id = 'vx-customer-notifications-design';
      doc.head.appendChild(style);
    }

    style.textContent = `
      #tab-benachrichtigungen {
        width: 100%;
        max-width: 1180px;
        margin: 0 auto;
        padding: 28px 28px 120px !important;
        box-sizing: border-box;
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
      }

      #tab-benachrichtigungen.vx-notifications-flat > * {
        box-sizing: border-box;
      }

      #tab-benachrichtigungen .vx-notifications-header {
        min-height: 112px !important;
        padding: 20px 28px !important;
        margin: 0 0 28px !important;
        border: 0 !important;
        border-radius: 24px !important;
        background: #102344 !important;
        box-shadow: none !important;
        display: flex !important;
        align-items: center !important;
        gap: 18px !important;
        overflow: hidden;
      }

      #tab-benachrichtigungen .vx-notifications-header h1,
      #tab-benachrichtigungen .vx-notifications-header h2,
      #tab-benachrichtigungen .vx-notifications-header [class*="title" i] {
        min-width: 0;
        margin: 0 !important;
        color: #fff !important;
        font-size: clamp(28px, 3vw, 40px) !important;
        line-height: 1.05 !important;
        letter-spacing: -0.035em !important;
        font-weight: 760 !important;
        white-space: nowrap;
      }

      #tab-benachrichtigungen .vx-notifications-header .vx-notifications-back {
        flex: 0 0 52px !important;
        width: 52px !important;
        height: 52px !important;
        min-width: 52px !important;
        min-height: 52px !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 16px !important;
        background: rgba(255,255,255,.10) !important;
        color: #fff !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: none !important;
      }

      #tab-benachrichtigungen .vx-notifications-header .vx-notifications-back :is(i,svg) {
        width: 24px !important;
        height: 24px !important;
        color: #fff !important;
        stroke: currentColor !important;
      }

      #tab-benachrichtigungen .vx-notifications-header .vx-notifications-read-all {
        margin-left: auto !important;
        padding: 10px 0 10px 14px !important;
        border: 0 !important;
        background: transparent !important;
        color: rgba(255,255,255,.76) !important;
        font-size: 15px !important;
        font-weight: 650 !important;
        white-space: nowrap;
        box-shadow: none !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty {
        width: 100% !important;
        max-width: 560px !important;
        min-height: 360px;
        margin: 0 auto !important;
        padding: 56px 28px !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        text-align: center !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty > * {
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty .vx-notifications-empty-icon {
        width: 72px !important;
        height: 72px !important;
        margin: 0 0 22px !important;
        padding: 0 !important;
        border-radius: 22px !important;
        background: #eaf1ff !important;
        color: #3478ed !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty .vx-notifications-empty-icon :is(i,svg),
      #tab-benachrichtigungen .vx-notifications-empty > :is(i,svg) {
        width: 34px !important;
        height: 34px !important;
        padding: 0 !important;
        color: #3478ed !important;
        stroke: currentColor !important;
        background: transparent !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty .vx-notifications-empty-title {
        margin: 0 0 10px !important;
        padding: 0 !important;
        color: #111827 !important;
        font-size: 22px !important;
        line-height: 1.25 !important;
        font-weight: 730 !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty .vx-notifications-empty-copy {
        max-width: 480px;
        margin: 0 !important;
        padding: 0 !important;
        color: #76839a !important;
        font-size: 17px !important;
        line-height: 1.55 !important;
        font-weight: 450 !important;
      }

      #tab-benachrichtigungen .notification-item,
      #tab-benachrichtigungen [class*="notification-card" i],
      #tab-benachrichtigungen [class*="notification-item" i] {
        border: 1px solid rgba(148,163,184,.22) !important;
        border-radius: 20px !important;
        background: #fff !important;
        box-shadow: 0 5px 18px rgba(15,35,71,.045) !important;
      }

      @media (max-width: 768px) {
        #tab-benachrichtigungen {
          padding: 26px 16px 116px !important;
        }

        #tab-benachrichtigungen .vx-notifications-header {
          min-height: 104px !important;
          margin-bottom: 18px !important;
          padding: 18px 18px !important;
          border-radius: 22px !important;
          gap: 14px !important;
        }

        #tab-benachrichtigungen .vx-notifications-header h1,
        #tab-benachrichtigungen .vx-notifications-header h2,
        #tab-benachrichtigungen .vx-notifications-header [class*="title" i] {
          font-size: 27px !important;
        }

        #tab-benachrichtigungen .vx-notifications-header .vx-notifications-back {
          flex-basis: 48px !important;
          width: 48px !important;
          height: 48px !important;
          min-width: 48px !important;
          min-height: 48px !important;
          border-radius: 15px !important;
        }

        #tab-benachrichtigungen .vx-notifications-header .vx-notifications-read-all {
          max-width: 92px;
          padding-left: 6px !important;
          font-size: 13px !important;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        #tab-benachrichtigungen .vx-notifications-empty {
          min-height: 330px;
          padding: 44px 18px !important;
        }

        #tab-benachrichtigungen .vx-notifications-empty .vx-notifications-empty-title {
          font-size: 20px !important;
        }

        #tab-benachrichtigungen .vx-notifications-empty .vx-notifications-empty-copy {
          font-size: 16px !important;
        }
      }
    `;
  }

  function smallestTextNode(rootNode, text) {
    const matches = Array.from(rootNode.querySelectorAll('div,section,p,span,h1,h2,h3'))
      .filter(function (node) { return String(node.textContent || '').replace(/\s+/g, ' ').trim().includes(text); });
    return matches.sort(function (a, b) { return a.querySelectorAll('*').length - b.querySelectorAll('*').length; })[0] || null;
  }

  function markStructure() {
    const page = doc.getElementById('tab-benachrichtigungen');
    if (!page) return;
    page.classList.add('vx-notifications-flat');

    const title = smallestTextNode(page, 'Benachrichtigungen');
    if (title) {
      let header = title;
      while (header.parentElement && header.parentElement !== page) {
        const text = String(header.parentElement.textContent || '').replace(/\s+/g, ' ').trim();
        if (/Benachrichtigungen/.test(text) && (/Alle gelesen|Alle lesen/.test(text) || header.parentElement.querySelector('button,a,[role="button"]'))) header = header.parentElement;
        else break;
      }
      header.classList.add('vx-notifications-header');

      const controls = Array.from(header.querySelectorAll('button,a,[role="button"],[tabindex],div'));
      controls.forEach(function (control) {
        const label = String(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent || '').replace(/\s+/g, ' ').trim();
        if (/zurück|back/i.test(label) || control.querySelector('[class*="arrow-left" i],[data-lucide*="arrow-left" i]')) control.classList.add('vx-notifications-back');
        if (/alle gelesen|alle lesen/i.test(label)) control.classList.add('vx-notifications-read-all');
      });
    }

    const emptyTitle = smallestTextNode(page, 'Keine Benachrichtigungen');
    if (emptyTitle) {
      emptyTitle.classList.add('vx-notifications-empty-title');
      let empty = emptyTitle.parentElement;
      while (empty && empty.parentElement && empty.parentElement !== page) {
        const text = String(empty.parentElement.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.includes('Keine Benachrichtigungen') && text.length < 260) empty = empty.parentElement;
        else break;
      }
      if (empty) {
        empty.classList.add('vx-notifications-empty');
        const copy = Array.from(empty.querySelectorAll('p,div,span')).find(function (node) {
          const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
          return text.includes('Lara informiert dich');
        });
        if (copy) copy.classList.add('vx-notifications-empty-copy');

        const icon = empty.querySelector('[class*="bell" i],[data-lucide*="bell" i],svg,i');
        if (icon) {
          const iconHost = icon.closest('div,span') || icon;
          iconHost.classList.add('vx-notifications-empty-icon');
        }
      }
    }
  }

  function boot() {
    installStyles();
    markStructure();
    new MutationObserver(markStructure).observe(doc.documentElement, { childList: true, subtree: true });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
