(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const TAB_LABELS = ['aufgaben', 'alle rechnungen', 'subscriptions', 'überzug'];
  const busy = new Set();
  let selectedLabel = null;
  let lastSignature = '';
  let billingCallWrapped = false;

  const norm = value => String(value || '').trim().toLowerCase();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const onBilling = () => /billing/i.test(String(location.hash || '')) || /billing/i.test(String(location.pathname || ''));
  const invoices = () => (typeof state !== 'undefined' && Array.isArray(state.invoices)) ? state.invoices : [];

  function mergeInvoiceIntoState(invoice) {
    if (!invoice || typeof state === 'undefined' || !Array.isArray(state.invoices)) return;
    const index = state.invoices.findIndex(row => String(row.id) === String(invoice.id));
    if (index >= 0) state.invoices[index] = { ...state.invoices[index], ...invoice };
    else state.invoices.unshift(invoice);
  }

  function installOverageInvoiceRoute() {
    if (billingCallWrapped || typeof w.callAdminFunction !== 'function') return;
    const original = w.callAdminFunction.bind(w);
    w.callAdminFunction = async function (functionName, payload, ...rest) {
      const action = norm(payload?.action);
      if (functionName === 'customer-billing-update' && action === 'create_overage_invoice') {
        const result = await original('admin-overage-invoice', payload, ...rest);
        if (result?.invoice) mergeInvoiceIntoState(result.invoice);
        if (result?.success && typeof w.showToast === 'function') {
          w.showToast(result.created === false
            ? 'Überzugsrechnung für diese Periode ist bereits vorhanden.'
            : 'Überzugsrechnung mit Swiss QR Code wurde erstellt.');
        }
        lastSignature = '';
        return result;
      }
      return original(functionName, payload, ...rest);
    };
    billingCallWrapped = true;
  }

  function findTabs() {
    return Array.from(document.querySelectorAll('button,a,[role="tab"]'))
      .filter(node => TAB_LABELS.includes(norm(node.textContent)));
  }

  function inferSelectedTab(tabs) {
    if (selectedLabel && tabs.some(tab => norm(tab.textContent) === selectedLabel)) return selectedLabel;
    const explicit = tabs.find(tab => tab.getAttribute('aria-selected') === 'true' || tab.dataset.active === 'true');
    if (explicit) return norm(explicit.textContent);
    const active = tabs.find(tab => tab.classList.contains('active') || tab.classList.contains('is-active'));
    return active ? norm(active.textContent) : 'aufgaben';
  }

  function syncTabs() {
    if (!onBilling()) return;
    const tabs = findTabs();
    if (tabs.length < 2) return;
    const activeLabel = inferSelectedTab(tabs);
    tabs.forEach(tab => {
      const active = norm(tab.textContent) === activeLabel;
      if (tab.classList.contains('active') !== active) tab.classList.toggle('active', active);
      if (tab.classList.contains('is-active') !== active) tab.classList.toggle('is-active', active);
      if (tab.getAttribute('aria-selected') !== String(active)) tab.setAttribute('aria-selected', String(active));
      if (active) {
        if (tab.dataset.active !== 'true') tab.dataset.active = 'true';
      } else if ('active' in tab.dataset) {
        delete tab.dataset.active;
      }
    });
  }

  function invoiceByNumber(number) {
    return invoices().find(invoice => String(invoice.invoice_number || '') === String(number || '')) || null;
  }

  function actionCellForRow(row) {
    const cells = Array.from(row.children || []);
    return cells.find(cell => /öffnen|erneut senden|bezahlt|mahnen/i.test(String(cell.textContent || ''))) || cells[cells.length - 1] || null;
  }

  function actionsHtml(invoice) {
    const invoiceId = esc(invoice.id);
    const isBusy = busy.has(String(invoice.id));
    const style = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px';

    if (invoice.pdf_url) {
      return `<span class="vx-inline-qr-actions" style="${style}">
        <a class="btn btn-secondary btn-sm vx-inline-qr-action" data-vx-qr-open="${invoiceId}" href="${esc(invoice.pdf_url)}" target="_blank" rel="noopener">QR öffnen</a>
        <button type="button" class="btn btn-secondary btn-sm vx-inline-qr-action" data-vx-qr-generate="${invoiceId}" data-vx-qr-mode="regenerate" ${isBusy ? 'disabled' : ''}>${isBusy ? 'Wird neu erstellt…' : 'Neu generieren'}</button>
      </span>`;
    }

    return `<span class="vx-inline-qr-actions" style="${style}">
      <button type="button" class="btn btn-secondary btn-sm vx-inline-qr-action" data-vx-qr-generate="${invoiceId}" data-vx-qr-mode="create" ${isBusy ? 'disabled' : ''}>${isBusy ? 'QR wird erstellt…' : 'QR-Rechnung erstellen'}</button>
    </span>`;
  }

  function mountInlineActions() {
    // The invoice table intentionally exposes only the four business actions.
    // QR/PDF controls live in the invoice detail modal.
    document.querySelectorAll('.vx-inline-qr-actions').forEach(node => node.remove());
  }

  async function generate(invoiceId, button, mode) {
    if (!invoiceId || busy.has(String(invoiceId))) return;
    busy.add(String(invoiceId));
    const regenerating = mode === 'regenerate';
    if (button) {
      button.disabled = true;
      button.textContent = regenerating ? 'Wird neu erstellt…' : 'QR wird erstellt…';
    }

    try {
      const result = await w.callAdminFunction('admin-invoice-qr-pdf', { invoice_id: invoiceId });
      if (!result?.success || !result?.invoice) throw new Error(result?.error || 'QR-Rechnung konnte nicht erstellt werden.');
      mergeInvoiceIntoState(result.invoice);
      const detailModal = document.getElementById('invoice-detail-modal');
      if (detailModal?.classList.contains('open') && typeof w.openInvoiceOperational === 'function') {
        w.openInvoiceOperational(invoiceId, result.invoice.customer_id || result.invoice.customerId || '');
      }

      if (typeof w.showToast === 'function') {
        w.showToast(regenerating ? 'QR-Rechnung wurde neu generiert.' : 'QR-Rechnung wurde erstellt.');
      }
      if (result.pdf_url) w.open(result.pdf_url, '_blank', 'noopener');
    } catch (error) {
      const message = error?.payload?.error || error?.message || String(error);
      if (typeof w.showToast === 'function') w.showToast(`QR-PDF fehlgeschlagen: ${message}`);
      else w.alert(`QR-PDF fehlgeschlagen: ${message}`);
    } finally {
      busy.delete(String(invoiceId));
      lastSignature = '';
      mountInlineActions();
    }
  }

  function signature() {
    const tabSig = findTabs().map(tab => `${norm(tab.textContent)}:${tab.className}:${tab.getAttribute('aria-selected')}`).join('|');
    const invoiceSig = invoices().map(inv => `${inv.id}:${inv.invoice_number}:${inv.pdf_url || ''}:${inv.pdf_version || 0}`).join('|');
    const rowSig = Array.from(document.querySelectorAll('tr, .table-row, [role="row"]')).map(row => String(row.textContent || '').slice(0, 100)).join('|');
    return `${location.hash}|${tabSig}|${invoiceSig}|${rowSig}`;
  }

  function tick() {
    installOverageInvoiceRoute();
    if (!onBilling()) return;
    const next = signature();
    if (next === lastSignature) return;
    lastSignature = next;
    syncTabs();
    mountInlineActions();
  }

  document.addEventListener('click', event => {
    const tab = event.target?.closest?.('button,a,[role="tab"]');
    if (tab && TAB_LABELS.includes(norm(tab.textContent))) {
      selectedLabel = norm(tab.textContent);
      setTimeout(() => { lastSignature = ''; tick(); }, 0);
      setTimeout(() => { lastSignature = ''; tick(); }, 150);
      return;
    }

    const qr = event.target?.closest?.('[data-vx-qr-generate]');
    if (qr) {
      event.preventDefault();
      generate(qr.dataset.vxQrGenerate, qr, qr.dataset.vxQrMode || 'create');
    }
  }, true);

  w.addEventListener('hashchange', () => {
    selectedLabel = null;
    lastSignature = '';
    setTimeout(tick, 50);
  });

  setInterval(tick, 800);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once: true });
  else tick();
})(typeof globalThis !== 'undefined' ? globalThis : window);
