(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const busy = new Set();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => new Intl.NumberFormat('de-CH',{style:'currency',currency:'CHF'}).format(Number(value || 0));
  const BILLING_TAB_LABELS = ['aufgaben','alle rechnungen','subscriptions','überzug'];

  function invoices() {
    return typeof state !== 'undefined' && Array.isArray(state.invoices) ? state.invoices : [];
  }

  function syncInvoice(updated) {
    if (!updated || typeof state === 'undefined' || !Array.isArray(state.invoices)) return;
    const index = state.invoices.findIndex(row => String(row.id) === String(updated.id));
    if (index >= 0) state.invoices[index] = { ...state.invoices[index], ...updated };
    else state.invoices.unshift(updated);
  }

  function isBillingRoute() {
    return /billing/i.test(String(location.hash || '')) || /billing/i.test(String(location.pathname || ''));
  }

  function findBillingRoot() {
    const direct = document.querySelector('#section-billing, #section-billing-finance, [data-section="billing"], [data-page="billing"]');
    if (direct) return direct;
    if (!isBillingRoute()) return null;
    const headings = Array.from(document.querySelectorAll('h1,h2,.page-title'));
    const heading = headings.find(node => String(node.textContent || '').trim().toLowerCase() === 'billing');
    return heading?.closest('main,section,.content,.page,.main-content') || document.querySelector('main') || document.querySelector('.main-content');
  }

  function findInvoiceListAnchor(root) {
    if (!root) return null;
    const candidates = Array.from(root.querySelectorAll('.card,section,article,table'));
    return candidates.find(node => {
      const text = String(node.textContent || '').toLowerCase();
      return text.includes('rechnung') && text.includes('kunde') && text.includes('aktionen');
    }) || null;
  }

  function ensureCard() {
    const root = findBillingRoot();
    if (!root) return null;
    let card = document.getElementById('vx-qr-invoice-card');
    if (card && root.contains(card)) return card;
    if (card) card.remove();
    card = document.createElement('section');
    card.id = 'vx-qr-invoice-card';
    card.className = 'card';
    card.style.marginTop = '16px';
    card.innerHTML = '<div class="vx-unified-head"><div><h3>QR-Rechnungen</h3><p>PDF-Status, Erstellung und Download der Schweizer QR-Rechnungen.</p></div><button class="btn btn-secondary" type="button" id="vx-qr-refresh">Aktualisieren</button></div><div id="vx-qr-invoice-list" style="padding:16px"></div>';
    const anchor = findInvoiceListAnchor(root);
    if (anchor?.parentNode) anchor.insertAdjacentElement('afterend', card);
    else root.appendChild(card);
    card.querySelector('#vx-qr-refresh')?.addEventListener('click', render);
    return card;
  }

  function status(invoice) {
    if (invoice.pdf_url && invoice.qr_payload) return { label:'QR-Rechnung verfügbar', cls:'badge-success' };
    if (String(invoice.status || '').toLowerCase() === 'sent') return { label:'Versandstatus ohne PDF', cls:'badge-danger' };
    return { label:'Noch nicht erstellt', cls:'' };
  }

  function row(invoice) {
    const current = status(invoice);
    const generated = invoice.pdf_generated_at ? new Date(invoice.pdf_generated_at).toLocaleString('de-CH') : '—';
    const isBusy = busy.has(String(invoice.id));
    const action = invoice.pdf_url
      ? `<a class="btn btn-primary btn-sm" href="${esc(invoice.pdf_url)}" target="_blank" rel="noopener">QR-Rechnung öffnen</a><button class="btn btn-secondary btn-sm" data-vx-qr-generate="${esc(invoice.id)}" ${isBusy?'disabled':''}>${isBusy?'Erstelle …':'Neu generieren'}</button>`
      : `<button class="btn btn-primary btn-sm" data-vx-qr-generate="${esc(invoice.id)}" ${isBusy?'disabled':''}>${isBusy?'Erstelle …':'QR-Rechnung erstellen'}</button>`;
    return `<div class="vx-qr-row" style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(120px,.7fr) auto;gap:14px;align-items:center;padding:13px 0;border-bottom:1px solid var(--line2)">
      <div><strong>${esc(invoice.invoice_number || invoice.id)}</strong><div class="muted" style="font-size:11px;margin-top:3px">${esc(invoice.invoice_type || 'Rechnung')} · ${fmt(invoice.total_amount)} · Status ${esc(invoice.status || '—')}</div></div>
      <div><span class="badge ${current.cls}">${esc(current.label)}</span><div class="muted" style="font-size:10px;margin-top:4px">Erstellt: ${esc(generated)} · Version ${Number(invoice.pdf_version || 0)}</div></div>
      <div style="display:flex;gap:7px;justify-content:flex-end;flex-wrap:wrap">${action}</div>
    </div>`;
  }

  function render() {
    if (!isBillingRoute()) return;
    const card = ensureCard();
    if (!card) return;
    const list = card.querySelector('#vx-qr-invoice-list');
    const rows = invoices().filter(invoice => String(invoice.invoice_type || '').toLowerCase() !== 'credit_note');
    if (!rows.length) {
      list.innerHTML = '<div class="vx-empty-state"><strong>Noch keine Rechnungen vorhanden</strong><span>Sobald eine Rechnung erstellt wurde, erscheint hier ihr QR-PDF-Status.</span></div>';
      return;
    }
    list.innerHTML = rows.slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).map(row).join('');
    list.querySelectorAll('[data-vx-qr-generate]').forEach(button => button.addEventListener('click', () => generate(button.dataset.vxQrGenerate)));
  }

  async function generate(invoiceId) {
    if (!invoiceId || busy.has(String(invoiceId))) return;
    busy.add(String(invoiceId));
    render();
    try {
      const result = await w.callAdminFunction('admin-invoice-qr-pdf', { invoice_id: invoiceId });
      if (!result?.success || !result?.invoice) throw new Error(result?.error || 'QR-Rechnung konnte nicht erstellt werden.');
      syncInvoice(result.invoice);
      render();
      if (typeof w.showToast === 'function') w.showToast('QR-Rechnung wurde erstellt.');
      if (result.pdf_url) w.open(result.pdf_url, '_blank', 'noopener');
    } catch (error) {
      const message = error?.payload?.error || error?.message || String(error);
      if (typeof w.showToast === 'function') w.showToast(`Rechnung vorhanden, QR-PDF fehlt: ${message}`);
      const list = document.getElementById('vx-qr-invoice-list');
      if (list) list.insertAdjacentHTML('afterbegin', `<div class="alert alert-danger" style="margin-bottom:12px">Die Rechnung bleibt bestehen. QR-PDF-Erstellung fehlgeschlagen: ${esc(message)}</div>`);
    } finally {
      busy.delete(String(invoiceId));
      render();
    }
  }

  function billingTabs() {
    return Array.from(document.querySelectorAll('button,a,[role="tab"]')).filter(node => BILLING_TAB_LABELS.includes(String(node.textContent || '').trim().toLowerCase()));
  }

  function setActiveBillingTab(target) {
    const tabs = billingTabs();
    if (tabs.length < 2 || !tabs.includes(target)) return;
    tabs.forEach(tab => {
      const active = tab === target;
      tab.classList.toggle('active', active);
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) tab.setAttribute('data-active', 'true');
      else tab.removeAttribute('data-active');
    });
  }

  function installTabFix() {
    document.addEventListener('click', event => {
      const target = event.target?.closest?.('button,a,[role="tab"]');
      if (!target) return;
      const label = String(target.textContent || '').trim().toLowerCase();
      if (!BILLING_TAB_LABELS.includes(label)) return;
      setTimeout(() => setActiveBillingTab(target), 0);
      setTimeout(() => setActiveBillingTab(target), 120);
      setTimeout(render, 180);
    }, true);
  }

  function install() {
    installTabFix();
    const observer = new MutationObserver(() => {
      if (!isBillingRoute()) return;
      render();
      const selected = billingTabs().find(tab => tab.getAttribute('aria-selected') === 'true' || tab.classList.contains('active') || tab.classList.contains('is-active'));
      if (selected) setActiveBillingTab(selected);
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
    w.addEventListener('hashchange', () => setTimeout(render, 50));
    setInterval(() => { if (isBillingRoute()) render(); }, 1500);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);
