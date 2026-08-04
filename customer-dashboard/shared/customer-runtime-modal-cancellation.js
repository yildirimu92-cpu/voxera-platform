(function installModalAndCancellationOwner(root) {
  'use strict';
  if (!root || !root.document || root.__vxModalCancellationOwnerInstalled) return;
  root.__vxModalCancellationOwnerInstalled = true;

  function installStyles() {
    if (root.document.getElementById('vx-modal-cancellation-owner-styles')) return;
    const style = root.document.createElement('style');
    style.id = 'vx-modal-cancellation-owner-styles';
    style.textContent = `
      #vx-commercial-overlay{position:fixed!important;inset:0!important;z-index:9800!important;display:none!important;align-items:center!important;justify-content:center!important;padding:20px!important;background:rgba(15,35,71,.48)!important;backdrop-filter:blur(10px)!important}
      #vx-commercial-overlay.open{display:flex!important}
      #vx-commercial-overlay .vx-commercial-modal{position:relative!important;width:min(620px,100%)!important;max-width:620px!important;max-height:min(820px,calc(100dvh - 40px))!important;margin:0!important;overflow:hidden!important;border-radius:24px!important;background:#fff!important;box-shadow:0 28px 80px rgba(15,35,71,.28)!important}
      #vx-commercial-overlay .modal-shell{display:grid!important;grid-template-rows:auto minmax(0,1fr) auto!important;max-height:inherit!important;overflow:hidden!important}
      #vx-commercial-overlay .modal-head{display:grid!important;grid-template-columns:minmax(0,1fr) 48px!important;align-items:start!important;gap:16px!important;padding:24px!important;border:0!important;background:#10213f!important}
      #vx-commercial-overlay .modal-title{margin:0!important;color:#fff!important;font-size:28px!important;font-weight:760!important;line-height:1.15!important;letter-spacing:-.03em!important}
      #vx-commercial-overlay .modal-sub{margin-top:7px!important;color:rgba(255,255,255,.68)!important;font-size:15px!important;line-height:1.45!important}
      #vx-commercial-overlay .modal-close{display:grid!important;place-items:center!important;width:48px!important;min-width:48px!important;height:48px!important;min-height:48px!important;margin:0!important;padding:0!important;border:1px solid rgba(255,255,255,.18)!important;border-radius:14px!important;background:rgba(255,255,255,.10)!important;color:#fff!important}
      #vx-commercial-overlay .vx-commercial-body{min-height:0!important;padding:22px 24px!important;overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important}
      #vx-commercial-overlay .vx-commercial-actions{position:relative!important;z-index:2!important;display:grid!important;grid-template-columns:1fr 1fr!important;gap:12px!important;padding:18px 24px 22px!important;border-top:1px solid #e4eaf2!important;background:#fff!important}
      #vx-commercial-overlay .vx-commercial-actions .modal-btn{width:100%!important;min-height:52px!important;border-radius:14px!important}
      #vx-commercial-overlay .vx-commercial-choice{box-sizing:border-box!important}
      #vx-commercial-overlay .vx-commercial-radio{flex:0 0 22px!important;width:22px!important;min-width:22px!important;height:22px!important;min-height:22px!important;aspect-ratio:1!important;border-radius:50%!important}
      .vx-cancellation-term-note{margin-top:12px;padding:14px 16px;border:1px solid #d8e1ec;border-radius:14px;background:#f6f8fb;color:#475569;font-size:14px;line-height:1.5}
      @media(max-width:768px){
        #vx-commercial-overlay{align-items:flex-end!important;padding:0!important}
        #vx-commercial-overlay .vx-commercial-modal{width:100%!important;max-width:none!important;max-height:calc(100dvh - 52px)!important;border-radius:24px 24px 0 0!important}
        #vx-commercial-overlay .modal-head{grid-template-columns:minmax(0,1fr) 48px!important;padding:22px 20px 20px!important}
        #vx-commercial-overlay .modal-title{font-size:24px!important}
        #vx-commercial-overlay .modal-sub{font-size:14px!important}
        #vx-commercial-overlay .vx-commercial-body{padding:18px 16px 22px!important}
        #vx-commercial-overlay .vx-commercial-actions{grid-template-columns:1fr!important;gap:9px!important;padding:14px 16px calc(16px + env(safe-area-inset-bottom,0px))!important}
        #vx-commercial-overlay .modal-btn-p{order:1!important}
        #vx-commercial-overlay .modal-btn-s{order:2!important}
      }
    `;
    root.document.head.appendChild(style);
  }

  function moveCommercialOverlayToBody() {
    const overlay = root.document.getElementById('vx-commercial-overlay');
    if (overlay && overlay.parentElement !== root.document.body) root.document.body.appendChild(overlay);
  }

  function parseSwissDate(text) {
    const match = String(text || '').match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
    return match ? match[1].padStart(2, '0') + '.' + match[2].padStart(2, '0') + '.' + match[3] : '';
  }

  function visibleContractEndLabel() {
    const all = Array.from(root.document.querySelectorAll('body *'));
    const priorityLabels = ['Nächste Verlängerung', 'Vertragsende'];
    for (const expected of priorityLabels) {
      for (const node of all) {
        const ownText = String(node.childNodes.length === 1 ? node.textContent : '').trim();
        if (ownText.toLowerCase() !== expected.toLowerCase()) continue;
        const parent = node.parentElement;
        if (!parent) continue;
        const date = parseSwissDate(parent.textContent);
        if (date) return date;
        const next = node.nextElementSibling;
        const nextDate = parseSwissDate(next && next.textContent);
        if (nextDate) return nextDate;
      }
    }
    return '';
  }

  function replaceTextNode(rootNode, pattern, replacement) {
    if (!rootNode) return false;
    const walker = root.document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    let changed = false;
    let node;
    while ((node = walker.nextNode())) {
      if (!pattern.test(String(node.nodeValue || ''))) continue;
      node.nodeValue = String(node.nodeValue || '').replace(pattern, replacement);
      changed = true;
    }
    return changed;
  }

  function correctCancellationNoticeLabel() {
    const all = Array.from(root.document.querySelectorAll('body *'));
    for (const node of all) {
      if (String(node.textContent || '').trim().toLowerCase() !== 'kündigungsfrist') continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const children = Array.from(parent.children).filter(function(child) { return child !== node; });
      for (const child of children) {
        const text = String(child.textContent || '').trim();
        if (!text || /vor vertragsende/i.test(text)) continue;
        if (/^(\d+\s*(monat|monate|tag|tage|woche|wochen))$/i.test(text)) {
          child.textContent = text + ' vor Vertragsende';
          return;
        }
      }
    }
  }

  function correctCancellationConfirmDate() {
    const overlay = root.document.getElementById('confirm-overlay');
    if (!overlay) return;
    const title = root.document.getElementById('confirm-title') || overlay.querySelector('.vx-modal-title,h3');
    if (!title || !/kündigung bestätigen/i.test(String(title.textContent || ''))) return;
    const correctDate = visibleContractEndLabel();
    if (!correctDate) return;

    replaceTextNode(overlay, /Vertragsende\s*:\s*\d{1,2}\.\d{1,2}\.\d{4}/i, 'Vertragsende: ' + correctDate);
    replaceTextNode(overlay, /Nach Ablauf der Kündigungsfrist wird Ihr Zugang deaktiviert\.?/i, 'Ihr Vertrag bleibt bis zum ' + correctDate + ' aktiv und endet anschliessend automatisch.');

    const content = overlay.querySelector('.vx-modal-body,.modal-body,[data-confirm-body]') || title.parentElement && title.parentElement.parentElement;
    if (content && !content.querySelector('.vx-cancellation-term-note')) {
      const note = root.document.createElement('div');
      note.className = 'vx-cancellation-term-note';
      note.textContent = 'Die Kündigungsfrist beträgt einen Monat vor Vertragsende. Ihr Zugang bleibt bis zum ' + correctDate + ' vollständig aktiv.';
      content.appendChild(note);
    }
  }

  function correctCancellationStatusCard() {
    const correctDate = visibleContractEndLabel();
    if (!correctDate) return;
    const all = Array.from(root.document.querySelectorAll('body *'));
    for (const node of all) {
      const text = String(node.textContent || '').trim();
      if (!/^Kündigung eingereicht per\s+\d{1,2}\.\d{1,2}\.\d{4}$/i.test(text)) continue;
      node.textContent = 'Kündigung vorgemerkt · Vertragsende ' + correctDate;
      node.setAttribute('aria-label', 'Kündigung vorgemerkt. Vertragsende ' + correctDate);
    }
  }

  function correctCancellationActionLabel() {
    const candidates = Array.from(root.document.querySelectorAll('button,a'));
    const hasCancellation = candidates.some(function(node) {
      return /kündigung zurückziehen/i.test(String(node.textContent || ''));
    }) || Array.from(root.document.querySelectorAll('body *')).some(function(node) {
      return /kündigung vorgemerkt|kündigung eingereicht per/i.test(String(node.textContent || ''));
    });
    if (!hasCancellation) return;
    for (const node of candidates) {
      if (/^kündigen$|kündigung einreichen/i.test(String(node.textContent || '').trim())) node.textContent = 'Kündigung verwalten';
    }
  }

  function repairCancellationUi() {
    correctCancellationNoticeLabel();
    correctCancellationConfirmDate();
    correctCancellationStatusCard();
    correctCancellationActionLabel();
  }

  function observeDialogs() {
    let scheduled = false;
    const observer = new MutationObserver(function() {
      if (scheduled) return;
      scheduled = true;
      root.requestAnimationFrame(function() {
        scheduled = false;
        moveCommercialOverlayToBody();
        repairCancellationUi();
      });
    });
    observer.observe(root.document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['class','style','aria-hidden'] });
  }

  function boot() {
    installStyles();
    moveCommercialOverlayToBody();
    repairCancellationUi();
    observeDialogs();
  }

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
