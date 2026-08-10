(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete' ? setTimeout(fn,0) : w.addEventListener('load',fn,{ once:true });
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const lower = value => String(value || '').trim().toLowerCase();
  const money = value => {
    const n = Number(value || 0);
    return new Intl.NumberFormat('de-CH',{ style:'currency',currency:'CHF' }).format(Number.isFinite(n)?n:0);
  };
  const actionState = { invoiceId:null, snapshot:null, pending:false };

  function requestId(prefix) {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}:${id}`;
  }

  // Die Stilregeln dieser Datei stehen seit Welle 2 Teil 3 in
  // shared/admin-screens.css. Die Funktion addCss() und ihr Aufruf sind
  // entfallen -- ein zur Laufzeit eingefuegtes Stylesheet gewann nur deshalb,
  // weil es zuletzt kam, und brauchte dafuer !important.

  function ensureModal() {
    if (document.getElementById('invoice-adjustment-modal')) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'invoice-adjustment-modal';
    overlay.addEventListener('click',event=>{ if(event.target===overlay) closeModal(); });
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="invoice-adjustment-title">
        <div class="vox-fin-head">
          <div><div class="modal-title" id="invoice-adjustment-title">Rechnung korrigieren</div><div class="modal-sub" id="invoice-adjustment-sub">Storno, Gutschrift und Rückerstattung nachvollziehbar verbuchen.</div></div>
          <button type="button" class="modal-icon-close" id="invoice-adjustment-close" aria-label="Schliessen"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5l10 10M15 5L5 15"/></svg></button>
        </div>
        <div class="vox-fin-body" id="invoice-adjustment-body"><div class="muted">Rechnungsdaten werden geladen…</div></div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('invoice-adjustment-close')?.addEventListener('click',closeModal);
  }

  function setFeedback(message,type='error') {
    const el = document.getElementById('vox-fin-feedback');
    if (!el) return;
    el.className = `vox-fin-feedback ${type}`;
    el.textContent = message || '';
  }

  function historyHtml(snapshot) {
    const credits = Array.isArray(snapshot?.credit_notes) ? snapshot.credit_notes : [];
    const refunds = Array.isArray(snapshot?.refunds) ? snapshot.refunds : [];
    if (!credits.length && !refunds.length) return '';
    const creditRows = credits.map(row=>`<div class="vox-fin-history-row"><span>${esc(row.invoice_number || 'Gutschrift')} · ${esc(new Date(row.created_at || row.issued_at).toLocaleDateString('de-CH'))}</span><strong>${money(Math.abs(Number(row.total_amount ?? row.total ?? row.amount ?? 0)))}</strong></div>`).join('');
    const refundRows = refunds.map(row=>`<div class="vox-fin-history-row"><span>Rückerstattung · ${esc(row.method || 'manuell')} · ${esc(new Date(row.refunded_at).toLocaleDateString('de-CH'))}</span><strong>${money(row.amount)}</strong></div>`).join('');
    return `<div class="vox-fin-history"><h4>Bisherige Korrekturen</h4>${creditRows}${refundRows}</div>`;
  }

  function renderSnapshot(snapshot) {
    actionState.snapshot = snapshot;
    const body = document.getElementById('invoice-adjustment-body');
    if (!body) return;
    const invoice = snapshot.invoice || {};
    const summary = snapshot.summary || {};
    const actions = snapshot.actions || {};
    document.getElementById('invoice-adjustment-title').textContent = `Rechnung ${invoice.invoice_number || ''} korrigieren`;

    const voidSection = actions.can_void_draft ? `
      <section class="vox-fin-action">
        <h4>Entwurf annullieren</h4><p>Nur unversendete Entwürfe dürfen annulliert werden. Der Datensatz bleibt als «void» erhalten.</p>
        <div class="vox-fin-grid"><div class="full"><label>Grund</label><textarea id="vox-void-reason" placeholder="Warum wird der Entwurf annulliert?"></textarea></div></div>
        <div class="vox-fin-actions"><button type="button" class="btn btn-danger" id="vox-void-submit">Entwurf annullieren</button></div>
      </section>` : '';

    const creditSection = actions.can_create_credit ? `
      <section class="vox-fin-action">
        <h4>Gutschrift erstellen</h4><p>Die Originalrechnung bleibt unverändert. Eine separate vollständige oder teilweise Gutschrift reduziert den offenen Saldo.</p>
        <div class="vox-fin-grid">
          <div><label>Betrag inkl. MWST</label><input id="vox-credit-amount" type="number" min="0.01" step="0.01" max="${Number(summary.remaining_creditable_amount || 0).toFixed(2)}" value="${Number(summary.remaining_creditable_amount || 0).toFixed(2)}"></div>
          <div><label>Maximal gutschreibbar</label><input type="text" value="${esc(money(summary.remaining_creditable_amount))}" disabled></div>
          <div class="full"><label>Begründung *</label><textarea id="vox-credit-reason" placeholder="Zum Beispiel: ausserordentliche Vertragsauflösung, Leistung nicht erbracht"></textarea></div>
        </div>
        <div class="vox-fin-actions"><button type="button" class="btn btn-primary" id="vox-credit-submit">Gutschrift erstellen</button></div>
      </section>` : '';

    const refundSection = actions.can_record_refund ? `
      <section class="vox-fin-action">
        <h4>Rückerstattung verbuchen</h4><p>Dies dokumentiert eine bereits ausgeführte Rückzahlung. Es löst keine automatische Bank- oder Stripe-Zahlung aus.</p>
        <div class="vox-fin-grid">
          <div><label>Betrag</label><input id="vox-refund-amount" type="number" min="0.01" step="0.01" max="${Number(summary.refund_due_amount || 0).toFixed(2)}" value="${Number(summary.refund_due_amount || 0).toFixed(2)}"></div>
          <div><label>Methode</label><select id="vox-refund-method"><option value="bank_transfer">Banküberweisung</option><option value="stripe">Stripe</option><option value="manual">Manuell</option></select></div>
          <div><label>Referenz</label><input id="vox-refund-reference" type="text" placeholder="Zahlungsreferenz"></div>
          <div><label>Notiz</label><input id="vox-refund-reason" type="text" placeholder="Optional"></div>
        </div>
        <div class="vox-fin-actions"><button type="button" class="btn btn-secondary" id="vox-refund-submit">Rückerstattung verbuchen</button></div>
      </section>` : '';

    const empty = !voidSection && !creditSection && !refundSection
      ? '<div class="vox-fin-action"><h4>Keine weitere Aktion möglich</h4><p>Diese Rechnung ist bereits vollständig korrigiert oder besitzt einen Status, der keine weitere Finanzaktion erlaubt.</p></div>' : '';

    body.innerHTML = `
      <div class="vox-fin-summary">
        <div class="vox-fin-kpi"><span>Rechnungsbetrag</span><strong>${money(summary.total_amount)}</strong></div>
        <div class="vox-fin-kpi"><span>Gutgeschrieben</span><strong>${money(summary.credited_amount)}</strong></div>
        <div class="vox-fin-kpi"><span>Offener Saldo</span><strong>${money(summary.outstanding_amount)}</strong></div>
        <div class="vox-fin-kpi"><span>Rückzahlung offen</span><strong>${money(summary.refund_due_amount)}</strong></div>
      </div>
      <div style="font-size:12px;color:var(--slate)">Status: <strong>${esc(invoice.status || '—')}</strong> · Gutschriftstatus: <strong>${esc(invoice.adjustment_status || 'none')}</strong></div>
      <div id="vox-fin-feedback" class="vox-fin-feedback"></div>
      ${voidSection}${creditSection}${refundSection}${empty}${historyHtml(snapshot)}`;

    document.getElementById('vox-void-submit')?.addEventListener('click',()=>submitAction('void_draft'));
    document.getElementById('vox-credit-submit')?.addEventListener('click',()=>submitAction('create_credit'));
    document.getElementById('vox-refund-submit')?.addEventListener('click',()=>submitAction('record_refund'));
  }

  function syncState(snapshot) {
    if (typeof state === 'undefined' || !snapshot?.invoice) return;
    if (Array.isArray(state.invoices)) {
      const index = state.invoices.findIndex(row=>String(row?.id)===String(snapshot.invoice.id));
      if (index >= 0) state.invoices[index] = { ...state.invoices[index], ...snapshot.invoice };
      else state.invoices.unshift(snapshot.invoice);
      (snapshot.credit_notes || []).forEach(note=>{
        const noteIndex = state.invoices.findIndex(row=>String(row?.id)===String(note.id));
        if (noteIndex >= 0) state.invoices[noteIndex] = { ...state.invoices[noteIndex], ...note };
        else state.invoices.unshift(note);
      });
    }
    if (typeof w.renderBillingFinance === 'function') w.renderBillingFinance();
    else if (typeof w.renderAll === 'function') w.renderAll();
  }

  async function loadSnapshot(invoiceId) {
    const body = document.getElementById('invoice-adjustment-body');
    if (body) body.innerHTML = '<div class="muted">Rechnungsdaten werden serverseitig geprüft…</div>';
    try {
      const result = await w.callAdminFunction('invoice-financial-action',{ action:'inspect',invoice_id:invoiceId });
      if (!result?.success || !result?.invoice) throw new Error(result?.error || 'Rechnung konnte nicht geprüft werden.');
      renderSnapshot(result);
    } catch (error) {
      if (body) body.innerHTML = `<div class="vox-fin-feedback error" style="display:block">${esc(error?.message || error)}</div>`;
    }
  }

  async function submitAction(action) {
    if (actionState.pending || !actionState.invoiceId) return;
    const payload = { action, invoice_id:actionState.invoiceId, request_id:requestId(action) };
    if (action === 'void_draft') payload.reason = String(document.getElementById('vox-void-reason')?.value || '').trim();
    if (action === 'create_credit') {
      payload.amount = Number(document.getElementById('vox-credit-amount')?.value || 0);
      payload.reason = String(document.getElementById('vox-credit-reason')?.value || '').trim();
      if (!payload.reason) { setFeedback('Eine Begründung ist erforderlich.'); return; }
    }
    if (action === 'record_refund') {
      payload.amount = Number(document.getElementById('vox-refund-amount')?.value || 0);
      payload.refund_method = document.getElementById('vox-refund-method')?.value || 'manual';
      payload.refund_reference = String(document.getElementById('vox-refund-reference')?.value || '').trim();
      payload.reason = String(document.getElementById('vox-refund-reason')?.value || '').trim();
    }
    if (payload.amount != null && (!(payload.amount > 0) || !Number.isFinite(payload.amount))) { setFeedback('Der Betrag muss grösser als null sein.'); return; }

    actionState.pending = true;
    document.querySelectorAll('#invoice-adjustment-modal button').forEach(btn=>btn.disabled=true);
    setFeedback('Aktion wird verbucht…','ok');
    try {
      const result = await w.callAdminFunction('invoice-financial-action',payload);
      if (!result?.success) throw new Error(result?.error || 'Finanzaktion fehlgeschlagen.');
      syncState(result);
      renderSnapshot(result);
      setFeedback(action === 'void_draft' ? 'Entwurf wurde annulliert.' : action === 'create_credit' ? 'Gutschrift wurde erstellt.' : 'Rückerstattung wurde verbucht.','ok');
      if (typeof w.showToast === 'function') w.showToast(action === 'create_credit' ? 'Gutschrift erstellt.' : 'Finanzaktion gespeichert.');
    } catch (error) {
      setFeedback(error?.message || String(error));
    } finally {
      actionState.pending = false;
      document.querySelectorAll('#invoice-adjustment-modal button').forEach(btn=>btn.disabled=false);
    }
  }

  function openModal(invoiceId) {
    const id = String(invoiceId || state?.invoiceDetailModal?.invoiceId || '');
    if (!id) { if (typeof w.showToast === 'function') w.showToast('Rechnung konnte nicht bestimmt werden.'); return; }
    actionState.invoiceId = id;
    ensureModal();
    if (typeof w.closeInvoiceDetailModal === 'function') w.closeInvoiceDetailModal();
    document.getElementById('invoice-adjustment-modal')?.classList.add('open');
    loadSnapshot(id);
  }

  function closeModal() {
    if (actionState.pending) return;
    document.getElementById('invoice-adjustment-modal')?.classList.remove('open');
    actionState.invoiceId = null;
    actionState.snapshot = null;
  }

  function injectDetailButton(invoiceId) {
    const actions = document.querySelector('#invoice-detail-modal .invoice-detail-actions') || document.querySelector('.invoice-detail-actions');
    if (!actions) return;
    const invoice = typeof state !== 'undefined' && Array.isArray(state.invoices)
      ? state.invoices.find(row=>String(row?.id)===String(invoiceId)) : null;
    let button = document.getElementById('invoice-detail-financial-action');
    if (lower(invoice?.invoice_type) === 'credit_note') { button?.remove(); return; }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'invoice-detail-financial-action';
      button.className = 'btn btn-quiet';
      button.textContent = 'Storno / Gutschrift';
      const reminder = document.getElementById('invoice-detail-remind');
      actions.insertBefore(button,reminder || actions.firstChild);
    }
    button.onclick = ()=>openModal(invoiceId);
  }

  function installDetailHook() {
    const original = w.openInvoiceOperational;
    if (typeof original !== 'function' || original.__voxInvoiceAdjustments) return;
    const wrapped = function () {
      const result = original.apply(this,arguments);
      const invoiceId = String(arguments[0] || state?.invoiceDetailModal?.invoiceId || '');
      setTimeout(()=>injectDetailButton(invoiceId),0);
      return result;
    };
    wrapped.__voxInvoiceAdjustments = true;
    wrapped.__voxOriginal = original;
    w.openInvoiceOperational = wrapped;
  }

  // Die Umleitung von cancel_invoice und create_credit_note auf
  // invoice-financial-action steht seit Welle 1 in shared/core/admin-api.js.

  function install() {
    ensureModal();
    installDetailHook();
    w.openInvoiceFinancialAction = openModal;
    w.closeInvoiceFinancialAction = closeModal;
  }

  ready(()=>{
    install();
    setTimeout(install,250);
    setTimeout(install,1200);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
