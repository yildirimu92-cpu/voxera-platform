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

  function addCss() {
    if (document.getElementById('vox-invoice-adjustments-css')) return;
    const style = document.createElement('style');
    style.id = 'vox-invoice-adjustments-css';
    style.textContent = `
      #invoice-adjustment-modal{z-index:420}
      #invoice-adjustment-modal .modal{max-width:720px;padding:0;overflow:hidden;display:flex;flex-direction:column;max-height:var(--modal-max-height)}
      .vox-fin-head{padding:22px 24px;background:linear-gradient(135deg,#081F3D,#0D315E);color:#fff;display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
      .vox-fin-head .modal-title{color:#fff}.vox-fin-head .modal-sub{color:rgba(255,255,255,.68);margin-top:5px}
      .vox-fin-body{padding:20px 24px;overflow:auto;min-height:0}
      .vox-fin-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:16px}
      .vox-fin-kpi{padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
      .vox-fin-kpi span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--slate2);font-weight:700}
      .vox-fin-kpi strong{display:block;margin-top:4px;font-size:14px;color:var(--ink)}
      .vox-fin-action{border:1px solid var(--line);border-radius:14px;padding:15px;margin-top:12px;background:#fff}
      .vox-fin-action h4{font-size:13px;margin:0 0 5px}.vox-fin-action p{font-size:12px;color:var(--slate);margin:0 0 12px}
      .vox-fin-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.vox-fin-grid .full{grid-column:1/-1}
      .vox-fin-grid label{font-size:11px;font-weight:700;color:var(--slate);display:block;margin-bottom:5px}
      .vox-fin-grid input,.vox-fin-grid select,.vox-fin-grid textarea{width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 10px;font:inherit;background:#fff;color:var(--ink)}
      .vox-fin-grid textarea{min-height:72px;resize:vertical}
      .vox-fin-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
      .vox-fin-history{margin-top:16px}.vox-fin-history-row{padding:9px 0;border-bottom:1px solid var(--line2);display:flex;justify-content:space-between;gap:12px;font-size:12px}
      .vox-fin-feedback{margin-top:12px;padding:10px 12px;border-radius:10px;font-size:12px;display:none}.vox-fin-feedback.error{display:block;background:var(--red-light);color:var(--red);border:1px solid var(--red-mid)}.vox-fin-feedback.ok{display:block;background:var(--green-light);color:var(--green-dark);border:1px solid var(--green-mid)}
      @media(max-width:680px){.vox-fin-summary{grid-template-columns:1fr 1fr}.vox-fin-grid{grid-template-columns:1fr}.vox-fin-grid .full{grid-column:auto}.vox-fin-head,.vox-fin-body{padding:18px}.vox-fin-actions .btn{flex:1}}
    `;
    document.head.appendChild(style);
  }

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

  function installLegacyRouting() {
    const original = w.callAdminFunction;
    if (typeof original !== 'function' || original.__voxInvoiceAdjustments) return;
    const routed = function (name,payload) {
      const action = lower(payload?.action);
      if (name === 'customer-billing-update' && action === 'cancel_invoice') {
        return original.call(this,'invoice-financial-action',{
          action:'void_draft',invoice_id:payload.invoice_id,reason:payload.reason || payload.notes || null,
          request_id:payload.request_id || requestId('void_draft')
        });
      }
      if (name === 'customer-billing-update' && action === 'create_credit_note') {
        return original.call(this,'invoice-financial-action',{
          action:'create_credit',invoice_id:payload.invoice_id,amount:payload.amount,reason:payload.reason || payload.description || payload.notes,
          request_id:payload.request_id || requestId('create_credit')
        });
      }
      return original.call(this,name,payload);
    };
    routed.__voxInvoiceAdjustments = true;
    routed.__voxOriginal = original;
    w.callAdminFunction = routed;
  }

  function install() {
    addCss();
    ensureModal();
    installLegacyRouting();
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
