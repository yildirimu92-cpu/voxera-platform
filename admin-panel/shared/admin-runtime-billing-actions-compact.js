(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const norm = value => String(value || '').trim().toLowerCase();
  const onBilling = () => /billing/i.test(String(location.hash || '')) || /billing/i.test(String(location.pathname || ''));

  function injectStyles() {
    if (document.getElementById('vx-billing-actions-compact-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-billing-actions-compact-style';
    style.textContent = `
      .vx-billing-action-shell{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:230px}
      .vx-billing-action-primary{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .vx-billing-action-more{position:relative}
      .vx-billing-action-more>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:38px;padding:0 12px;border:1px solid var(--line,#E4E8F0);border-radius:10px;background:#fff;color:var(--ink,#1A1A2E);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.04)}
      .vx-billing-action-more>summary::-webkit-details-marker{display:none}
      .vx-billing-action-menu{position:absolute;right:0;top:44px;z-index:50;display:flex;flex-direction:column;gap:4px;min-width:190px;padding:8px;background:#fff;border:1px solid var(--line,#E4E8F0);border-radius:12px;box-shadow:0 12px 32px rgba(13,31,60,.14)}
      .vx-billing-action-menu .btn,.vx-billing-action-menu a{width:100%;justify-content:flex-start;margin:0!important;text-align:left}
      .vx-billing-action-shell .vx-inline-qr-actions{display:contents!important;margin:0!important}
      .vx-billing-action-shell .vx-inline-qr-action{margin:0!important}
      @media(max-width:760px){
        .vx-billing-action-shell{min-width:0;width:100%;align-items:stretch}
        .vx-billing-action-primary{display:grid;grid-template-columns:1fr 1fr;width:100%}
        .vx-billing-action-primary .btn,.vx-billing-action-primary a{width:100%;justify-content:center}
        .vx-billing-action-more{width:100%}
        .vx-billing-action-more>summary{width:100%}
        .vx-billing-action-menu{position:static;margin-top:6px;width:100%;box-shadow:none}
      }
    `;
    document.head.appendChild(style);
  }

  function findActionCell(row) {
    const cells = Array.from(row.children || []);
    return cells.find(cell => /öffnen|erneut senden|bezahlt|mahnen/i.test(String(cell.textContent || ''))) || null;
  }

  function buttonByText(cell, labels) {
    return Array.from(cell.querySelectorAll('button,a')).find(node => labels.includes(norm(node.textContent)));
  }

  function organiseCell(cell) {
    if (!cell || cell.dataset.vxCompactActions === 'true') return;
    const open = buttonByText(cell, ['öffnen']);
    const resend = buttonByText(cell, ['erneut senden']);
    const remind = buttonByText(cell, ['mahnen']);
    const paid = buttonByText(cell, ['bezahlt','als bezahlt']);
    const qrOpen = buttonByText(cell, ['qr öffnen','pdf öffnen']);
    const regenerate = buttonByText(cell, ['neu generieren']);
    if (!open && !resend && !remind) return;

    const shell = document.createElement('div');
    shell.className = 'vx-billing-action-shell';
    const primary = document.createElement('div');
    primary.className = 'vx-billing-action-primary';
    [open,resend,remind].filter(Boolean).forEach(node => primary.appendChild(node));
    shell.appendChild(primary);

    const secondary = [paid,qrOpen,regenerate].filter(Boolean);
    if (secondary.length) {
      const details = document.createElement('details');
      details.className = 'vx-billing-action-more';
      const summary = document.createElement('summary');
      summary.textContent = 'Mehr';
      summary.setAttribute('aria-label','Weitere Aktionen');
      const menu = document.createElement('div');
      menu.className = 'vx-billing-action-menu';
      secondary.forEach(node => menu.appendChild(node));
      details.append(summary,menu);
      shell.appendChild(details);
    }

    cell.appendChild(shell);
    cell.dataset.vxCompactActions = 'true';
  }

  function tick() {
    if (!onBilling()) return;
    injectStyles();
    Array.from(document.querySelectorAll('tr,.table-row,[role="row"]')).forEach(row => organiseCell(findActionCell(row)));
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('.vx-billing-action-more')) {
      document.querySelectorAll('.vx-billing-action-more[open]').forEach(node => node.removeAttribute('open'));
    }
    setTimeout(tick,50);
  }, true);
  w.addEventListener('hashchange', () => setTimeout(tick,80));
  setInterval(tick,700);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',tick,{once:true}); else tick();
})(typeof globalThis !== 'undefined' ? globalThis : window);
