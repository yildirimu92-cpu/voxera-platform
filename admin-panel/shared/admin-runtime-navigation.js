(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;
  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once: true });
  const same = (a, b) => String(a || '') === String(b || '');

  function css() {
    if (document.getElementById('voxera-runtime-nav-css')) return;
    const s = document.createElement('style'); s.id = 'voxera-runtime-nav-css';
    s.textContent = `#offers-workspace .table-wrap{max-height:190px!important}#offer-detail-shell.vox-compact .vox-optional{display:none!important}#offer-detail-shell.vox-compact .offer-columns{grid-template-columns:1fr!important}#offer-detail-shell.vox-compact .offer-editor{display:grid!important;grid-template-columns:1fr 1fr!important;gap:12px!important}#offer-detail-shell .offer-header-card{position:sticky;top:74px;z-index:8;box-shadow:0 6px 18px rgba(15,23,42,.08)}.vox-workspace-actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:900px){#offer-detail-shell.vox-compact .offer-editor{grid-template-columns:1fr!important}#offer-detail-shell .offer-header-card{position:static}}`;
    document.head.appendChild(s);
  }

  ready(() => {
    css();
    const route = typeof setRoute === 'function' ? setRoute : null;
    const invoicesOriginal = typeof openCustomerInvoicesInFinance === 'function' ? openCustomerInvoicesInFinance : null;
    if (!route) return;

    function offer() { return (state.offers || []).find(x => same(x.id, state.selectedOfferId)); }
    function invoices(id) {
      if (invoicesOriginal) invoicesOriginal(id); else route('billing-finance');
      const f = document.getElementById('finance-status-filter'); if (f) f.value = 'all';
      if (typeof renderBillingFinance === 'function') renderBillingFinance();
    }
    function contract(contractId) {
      if (!contractId) return;
      route('offers'); if (typeof salesShowTab === 'function') salesShowTab('contracts');
      ['contracts-search', 'contracts-search-inline'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      if (typeof renderContracts === 'function') renderContracts();
      requestAnimationFrame(() => { if (typeof viewContract === 'function') viewContract(contractId); });
    }
    function customerContracts(customerId) {
      const c = typeof customerById === 'function' ? customerById(customerId) : null;
      const term = String(c?.name || customerId || '');
      route('offers'); if (typeof salesShowTab === 'function') salesShowTab('contracts');
      ['contracts-search', 'contracts-search-inline'].forEach(id => { const el = document.getElementById(id); if (el) el.value = term; });
      if (typeof renderContracts === 'function') renderContracts();
    }
    w.openContractInSales = contract; w.openCustomerContractsInSales = customerContracts; w.openCustomerInvoicesAll = invoices;

    setRoute = function (name, replace) {
      if (name === 'contracts') { const r = route('offers', replace); requestAnimationFrame(() => salesShowTab('contracts')); return r; }
      return route(name, replace);
    };
    openCustomerProfile = id => openCustomerWorkspace(id);
    openLinkedCustomerFromOffer = function () { const o = offer(); if (o?.customerId) openCustomerWorkspace(o.customerId); else if (typeof showToast === 'function') showToast('Kein verknüpfter Kunde vorhanden.'); };
    openOfferContract = function () { const o = offer(); if (o?.contractId) contract(o.contractId); else if (typeof showToast === 'function') showToast('Kein Vertrag verknüpft.'); };

    function patchOffer() {
      const shell = document.getElementById('offer-detail-shell'); if (!shell) return;
      shell.classList.add('vox-compact');
      [...shell.querySelectorAll('.offer-card')].forEach(card => {
        const t = String(card.querySelector('h3')?.textContent || '').toLowerCase();
        card.classList.toggle('vox-optional', !(t.includes('kunde') || t.includes('kommerziell')));
      });
      const actions = document.getElementById('offer-header-actions') || shell.querySelector('.offer-actions');
      if (actions && !document.getElementById('vox-offer-toggle')) {
        const b = document.createElement('button'); b.id = 'vox-offer-toggle'; b.className = 'btn btn-quiet btn-sm'; b.textContent = 'Alle Details';
        b.onclick = () => { const compact = shell.classList.toggle('vox-compact'); b.textContent = compact ? 'Alle Details' : 'Kompakt'; };
        actions.appendChild(b);
      }
      const o = offer(), meta = document.getElementById('offer-header-meta');
      if (o && meta) [...meta.querySelectorAll('span')].forEach(span => {
        const t = span.textContent.trim();
        if (t.startsWith('Kunde:') && o.customerId) { span.innerHTML = 'Kunde: <a href="#">Kunde verknüpft</a>'; span.querySelector('a').onclick = e => { e.preventDefault(); openCustomerWorkspace(o.customerId); }; }
        if (t.startsWith('Vertrag:') && o.contractId) { span.innerHTML = 'Vertrag: <a href="#offers">verknüpft</a>'; span.querySelector('a').onclick = e => { e.preventDefault(); contract(o.contractId); }; }
      });
    }

    function patchWorkspace(id) {
      id = String(id || document.getElementById('section-customer-workspace')?.dataset?.customerId || ''); if (!id) return;
      const a = document.getElementById('cw-actions');
      if (a) {
        const details = [...a.querySelectorAll('button')].find(b => b.textContent.trim() === 'Details');
        if (details) { details.textContent = 'Kundendaten'; details.onclick = () => openEditCustomerModal(id); }
        [['invoices', 'Rechnungen', () => invoices(id)], ['contracts', 'Verträge', () => customerContracts(id)]].forEach(([key, label, fn]) => {
          if (a.querySelector(`[data-vox="${key}"]`)) return;
          const b = document.createElement('button'); b.className = 'btn btn-quiet btn-sm'; b.dataset.vox = key; b.textContent = label; b.style.cssText = 'background:rgba(255,255,255,.12);color:#fff;border:none'; b.onclick = fn; a.appendChild(b);
        });
        a.classList.add('vox-workspace-actions');
      }
      const bill = document.getElementById('cw-billing'), btns = bill ? [...bill.querySelectorAll('button')] : [];
      if (btns[0]) { btns[0].textContent = 'Rechnungsübersicht'; btns[0].onclick = () => invoices(id); }
      if (btns[1]) { btns[1].textContent = 'Vertragsübersicht'; btns[1].onclick = () => customerContracts(id); }
      [...(document.getElementById('cw-cases')?.querySelectorAll('button') || [])].forEach(b => { if (/Alle Cases/i.test(b.textContent)) b.remove(); });
    }

    function patchCustomers() {
      [...(document.getElementById('customers-card-list')?.children || [])].forEach(card => {
        const base = card.querySelector('[data-customer-action="workspace"],[data-customer-action="profile"]'), id = base?.dataset.customerId; if (!id) return;
        card.querySelector('[data-customer-action="create-case"]')?.remove();
        const footer = base.parentElement; if (!footer || footer.querySelector('[data-vox-customer-shortcuts]')) return;
        const h = document.createElement('div'); h.dataset.voxCustomerShortcuts = '1'; h.style.cssText = 'margin-left:auto;display:flex;gap:6px';
        const bi = document.createElement('button'); bi.className = 'btn btn-quiet btn-sm'; bi.textContent = 'Rechnungen'; bi.onclick = () => invoices(id);
        const bc = document.createElement('button'); bc.className = 'btn btn-quiet btn-sm'; bc.textContent = 'Verträge'; bc.onclick = () => customerContracts(id);
        h.append(bi, bc); footer.appendChild(h);
      });
    }

    const od = typeof openOfferDetail === 'function' ? openOfferDetail : null;
    if (od) openOfferDetail = function () { const r = od.apply(this, arguments); patchOffer(); return r; };
    const rw = typeof renderCustomerWorkspace === 'function' ? renderCustomerWorkspace : null;
    if (rw) renderCustomerWorkspace = function (id) { const r = rw.apply(this, arguments); patchWorkspace(id); return r; };
    const rc = typeof renderCustomers === 'function' ? renderCustomers : null;
    if (rc) renderCustomers = function () { const r = rc.apply(this, arguments); patchCustomers(); return r; };

    patchOffer(); patchCustomers(); patchWorkspace();
    const observer = new MutationObserver(() => setTimeout(() => { patchOffer(); patchCustomers(); }, 20));
    ['offer-detail-shell', 'customers-card-list'].forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el, { childList: true, subtree: true }); });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
