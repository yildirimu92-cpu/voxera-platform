(function installCancellationContractOwner(root) {
  'use strict';
  if (!root || !root.document || root.__vxCancellationContractOwnerInstalled) return;
  root.__vxCancellationContractOwnerInstalled = true;

  function swissDate(value) {
    const match = String(value || '').match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
    return match ? match[1].padStart(2, '0') + '.' + match[2].padStart(2, '0') + '.' + match[3] : '';
  }

  function ownText(node) {
    if (!node) return '';
    return Array.from(node.childNodes || [])
      .filter(function(child) { return child.nodeType === Node.TEXT_NODE; })
      .map(function(child) { return child.nodeValue || ''; })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function contractEndDate() {
    const containers = [
      root.document.getElementById('mehr-sub-abonnement'),
      root.document.querySelector('.vx-abo-details'),
      root.document.querySelector('.vx-abo-contract-card'),
      root.document.body
    ].filter(Boolean);

    for (const container of containers) {
      const nodes = Array.from(container.querySelectorAll('*'));
      for (const label of ['Nächste Verlängerung', 'Vertragsende']) {
        for (const node of nodes) {
          const text = (ownText(node) || String(node.textContent || '').trim()).toLowerCase();
          if (text !== label.toLowerCase()) continue;
          const parent = node.parentElement;
          if (!parent) continue;
          const siblings = Array.from(parent.children).filter(function(child) { return child !== node; });
          for (const sibling of siblings) {
            const date = swissDate(sibling.textContent);
            if (date) return date;
          }
          const date = swissDate(parent.textContent);
          if (date) return date;
        }
      }
    }
    return '';
  }

  function isCancellationDialog(overlay) {
    if (!overlay) return false;
    return /kündigung bestätigen/i.test(String(overlay.textContent || ''));
  }

  function replaceContractEndRow(overlay, date) {
    const elements = Array.from(overlay.querySelectorAll('*'));
    for (const element of elements) {
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^Vertragsende\s*:/i.test(text)) continue;

      const dateNode = Array.from(element.querySelectorAll('*')).find(function(child) {
        return /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(String(child.textContent || '').trim());
      });
      if (dateNode) {
        dateNode.textContent = date;
      } else {
        element.innerHTML = 'Vertragsende: <strong>' + date + '</strong>';
      }
      return true;
    }
    return false;
  }

  function replaceWarning(overlay, date) {
    const elements = Array.from(overlay.querySelectorAll('div,p,span'));
    const target = elements.find(function(element) {
      return /Nach Ablauf der Kündigungsfrist wird Ihr Zugang deaktiviert/i.test(String(element.textContent || ''));
    });
    if (!target) return false;
    target.textContent = 'Ihr Vertrag bleibt bis zum ' + date + ' aktiv und endet anschliessend automatisch.';
    return true;
  }

  function ensureNotice(overlay, date) {
    if (overlay.querySelector('[data-vx-contract-cancellation-note="1"]')) return;
    const body = overlay.querySelector('.vx-modal-body,.modal-body,[data-confirm-body]')
      || Array.from(overlay.children).find(function(child) { return child.querySelector && child.querySelector('button'); })
      || overlay;
    const note = root.document.createElement('div');
    note.dataset.vxContractCancellationNote = '1';
    note.className = 'vx-cancellation-term-note';
    note.textContent = 'Die Kündigungsfrist beträgt 1 Monat vor Vertragsende. Ihr Zugang bleibt bis zum ' + date + ' vollständig aktiv.';
    const footer = body.querySelector('.vx-modal-footer,.modal-footer');
    if (footer && footer.parentElement === body) body.insertBefore(note, footer);
    else body.appendChild(note);
  }

  function repairDialog() {
    const overlay = root.document.getElementById('confirm-overlay');
    if (!isCancellationDialog(overlay)) return;
    const date = contractEndDate();
    if (!date) return;
    replaceContractEndRow(overlay, date);
    replaceWarning(overlay, date);
    ensureNotice(overlay, date);
    overlay.dataset.vxContractEnd = date;
  }

  function repairNoticeLabel() {
    const nodes = Array.from(root.document.querySelectorAll('*'));
    for (const node of nodes) {
      if (String(node.textContent || '').trim().toLowerCase() !== 'kündigungsfrist') continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const valueNode = Array.from(parent.children).find(function(child) {
        return child !== node && /^\d+\s*(monat|monate|tag|tage|woche|wochen)$/i.test(String(child.textContent || '').trim());
      });
      if (valueNode) valueNode.textContent = String(valueNode.textContent || '').trim() + ' vor Vertragsende';
    }
  }

  function repairStatus() {
    const date = contractEndDate();
    if (!date) return;
    const nodes = Array.from(root.document.querySelectorAll('*'));
    for (const node of nodes) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Kündigung eingereicht per\s+\d{1,2}\.\d{1,2}\.\d{4}$/i.test(text)) {
        node.textContent = 'Kündigung vorgemerkt · Vertragsende ' + date;
      }
    }
  }

  function repair() {
    repairNoticeLabel();
    repairDialog();
    repairStatus();
  }

  let queued = false;
  const observer = new MutationObserver(function() {
    if (queued) return;
    queued = true;
    root.requestAnimationFrame(function() {
      queued = false;
      repair();
    });
  });

  function boot() {
    repair();
    observer.observe(root.document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });
    root.setTimeout(repair, 150);
    root.setTimeout(repair, 500);
  }

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
