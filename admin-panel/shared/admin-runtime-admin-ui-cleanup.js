(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const isBilling = () => /billing/i.test(String(location.hash || '')) || /billing/i.test(String(location.pathname || ''));
  const isCustomers = () => /customers|kunden/i.test(String(location.hash || '')) || /customers|kunden/i.test(String(location.pathname || ''));

  function injectStyles() {
    if (document.getElementById('vx-admin-ui-cleanup-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-admin-ui-cleanup-style';
    style.textContent = `
      .vx-customer-list-title{color:var(--ink,#1A1A2E)!important;background:transparent!important;text-shadow:none!important;font-size:16px!important;font-weight:750!important;letter-spacing:-.02em!important}
      .vx-subscription-search-toolbar{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;margin:0 0 14px;background:#fff;border:1px solid var(--line,#E4E8F0);border-radius:12px}
      .vx-subscription-search-toolbar:before{content:'Subscription suchen';font-size:12px;font-weight:700;color:var(--slate,#7A8599);white-space:nowrap}
      .vx-subscription-search-toolbar input{width:min(420px,100%)!important;min-width:240px;margin:0!important}
      .vx-admin-manual-fallback{margin-top:12px;border:1px solid var(--line,#E4E8F0);border-radius:12px;background:#fff;overflow:hidden}
      .vx-admin-manual-fallback>summary{cursor:pointer;list-style:none;padding:14px 16px;font-weight:700;color:var(--ink,#1A1A2E);background:#F8FAFC}
      .vx-admin-manual-fallback>summary::-webkit-details-marker{display:none}
      .vx-admin-manual-fallback>summary:after{content:'Nur verwenden, wenn die automatische Prüfung nicht möglich ist.';display:block;margin-top:3px;font-size:12px;font-weight:400;color:var(--slate,#7A8599)}
      .vx-admin-manual-fallback>.vx-admin-manual-content{padding:0}
      @media(max-width:760px){
        .vx-subscription-search-toolbar{align-items:stretch;flex-direction:column}
        .vx-subscription-search-toolbar input{width:100%!important;min-width:0}
      }
    `;
    document.head.appendChild(style);
  }

  function exactTextNodes(label) {
    return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,strong,span,div,p,button,a'))
      .filter(node => norm(node.textContent) === norm(label));
  }

  function fixCustomerListTitle() {
    if (!isCustomers()) return;
    exactTextNodes('Kundenliste').forEach(node => node.classList.add('vx-customer-list-title'));
  }

  function findBillingTabs() {
    return Array.from(document.querySelectorAll('button,a,[role="tab"]'))
      .filter(node => ['aufgaben','alle rechnungen','subscriptions','überzug'].includes(norm(node.textContent)));
  }

  function openAllInvoicesTab() {
    const tab = findBillingTabs().find(node => norm(node.textContent) === 'alle rechnungen');
    if (tab) {
      tab.click();
      tab.scrollIntoView({ block:'nearest', inline:'nearest' });
      return true;
    }
    return false;
  }

  function fixAllInvoicesButtons() {
    if (!isBilling()) return;
    Array.from(document.querySelectorAll('button,a')).forEach(node => {
      if (norm(node.textContent) !== 'alle rechnungen anzeigen' || node.dataset.vxAllInvoicesFixed === 'true') return;
      node.dataset.vxAllInvoicesFixed = 'true';
      node.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openAllInvoicesTab();
      }, true);
    });
  }

  function fixSubscriptionSearch() {
    if (!isBilling()) return;
    const activeSubscriptionTab = findBillingTabs().some(node => norm(node.textContent) === 'subscriptions' && (node.classList.contains('active') || node.classList.contains('is-active') || node.getAttribute('aria-selected') === 'true'));
    if (!activeSubscriptionTab) return;
    const input = Array.from(document.querySelectorAll('input')).find(node => /kunde suchen/i.test(node.placeholder || ''));
    if (!input || input.closest('.vx-subscription-search-toolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'vx-subscription-search-toolbar';
    input.parentNode.insertBefore(toolbar, input);
    toolbar.appendChild(input);
  }

  function fixBillingActionMenus() {
    if (!isBilling()) return;
    Array.from(document.querySelectorAll('tr,.table-row,[role="row"]')).forEach(row => {
      if (!/VX-\d{4}-\d{6}/.test(String(row.textContent || ''))) return;
      const cell = Array.from(row.children || []).find(child => /öffnen|erneut senden|mahnen|mehr/i.test(String(child.textContent || '')));
      if (!cell) return;
      const details = cell.querySelector('details.vx-billing-action-more');
      const menu = details?.querySelector('.vx-billing-action-menu');
      if (!details || !menu) return;

      // QR/PDF actions are mounted asynchronously by another runtime. Keep them
      // inside the same secondary menu instead of showing a second button row.
      Array.from(cell.querySelectorAll('.vx-inline-qr-action')).forEach(action => {
        if (!menu.contains(action)) menu.appendChild(action);
      });
      Array.from(cell.querySelectorAll('.vx-inline-qr-actions')).forEach(wrapper => {
        if (!wrapper.querySelector('button,a')) wrapper.remove();
      });

      const actions = Array.from(menu.querySelectorAll(':scope > button,:scope > a'));
      if (actions.length === 1) {
        const only = actions[0];
        only.classList.add('vx-single-secondary-action');
        details.replaceWith(only);
      }
    });
  }

  function removeDuplicateEmptyStateIcons() {
    document.querySelectorAll('.empty-state,.empty,.empty-view,[data-empty-state],.billing-empty').forEach(container => {
      const candidates = Array.from(container.querySelectorAll('svg,.icon,[aria-hidden="true"],span,div'))
        .filter(node => ['✓','✔'].includes(String(node.textContent || '').trim()) || /check/i.test(String(node.className || '')));
      if (candidates.length < 2) return;
      candidates.slice(1).forEach(node => {
        if (!node.querySelector('button,a,input')) node.remove();
      });
    });
  }

  function cardFor(node) {
    return node?.closest?.('.card,.panel,.section-card,.setup-card,.onboarding-card,[data-card]') || null;
  }

  function collapseManualAdminApproval() {
    if (!/onboarding|setup/i.test(String(location.hash || '') + String(location.pathname || ''))) return;
    if (document.querySelector('.vx-admin-manual-fallback')) return;
    const all = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,strong,span,div,p'));
    const automatic = all.find(node => /automatisch.*(freigabe|erkennung|prüfung)|(freigabe|erkennung|prüfung).*automatisch/i.test(norm(node.textContent)));
    const manual = all.find(node => /manuell.*freigabe|freigabe.*manuell/i.test(norm(node.textContent)));
    const automaticCard = cardFor(automatic);
    const manualCard = cardFor(manual);
    if (!automaticCard || !manualCard || automaticCard === manualCard || manualCard.dataset.vxManualCollapsed === 'true') return;

    const details = document.createElement('details');
    details.className = 'vx-admin-manual-fallback';
    const summary = document.createElement('summary');
    summary.textContent = 'Manuelle Freigabe als Ausnahme';
    const content = document.createElement('div');
    content.className = 'vx-admin-manual-content';
    manualCard.parentNode.insertBefore(details, manualCard);
    details.append(summary, content);
    content.appendChild(manualCard);
    manualCard.dataset.vxManualCollapsed = 'true';
  }

  function tick() {
    injectStyles();
    fixCustomerListTitle();
    fixAllInvoicesButtons();
    fixSubscriptionSearch();
    fixBillingActionMenus();
    removeDuplicateEmptyStateIcons();
    collapseManualAdminApproval();
  }

  document.addEventListener('click', () => setTimeout(tick, 40), true);
  w.addEventListener('hashchange', () => setTimeout(tick, 80));
  setInterval(tick, 700);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once:true });
  else tick();
})(typeof globalThis !== 'undefined' ? globalThis : window);
