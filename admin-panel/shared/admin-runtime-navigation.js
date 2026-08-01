(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;
  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once: true });
  const same = (a, b) => String(a || '') === String(b || '');
  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  let billingCustomerId = '';
  let contractsCustomerId = '';
  let preserveBillingFilter = false;
  let preserveContractsFilter = false;

  function css() {
    if (document.getElementById('voxera-runtime-nav-css')) return;
    const s = document.createElement('style'); s.id = 'voxera-runtime-nav-css';
    s.textContent = `
      #offers-workspace .table-wrap{max-height:260px!important}
      #offer-detail-shell .offer-header-card{position:static!important;top:auto!important;z-index:auto!important;box-shadow:0 1px 3px rgba(15,23,42,.06)!important}
      #offer-detail-shell.vox-compact .vox-optional{display:none!important}
      #offer-detail-shell.vox-compact .offer-columns,#offer-detail-shell.vox-compact .offer-editor{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:10px!important;width:100%!important}
      #offer-detail-shell.vox-compact .offer-card{margin-bottom:10px!important}
      #offer-detail-shell.vox-compact .offer-card .card-head{min-height:44px!important;padding:10px 14px!important}
      #offer-detail-shell.vox-compact .offer-card textarea{min-height:88px!important}
      #offer-detail-shell.vox-compact .offer-card [style*="grid-template-columns"]{grid-template-columns:minmax(0,1fr)!important}
      .vox-workspace-actions{display:flex;gap:8px;flex-wrap:wrap}
      .vox-customer-filter-note{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 12px;border:1px solid #B9D4FF;border-radius:10px;background:#EFF6FF;color:#1558BA;font-size:12px;font-weight:600}
      .vox-customer-filter-note button{border:0;background:transparent;color:#1558BA;font:inherit;text-decoration:underline;cursor:pointer;padding:0}
      @media(max-width:900px){#offer-detail-shell .offer-header-card{position:static!important}.vox-customer-filter-note{width:100%}}
    `;
    document.head.appendChild(s);
  }

  ready(() => {
    css();
    const route = typeof setRoute === 'function' ? setRoute : null;
    if (!route) return;

    const renderBillingOriginal = typeof renderBillingFinance === 'function' ? renderBillingFinance : null;
    const renderContractsOriginal = typeof renderContracts === 'function' ? renderContracts : null;

    function offer() { return (state.offers || []).find(x => same(x.id, state.selectedOfferId)); }
    function offerCustomerId(row) { return String(row?.customerId || row?.customer_id || row?.raw?.customerId || row?.raw?.customer_id || ''); }
    function offerContractId(row) { return String(row?.contractId || row?.contract_id || row?.raw?.contractId || row?.raw?.contract_id || ''); }
    function invoiceCustomerId(row) { return String(row?.customer_id || row?.customerId || row?.raw?.customer_id || row?.raw?.customerId || ''); }
    function contractCustomerId(row) { return String(row?.customer_id || row?.customerId || row?.raw?.customer_id || row?.raw?.customerId || ''); }
    function customerName(id) { const c = typeof customerById === 'function' ? customerById(id) : null; return c?.name || c?.email || id; }

    function clearBillingFilter(render = true) {
      billingCustomerId = '';
      const search = document.getElementById('finance-invoice-search'); if (search) search.value = '';
      document.getElementById('vox-billing-customer-filter')?.remove();
      if (render && typeof renderBillingFinance === 'function') renderBillingFinance();
    }

    function clearContractsFilter(render = true) {
      contractsCustomerId = '';
      ['contracts-search', 'contracts-search-inline'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('vox-contract-customer-filter')?.remove();
      if (render && typeof renderContracts === 'function') renderContracts();
    }

    function showBillingFilter() {
      if (!billingCustomerId) return;
      const search = document.getElementById('finance-invoice-search');
      const toolbar = search?.closest('.toolbar') || search?.parentElement;
      if (!toolbar) return;
      let note = document.getElementById('vox-billing-customer-filter');
      if (!note) { note = document.createElement('div'); note.id = 'vox-billing-customer-filter'; note.className = 'vox-customer-filter-note'; toolbar.insertAdjacentElement('afterend', note); }
      note.innerHTML = `Nur Rechnungen von <strong>${escHtml(customerName(billingCustomerId))}</strong> <button type="button">Filter entfernen</button>`;
      note.querySelector('button').onclick = () => clearBillingFilter(true);
    }

    function showContractsFilter() {
      if (!contractsCustomerId) return;
      const search = document.getElementById('contracts-search') || document.getElementById('contracts-search-inline');
      const toolbar = search?.closest('.toolbar') || search?.parentElement;
      if (!toolbar) return;
      let note = document.getElementById('vox-contract-customer-filter');
      if (!note) { note = document.createElement('div'); note.id = 'vox-contract-customer-filter'; note.className = 'vox-customer-filter-note'; toolbar.insertAdjacentElement('afterend', note); }
      note.innerHTML = `Nur Verträge von <strong>${escHtml(customerName(contractsCustomerId))}</strong> <button type="button">Filter entfernen</button>`;
      note.querySelector('button').onclick = () => clearContractsFilter(true);
    }

    if (renderBillingOriginal) {
      w.renderBillingFinance = function () {
        const originalRows = state.invoices;
        if (billingCustomerId) state.invoices = (originalRows || []).filter(row => same(invoiceCustomerId(row), billingCustomerId));
        try { return renderBillingOriginal.apply(this, arguments); }
        finally { state.invoices = originalRows; if (billingCustomerId) setTimeout(showBillingFilter, 0); }
      };
    }

    if (renderContractsOriginal) {
      w.renderContracts = function () {
        const originalRows = state.contracts;
        if (contractsCustomerId) state.contracts = (originalRows || []).filter(row => same(contractCustomerId(row), contractsCustomerId));
        try { return renderContractsOriginal.apply(this, arguments); }
        finally { state.contracts = originalRows; if (contractsCustomerId) setTimeout(showContractsFilter, 0); }
      };
    }

    function invoices(id) {
      billingCustomerId = String(id || '');
      preserveBillingFilter = true;
      route('billing-finance');
      preserveBillingFilter = false;
      const search = document.getElementById('finance-invoice-search'); if (search) search.value = '';
      const type = document.getElementById('finance-type-filter'); if (type) type.value = 'all';
      const status = document.getElementById('finance-status-filter'); if (status) status.value = 'all';
      if (typeof w.renderBillingFinance === 'function') w.renderBillingFinance();
    }

    function contract(contractId) {
      if (!contractId) return;
      contractsCustomerId = '';
      preserveContractsFilter = true;
      route('offers');
      preserveContractsFilter = false;
      if (typeof salesShowTab === 'function') salesShowTab('contracts');
      ['contracts-search', 'contracts-search-inline'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      if (typeof w.renderContracts === 'function') w.renderContracts();
      requestAnimationFrame(() => { if (typeof viewContract === 'function') viewContract(contractId); });
    }

    function customerContracts(customerId) {
      contractsCustomerId = String(customerId || '');
      preserveContractsFilter = true;
      route('offers');
      preserveContractsFilter = false;
      if (typeof salesShowTab === 'function') salesShowTab('contracts');
      ['contracts-search', 'contracts-search-inline'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      if (typeof w.renderContracts === 'function') w.renderContracts();
    }

    w.openContractInSales = contract;
    w.openCustomerContractsInSales = customerContracts;
    w.openCustomerInvoicesAll = invoices;
    w.clearCustomerBillingFilter = clearBillingFilter;
    w.clearCustomerContractsFilter = clearContractsFilter;

    w.setRoute = function (name, replace) {
      if (name !== 'billing-finance' || !preserveBillingFilter) clearBillingFilter(false);
      if (name !== 'offers' || !preserveContractsFilter) clearContractsFilter(false);
      if (name === 'contracts') {
        const r = route('offers', replace);
        requestAnimationFrame(() => { if (typeof salesShowTab === 'function') salesShowTab('contracts'); });
        return r;
      }
      return route(name, replace);
    };

    w.openCustomerProfile = id => openCustomerWorkspace(id);
    w.openLinkedCustomerFromOffer = function () {
      const customerId = offerCustomerId(offer());
      if (customerId) openCustomerWorkspace(customerId);
      else if (typeof showToast === 'function') showToast('Kein verknüpfter Kunde vorhanden.');
    };
    w.openOfferContract = function () {
      const contractId = offerContractId(offer());
      if (contractId) contract(contractId);
      else if (typeof showToast === 'function') showToast('Kein Vertrag verknüpft.');
    };

    function bindOfferMetaLink(span, { prefix, label, href, targetId, open }) {
      if (!span || !targetId) return;
      let link = span.querySelector('a');
      if (!link) {
        span.textContent = prefix + ' ';
        link = document.createElement('a');
        span.appendChild(link);
      }
      link.textContent = label;
      link.href = href;
      link.dataset.voxTargetId = String(targetId);
      link.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        open();
      };
    }

    function patchOffer() {
      const shell = document.getElementById('offer-detail-shell'); if (!shell) return;
      shell.classList.add('vox-compact');
      [...shell.querySelectorAll('.offer-card')].forEach(card => {
        const t = String(card.querySelector('h3')?.textContent || '').toLowerCase();
        const essential = t.includes('kunde') || t.includes('kommerziell') || t.includes('position') || t.includes('leistung');
        card.classList.toggle('vox-optional', !essential);
      });
      const actions = document.getElementById('offer-header-actions') || shell.querySelector('.offer-actions');
      if (actions && !document.getElementById('vox-offer-toggle')) {
        const b = document.createElement('button'); b.id = 'vox-offer-toggle'; b.className = 'btn btn-quiet btn-sm'; b.textContent = 'Alle Details';
        b.onclick = () => { const compact = shell.classList.toggle('vox-compact'); b.textContent = compact ? 'Alle Details' : 'Weniger anzeigen'; };
        actions.appendChild(b);
      }
      const o = offer(), meta = document.getElementById('offer-header-meta');
      if (o && meta) {
        const customerId = offerCustomerId(o);
        const contractId = offerContractId(o);
        [...meta.querySelectorAll('span')].forEach(span => {
          const t = span.textContent.trim();
          if (t.startsWith('Kunde:') && customerId) {
            bindOfferMetaLink(span, {
              prefix: 'Kunde:',
              label: 'Kunde verknüpft',
              href: '#customer-workspace',
              targetId: customerId,
              open: () => openCustomerWorkspace(customerId)
            });
          }
          if (t.startsWith('Vertrag:') && contractId) {
            bindOfferMetaLink(span, {
              prefix: 'Vertrag:',
              label: 'verknüpft',
              href: '#offers',
              targetId: contractId,
              open: () => contract(contractId)
            });
          }
        });
      }
    }

    function patchWorkspace(id) {
      id = String(id || document.getElementById('section-customer-workspace')?.dataset?.customerId || ''); if (!id) return;
      const a = document.getElementById('cw-actions');
      if (a) {
        const details = [...a.querySelectorAll('button')].find(b => b.textContent.trim() === 'Details');
        if (details) { details.textContent = 'Kundendaten'; details.onclick = () => openEditCustomerModal(id); }
        [['invoices', 'Rechnungen', () => invoices(id)], ['contracts', 'Verträge', () => customerContracts(id)]].forEach(([key, label, fn]) => {
          if (a.querySelector(`[data-vox="${key}"]`)) return;
          const b = document.createElement('button'); b.className = 'btn btn-quiet btn-sm'; b.dataset.vox = key; b.textContent = label; b.onclick = fn; a.appendChild(b);
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
        const h = document.createElement('div'); h.dataset.voxCustomerShortcuts = '1'; h.style.cssText = 'margin-left:auto;display:flex;gap:6px;flex-wrap:wrap';
        const bi = document.createElement('button'); bi.className = 'btn btn-quiet btn-sm'; bi.textContent = 'Rechnungen'; bi.onclick = () => invoices(id);
        const bc = document.createElement('button'); bc.className = 'btn btn-quiet btn-sm'; bc.textContent = 'Verträge'; bc.onclick = () => customerContracts(id);
        h.append(bi, bc); footer.appendChild(h);
      });
    }

    const od = typeof openOfferDetail === 'function' ? openOfferDetail : null;
    if (od) w.openOfferDetail = function () { const r = od.apply(this, arguments); patchOffer(); return r; };
    const rw = typeof renderCustomerWorkspace === 'function' ? renderCustomerWorkspace : null;
    if (rw) w.renderCustomerWorkspace = function (id) { const r = rw.apply(this, arguments); patchWorkspace(id); return r; };
    const rc = typeof renderCustomers === 'function' ? renderCustomers : null;
    if (rc) w.renderCustomers = function () { const r = rc.apply(this, arguments); patchCustomers(); return r; };

    patchOffer(); patchCustomers(); patchWorkspace();
    const observer = new MutationObserver(() => setTimeout(() => { patchOffer(); patchCustomers(); }, 20));
    ['offer-detail-shell', 'customers-card-list'].forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el, { childList: true, subtree: true }); });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
