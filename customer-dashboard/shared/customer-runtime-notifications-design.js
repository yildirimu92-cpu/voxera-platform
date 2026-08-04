(function installCustomerNotificationsDesign(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerNotificationsDesignInstalledV3) return;
  root.__vxCustomerNotificationsDesignInstalledV3 = true;

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

      #tab-benachrichtigungen .vx-notifications-header {
        min-height: 112px;
        margin: 0 0 28px;
        padding: 20px 24px;
        border-radius: 24px;
        background: #102344;
        display: flex;
        align-items: center;
        gap: 16px;
        box-sizing: border-box;
      }

      #tab-benachrichtigungen .vx-notifications-back {
        flex: 0 0 48px;
        width: 48px;
        height: 48px;
        min-width: 48px;
        min-height: 48px;
        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;
        border-radius: 15px !important;
        background: rgba(255,255,255,.11) !important;
        color: #fff !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: none !important;
      }

      #tab-benachrichtigungen .vx-notifications-back :is(i,svg) {
        width: 23px !important;
        height: 23px !important;
        color: #fff !important;
        stroke: currentColor !important;
      }

      #tab-benachrichtigungen .vx-notifications-title {
        min-width: 0;
        margin: 0;
        color: #fff;
        font-size: clamp(28px, 3vw, 40px);
        line-height: 1.05;
        letter-spacing: -0.035em;
        font-weight: 760;
        white-space: nowrap;
      }

      #tab-benachrichtigungen .vx-notifications-read-all {
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
        width: 100%;
        max-width: 560px;
        min-height: 360px;
        margin: 0 auto;
        padding: 56px 28px;
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      #tab-benachrichtigungen .vx-notifications-empty > * {
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty-icon {
        width: 72px !important;
        height: 72px !important;
        margin: 0 0 22px !important;
        border-radius: 22px !important;
        background: #eaf1ff !important;
        color: #3478ed !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty-icon :is(i,svg),
      #tab-benachrichtigungen .vx-notifications-empty > :is(i,svg) {
        width: 34px !important;
        height: 34px !important;
        color: #3478ed !important;
        stroke: currentColor !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty-title {
        margin: 0 0 10px !important;
        color: #111827 !important;
        font-size: 22px !important;
        line-height: 1.25 !important;
        font-weight: 730 !important;
      }

      #tab-benachrichtigungen .vx-notifications-empty-copy {
        max-width: 480px;
        margin: 0 !important;
        color: #76839a !important;
        font-size: 17px !important;
        line-height: 1.55 !important;
      }

      @media (max-width: 768px) {
        #tab-benachrichtigungen {
          padding: 26px 16px 116px !important;
        }

        #tab-benachrichtigungen .vx-notifications-header {
          min-height: 96px;
          margin-bottom: 18px;
          padding: 16px 18px;
          border-radius: 22px;
          gap: 14px;
        }

        #tab-benachrichtigungen .vx-notifications-back {
          flex-basis: 44px;
          width: 44px;
          height: 44px;
          min-width: 44px;
          min-height: 44px;
          border-radius: 14px !important;
        }

        #tab-benachrichtigungen .vx-notifications-title {
          font-size: 27px;
        }

        #tab-benachrichtigungen .vx-notifications-read-all {
          max-width: 84px;
          padding-left: 4px !important;
          font-size: 13px !important;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        #tab-benachrichtigungen .vx-notifications-empty {
          min-height: 330px;
          padding: 44px 18px;
        }
      }
    `;
  }

  function textOf(node) {
    return String(node && node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function findBack(page) {
    return Array.from(page.querySelectorAll('button,a,[role="button"],[tabindex],div,span')).find(function (node) {
      const label = String(node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title')) || '') + ' ' + textOf(node);
      return /zurück|back/i.test(label) || !!(node.querySelector && node.querySelector('[class*="arrow-left" i],[data-lucide*="arrow-left" i]'));
    }) || null;
  }

  function findReadAll(page) {
    return Array.from(page.querySelectorAll('button,a,[role="button"],[tabindex],div,span')).find(function (node) {
      return /alle gelesen|alle lesen/i.test(textOf(node));
    }) || null;
  }

  function findExistingTitle(page) {
    return Array.from(page.querySelectorAll('h1,h2,h3,div,span')).find(function (node) {
      return textOf(node) === 'Benachrichtigungen';
    }) || null;
  }

  function buildHeader(page) {
    let header = page.querySelector(':scope > .vx-notifications-header');
    if (!header) {
      header = doc.createElement('div');
      header.className = 'vx-notifications-header';
      page.insertBefore(header, page.firstChild);
    }

    const back = findBack(page);
    if (back && back !== header && !header.contains(back)) {
      back.classList.add('vx-notifications-back');
      header.appendChild(back);
    }

    let title = header.querySelector('.vx-notifications-title');
    if (!title) {
      const existingTitle = findExistingTitle(page);
      title = existingTitle || doc.createElement('h1');
      title.textContent = 'Benachrichtigungen';
      title.classList.add('vx-notifications-title');
      header.appendChild(title);
    }

    const readAll = findReadAll(page);
    if (readAll && readAll !== header && !header.contains(readAll)) {
      readAll.classList.add('vx-notifications-read-all');
      header.appendChild(readAll);
    }
  }

  function markEmpty(page) {
    const emptyTitle = Array.from(page.querySelectorAll('h1,h2,h3,p,div,span')).find(function (node) {
      return textOf(node) === 'Keine Benachrichtigungen';
    });
    if (!emptyTitle) return;

    emptyTitle.classList.add('vx-notifications-empty-title');
    let empty = emptyTitle.parentElement;
    while (empty && empty.parentElement && empty.parentElement !== page) {
      const text = textOf(empty.parentElement);
      if (text.includes('Keine Benachrichtigungen') && text.length < 260) empty = empty.parentElement;
      else break;
    }
    if (!empty) return;

    empty.classList.add('vx-notifications-empty');
    const copy = Array.from(empty.querySelectorAll('p,div,span')).find(function (node) {
      return textOf(node).includes('Lara informiert dich');
    });
    if (copy) copy.classList.add('vx-notifications-empty-copy');

    const icon = empty.querySelector('[class*="bell" i],[data-lucide*="bell" i],svg,i');
    if (icon) (icon.closest('div,span') || icon).classList.add('vx-notifications-empty-icon');
  }

  function apply() {
    const page = doc.getElementById('tab-benachrichtigungen');
    if (!page) return;
    buildHeader(page);
    markEmpty(page);
  }

  function boot() {
    installStyles();
    apply();
    new MutationObserver(apply).observe(doc.documentElement, { childList: true, subtree: true });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
