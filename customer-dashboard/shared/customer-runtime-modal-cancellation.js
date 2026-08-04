(function installModalAndCancellationOwner(root) {
  'use strict';
  if (!root || !root.document || root.__vxModalCancellationOwnerInstalled) return;
  root.__vxModalCancellationOwnerInstalled = true;

  function installStyles() {
    if (root.document.getElementById('vx-modal-cancellation-owner-styles')) return;
    const style = root.document.createElement('style');
    style.id = 'vx-modal-cancellation-owner-styles';
    style.textContent = `
      #vx-commercial-overlay {
        position: fixed !important;
        inset: 0 !important;
        z-index: 9800 !important;
        display: none !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 20px !important;
        background: rgba(15, 35, 71, .48) !important;
        backdrop-filter: blur(10px) !important;
      }
      #vx-commercial-overlay.open { display: flex !important; }
      #vx-commercial-overlay .vx-commercial-modal {
        position: relative !important;
        width: min(620px, 100%) !important;
        max-width: 620px !important;
        max-height: min(820px, calc(100dvh - 40px)) !important;
        margin: 0 !important;
        overflow: hidden !important;
        border-radius: 24px !important;
        background: #fff !important;
        box-shadow: 0 28px 80px rgba(15, 35, 71, .28) !important;
      }
      #vx-commercial-overlay .modal-shell {
        display: grid !important;
        grid-template-rows: auto minmax(0, 1fr) auto !important;
        max-height: inherit !important;
        overflow: hidden !important;
      }
      #vx-commercial-overlay .modal-head {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) 48px !important;
        align-items: start !important;
        gap: 16px !important;
        padding: 24px !important;
        border: 0 !important;
        background: #10213f !important;
      }
      #vx-commercial-overlay .modal-title {
        margin: 0 !important;
        color: #fff !important;
        font-size: 28px !important;
        font-weight: 760 !important;
        line-height: 1.15 !important;
        letter-spacing: -.03em !important;
      }
      #vx-commercial-overlay .modal-sub {
        margin-top: 7px !important;
        color: rgba(255,255,255,.68) !important;
        font-size: 15px !important;
        line-height: 1.45 !important;
      }
      #vx-commercial-overlay .modal-close {
        display: grid !important;
        place-items: center !important;
        width: 48px !important;
        min-width: 48px !important;
        height: 48px !important;
        min-height: 48px !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 1px solid rgba(255,255,255,.18) !important;
        border-radius: 14px !important;
        background: rgba(255,255,255,.10) !important;
        color: #fff !important;
      }
      #vx-commercial-overlay .vx-commercial-body {
        min-height: 0 !important;
        padding: 22px 24px !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
      }
      #vx-commercial-overlay .vx-commercial-actions {
        position: relative !important;
        z-index: 2 !important;
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 12px !important;
        padding: 18px 24px 22px !important;
        border-top: 1px solid #e4eaf2 !important;
        background: #fff !important;
      }
      #vx-commercial-overlay .vx-commercial-actions .modal-btn {
        width: 100% !important;
        min-height: 52px !important;
        border-radius: 14px !important;
      }
      #vx-commercial-overlay .vx-commercial-choice {
        box-sizing: border-box !important;
      }
      #vx-commercial-overlay .vx-commercial-radio {
        flex: 0 0 22px !important;
        width: 22px !important;
        min-width: 22px !important;
        height: 22px !important;
        min-height: 22px !important;
        aspect-ratio: 1 !important;
        border-radius: 50% !important;
      }

      @media (max-width: 768px) {
        #vx-commercial-overlay {
          align-items: flex-end !important;
          padding: 0 !important;
        }
        #vx-commercial-overlay .vx-commercial-modal {
          width: 100% !important;
          max-width: none !important;
          max-height: calc(100dvh - 52px) !important;
          border-radius: 24px 24px 0 0 !important;
        }
        #vx-commercial-overlay .modal-head {
          grid-template-columns: minmax(0, 1fr) 48px !important;
          padding: 22px 20px 20px !important;
        }
        #vx-commercial-overlay .modal-title {
          font-size: 24px !important;
        }
        #vx-commercial-overlay .modal-sub {
          font-size: 14px !important;
        }
        #vx-commercial-overlay .vx-commercial-body {
          padding: 18px 16px !important;
          padding-bottom: 22px !important;
        }
        #vx-commercial-overlay .vx-commercial-actions {
          grid-template-columns: 1fr !important;
          gap: 9px !important;
          padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)) !important;
        }
        #vx-commercial-overlay .modal-btn-p { order: 1 !important; }
        #vx-commercial-overlay .modal-btn-s { order: 2 !important; }
      }
    `;
    root.document.head.appendChild(style);
  }

  function moveCommercialOverlayToBody() {
    const overlay = root.document.getElementById('vx-commercial-overlay');
    if (overlay && overlay.parentElement !== root.document.body) {
      root.document.body.appendChild(overlay);
    }
  }

  function visibleContractEndLabel() {
    const labels = Array.from(root.document.querySelectorAll('#mehr-sub-abonnement, #tab-mehr')).flatMap(function(container) {
      return Array.from(container.querySelectorAll('*'));
    });
    for (const node of labels) {
      const text = String(node.textContent || '').trim();
      if (!/^(Nächste Verlängerung|Vertragsende)$/i.test(text)) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const candidates = Array.from(parent.children).filter(function(child) { return child !== node; });
      for (const candidate of candidates) {
        const value = String(candidate.textContent || '').trim();
        if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(value)) return value;
      }
    }
    return '';
  }

  function correctCancellationConfirmDate() {
    const overlay = root.document.getElementById('confirm-overlay');
    if (!overlay) return;
    const title = root.document.getElementById('confirm-title') || overlay.querySelector('.vx-modal-title, h3');
    if (!title || !/kündigung bestätigen/i.test(String(title.textContent || ''))) return;
    const correctDate = visibleContractEndLabel();
    if (!correctDate) return;

    const walker = root.document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = String(node.nodeValue || '');
      if (/Vertragsende\s*:/i.test(value) || /^\s*\d{1,2}\.\d{1,2}\.\d{4}\s*$/.test(value)) {
        if (/Vertragsende\s*:/i.test(value)) {
          node.nodeValue = value.replace(/Vertragsende\s*:\s*(\d{1,2}\.\d{1,2}\.\d{4})?/i, 'Vertragsende: ' + correctDate);
        } else if (node.parentElement && /Vertragsende/i.test(String(node.parentElement.parentElement && node.parentElement.parentElement.textContent || ''))) {
          node.nodeValue = correctDate;
        }
      }
    }
  }

  function observeDialogs() {
    const observer = new MutationObserver(function() {
      moveCommercialOverlayToBody();
      correctCancellationConfirmDate();
    });
    observer.observe(root.document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });
  }

  function boot() {
    installStyles();
    moveCommercialOverlayToBody();
    correctCancellationConfirmDate();
    observeDialogs();
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
