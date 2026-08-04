(function installCommercialModalLayout(root) {
  'use strict';
  if (!root || !root.document || root.__vxCommercialModalLayoutInstalled) return;
  root.__vxCommercialModalLayoutInstalled = true;

  const OVERLAY_SELECTORS = [
    '#vx-commercial-overlay',
    '#vx-upgrade-overlay',
    '#vx-minutes-overlay',
    '#upgrade-overlay',
    '#minutes-overlay',
    '#confirm-overlay'
  ];

  function ensureStyles() {
    if (root.document.getElementById('vx-commercial-modal-layout')) return;
    const style = root.document.createElement('style');
    style.id = 'vx-commercial-modal-layout';
    style.textContent = `
      @media (max-width: 768px) {
        body.vx-commercial-dialog-open {
          overflow: hidden !important;
          touch-action: none;
        }

        ${OVERLAY_SELECTORS.join(',\n        ')} {
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100dvh !important;
          max-width: none !important;
          max-height: none !important;
          margin: 0 !important;
          padding: max(16px, env(safe-area-inset-top, 0px)) 16px calc(104px + env(safe-area-inset-bottom, 0px)) !important;
          box-sizing: border-box !important;
          align-items: center !important;
          justify-content: center !important;
          overflow: auto !important;
          overscroll-behavior: contain;
          background: rgba(15, 35, 71, 0.48) !important;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          z-index: 4000 !important;
        }

        ${OVERLAY_SELECTORS.map((selector) => `${selector} > *`).join(',\n        ')} {
          position: relative !important;
          inset: auto !important;
          transform: none !important;
          width: min(100%, 560px) !important;
          max-width: 560px !important;
          max-height: calc(100dvh - 140px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) !important;
          margin: auto !important;
          overflow: auto !important;
          overscroll-behavior: contain;
          border-radius: 24px !important;
          background: #ffffff !important;
          box-shadow: 0 24px 64px rgba(15, 35, 71, 0.24) !important;
          color: #0f2347 !important;
        }

        ${OVERLAY_SELECTORS.map((selector) => `${selector} button[aria-label*="schliess" i], ${selector} button[aria-label*="close" i], ${selector} .modal-close, ${selector} .vx-modal-close, ${selector} .close`).join(',\n        ')} {
          position: absolute !important;
          top: 14px !important;
          right: 14px !important;
          width: 44px !important;
          height: 44px !important;
          min-width: 44px !important;
          min-height: 44px !important;
          padding: 0 !important;
          margin: 0 !important;
          border-radius: 999px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          z-index: 2 !important;
        }

        [data-vx-mobile-navigation="1"] {
          z-index: 1200 !important;
        }
      }
    `;
    root.document.head.appendChild(style);
  }

  function isOpen(node) {
    if (!node) return false;
    const style = root.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    return node.classList.contains('open') || node.getAttribute('aria-hidden') === 'false' || node.style.display === 'flex';
  }

  function normalize() {
    let anyOpen = false;
    OVERLAY_SELECTORS.forEach(function (selector) {
      const node = root.document.querySelector(selector);
      if (!node) return;
      if (node.parentElement !== root.document.body) root.document.body.appendChild(node);
      const open = isOpen(node);
      node.style.pointerEvents = open ? 'auto' : 'none';
      if (open) anyOpen = true;
    });
    root.document.body.classList.toggle('vx-commercial-dialog-open', anyOpen);
  }

  function boot() {
    ensureStyles();
    normalize();
    const observer = new MutationObserver(normalize);
    observer.observe(root.document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });
    root.document.addEventListener('click', function () {
      root.setTimeout(normalize, 0);
      root.setTimeout(normalize, 200);
    }, true);
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
