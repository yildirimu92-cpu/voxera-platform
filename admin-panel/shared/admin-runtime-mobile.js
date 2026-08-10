(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete'
    ? setTimeout(fn, 0)
    : w.addEventListener('load', fn, { once: true });

  // Das Aussehen steht seit Welle 2 in shared/admin-responsive.css. Hier bleibt
  // das Setzen der data-label-Attribute, aus denen die Kartenansicht ihre
  // Beschriftungen zieht. → Welle 5 bringt sie ins Markup.


  function labelTable(table) {
    if (!table || table.dataset.mobilePrepared === '1') return;
    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!headers.length) return;
    table.classList.add('vox-mobile-table');
    table.dataset.mobilePrepared = '1';
    [...table.querySelectorAll('tbody tr')].forEach(row => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName !== 'TD') return;
        cell.dataset.mobileLabel = cell.colSpan > 1 ? '' : (headers[index] || '');
      });
    });
  }

  function prepareTables(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('table').forEach(labelTable);
    if (scope.matches?.('table')) labelTable(scope);
  }

  function refreshDynamicRows(root) {
    const table = root?.closest?.('table') || (root?.matches?.('table') ? root : null);
    if (!table) return;
    delete table.dataset.mobilePrepared;
    [...table.querySelectorAll('tbody td')].forEach(cell => delete cell.dataset.mobileLabel);
    labelTable(table);
  }

  ready(() => {
    prepareTables(document);

    let timer = null;
    const observer = new MutationObserver(records => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        records.forEach(record => {
          record.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            prepareTables(node);
            refreshDynamicRows(node);
          });
          if (record.target?.nodeType === 1) refreshDynamicRows(record.target);
        });
        prepareTables(document);
      }, 30);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    w.addEventListener('resize', () => {
      if (w.innerWidth <= 768) prepareTables(document);
    }, { passive: true });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
