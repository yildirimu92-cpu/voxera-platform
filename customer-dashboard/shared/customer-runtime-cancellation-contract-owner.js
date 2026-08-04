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

  function isFinalCancellationDialog(overlay) {
    if (!overlay) return false;
    const text = String(overlay.textContent || '').replace(/\s+/g, ' ');
    return /Kündigung bestätigen/i.test(text) && /Vertragsende\s*:/i.test(text);
  }

  function replaceContractEndRow(overlay, date) {
    const elements = Array.from(overlay.querySelectorAll('*'));
    for (const element of elements) {
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^Vertragsende\s*:/i.test(text)) continue;
      const dateNode = Array.from(element.querySelectorAll('*')).find(function(child) {
        return /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(String(child.textContent || '').trim());
      });
      if (dateNode) dateNode.textContent = date;
      else element.innerHTML = 'Vertragsende: <strong>' + date + '</strong>';
      return true;
    }
    return false;
  }

  function findExactLegacyWarning(overlay) {
    return Array.from(overlay.querySelectorAll('div,p,span')).find(function(element) {
      if (element.children.length > 0) return false;
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      return /^Nach Ablauf der Kündigungsfrist wird Ihr Zugang deaktiviert\.?$/i.test(text)
        || /^Ihr Vertrag bleibt bis zum \d{1,2}\.\d{1,2}\.\d{4} aktiv und endet anschliessend automatisch\.?$/i.test(text);
    }) || null;
  }

  function ensureSingleNotice(overlay, date) {
    if (!isFinalCancellationDialog(overlay)) return;

    Array.from(overlay.querySelectorAll('[data-vx-contract-cancellation-note="1"]')).forEach(function(node) {
      node.remove();
    });

    const oldWarning = findExactLegacyWarning(overlay);
    const host = oldWarning && oldWarning.parentElement
      ? oldWarning.parentElement
      : overlay.querySelector('.vx-modal-body,.modal-body,[data-confirm-body]');
    if (!host) return;

    const note = root.document.createElement('div');
    note.dataset.vxContractCancellationNote = '1';
    note.className = 'vx-cancellation-term-note';
    note.innerHTML = '<strong>Hinweis</strong><span>Ihr Vertrag bleibt bis zum <b>' + date + '</b> aktiv. Die Kündigung wird auf dieses Datum vorgemerkt; die Kündigungsfrist beträgt 1 Monat vor Vertragsende.</span>';
    Object.assign(note.style, {
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: '6px',
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box',
      margin: '16px 0 0',
      padding: '14px 16px',
      border: '1px solid #d8e1ec',
      borderRadius: '14px',
      background: '#f6f8fb',
      color: '#475569',
      fontSize: '14px',
      lineHeight: '1.5'
    });

    if (oldWarning && oldWarning.parentElement) oldWarning.replaceWith(note);
    else {
      const footer = host.querySelector('.vx-modal-footer,.modal-footer');
      if (footer && footer.parentElement === host) host.insertBefore(note, footer);
      else host.appendChild(note);
    }
  }

  function repairDialog() {
    const overlay = root.document.getElementById('confirm-overlay');
    if (!isFinalCancellationDialog(overlay)) return;
    const date = contractEndDate();
    if (!date) return;
    replaceContractEndRow(overlay, date);
    ensureSingleNotice(overlay, date);
    overlay.dataset.vxContractEnd = date;
  }

  function repairWithdrawDialog() {
    const overlay = root.document.getElementById('confirm-overlay');
    if (!overlay) return;
    const text = String(overlay.textContent || '').replace(/\s+/g, ' ');
    if (!/Kündigung wirklich zurückziehen/i.test(text)) return;

    const target = Array.from(overlay.querySelectorAll('p,div,span')).find(function(node) {
      return node.children.length === 0 && /^Sind Sie sicher\??$/i.test(String(node.textContent || '').trim());
    });
    if (target) {
      target.textContent = 'Ihre vorgemerkte Kündigung wird entfernt. Ihr Vertrag läuft unverändert weiter und verlängert sich gemäss den Vertragsbedingungen automatisch.';
    }

    Array.from(overlay.querySelectorAll('[data-vx-contract-cancellation-note="1"]')).forEach(function(node) {
      node.remove();
    });
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
      if (node.children.length > 0) continue;
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Kündigung eingereicht per\s+\d{1,2}\.\d{1,2}\.\d{4}$/i.test(text)
        || /^Kündigung bereits eingereicht$/i.test(text)) {
        node.textContent = 'Kündigung vorgemerkt · Vertragsende ' + date;
      }
    }
  }

  function repair() {
    repairNoticeLabel();
    repairDialog();
    repairWithdrawDialog();
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
