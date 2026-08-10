(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const lower = value => String(value || '').trim().toLowerCase();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rawOf = row => row && row.raw && typeof row.raw === 'object' ? row.raw : (row || {});
  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once:true });
  let patchScheduled = false;

  function localDateTime(value) {
    const date = value ? new Date(value) : new Date(Date.now() + 86400000);
    if (Number.isNaN(date.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
  }

  function caseType(row) {
    const raw = rawOf(row);
    return lower(row?.caseType || row?.case_type || raw.case_type || 'internal_task');
  }

  function followUpEvidence(row) {
    const raw = rawOf(row);
    const scope = lower(row?.queue_scope || raw.queue_scope);
    if (scope === 'customer_followup') return true;
    const type = caseType(row);
    if (type === 'customer_support' || type === 'assistant_change') return false;
    const source = lower(row?.source || raw.source);
    const origin = lower(row?.origin_channel || raw.origin_channel);
    if (scope === 'admin' && ['admin_portal','manual_admin','operations'].includes(source)) return false;
    const legacyType = lower(row?.type || raw.type);
    const text = lower(`${row?.title || raw.title || ''} ${row?.note || row?.notes || raw.note || raw.notes || ''}`);
    if (/customer[_ -]?(task|follow)|call[_ -]?follow|callback|follow[_ -]?up/.test(`${source} ${origin} ${legacyType}`)) return true;
    if (origin === 'customer_dashboard' || source.startsWith('customer_portal')) return true;
    const callRef = Boolean(raw.call_id || raw.conversation_id || row?.call_id || row?.conversation_id);
    const phone = Boolean(raw.phone || row?.phone);
    return (callRef || phone) && /follow[ -]?up|rückruf|callback|zurückrufen|anruf.?nachfassen/.test(text);
  }

  function isAdminCase(row) {
    const type = caseType(row);
    if (!['internal_task','customer_support','assistant_change'].includes(type)) return false;
    return type !== 'internal_task' || !followUpEvidence(row);
  }

  function purgeCases() {
    if (w.state && Array.isArray(w.state.cases)) w.state.cases = w.state.cases.filter(isAdminCase);
  }

  // Die Stilregeln dieser Datei stehen seit Welle 2 Teil 3 in
  // shared/admin-screens.css. Die Funktion addCss() und ihr Aufruf sind
  // entfallen -- ein zur Laufzeit eingefuegtes Stylesheet gewann nur deshalb,
  // weil es zuletzt kam, und brauchte dafuer !important.

  function ensureDueField() {
    const form = document.getElementById('case-capture-form');
    if (!form || document.getElementById('case-capture-due-at')) return;
    const noteBlock = document.getElementById('case-capture-note')?.closest('div');
    const block = document.createElement('div');
    block.className = 'vox-case-due-grid';
    block.innerHTML = `<div><label for="case-capture-due-at">Fällig am</label><input class="input" id="case-capture-due-at" type="datetime-local" required></div><div class="vox-case-due-quick"><button class="btn btn-quiet btn-sm" type="button" data-hours="24">24 Std.</button><button class="btn btn-quiet btn-sm" type="button" data-hours="72">3 Tage</button><button class="btn btn-quiet btn-sm" type="button" data-hours="168">7 Tage</button></div>`;
    form.insertBefore(block, noteBlock || form.lastElementChild);
    block.querySelectorAll('[data-hours]').forEach(button => button.addEventListener('click', () => {
      document.getElementById('case-capture-due-at').value = localDateTime(new Date(Date.now() + Number(button.dataset.hours) * 3600000));
    }));
  }

  function resetDue() {
    ensureDueField();
    const input = document.getElementById('case-capture-due-at');
    if (input) input.value = localDateTime(new Date(Date.now() + 86400000));
  }

  function dueIso() {
    const date = new Date(document.getElementById('case-capture-due-at')?.value || Date.now() + 86400000);
    return Number.isNaN(date.getTime()) ? new Date(Date.now() + 86400000).toISOString() : date.toISOString();
  }

  async function createAdminCase(customerId, title, note) {
    const json = await w.callAdminFunction('cases-create-admin', { customer_id:customerId, title, note, due_at:dueIso() });
    if (!json?.success || !json?.case) throw new Error(json?.error || 'Case konnte nicht erstellt werden.');
    const mapped = typeof w.mapDbCaseToUi === 'function' ? w.mapDbCaseToUi(json.case) : json.case;
    Object.assign(mapped, json.case, { raw:json.case, caseType:'internal_task', queue_scope:'admin' });
    w.state.cases = (w.state.cases || []).filter(item => String(item.id) !== String(mapped.id));
    w.state.cases.unshift(mapped);
    purgeCases();
    if (typeof w.refreshCustomerCaseCounts === 'function') w.refreshCustomerCaseCounts();
    if (typeof w.renderAll === 'function') w.renderAll();
    if (typeof w.showToast === 'function') w.showToast('✓ Case gespeichert · Fälligkeit gesetzt.');
    return mapped;
  }

  function enhanceCaseTable() {
    purgeCases();
    const tbody = document.getElementById('cases-all');
    const table = tbody?.closest('table');
    if (!tbody || !table) return;
    const header = table.querySelector('thead tr');
    if (header && !header.querySelector('[data-vox-due-head]')) {
      const th = document.createElement('th'); th.dataset.voxDueHead = '1'; th.textContent = 'Fällig'; header.appendChild(th);
    }
    [...tbody.querySelectorAll('tr')].forEach(tr => {
      if (tr.querySelector('.empty') || tr.querySelector('[data-vox-due-cell]')) return;
      const select = tr.querySelector('select[onchange*="updateCase"]');
      const id = String(select?.getAttribute('onchange') || '').match(/updateCase\(['"]([^'"]+)/)?.[1];
      const row = (w.state.cases || []).find(item => String(item.id) === String(id));
      if (!id || !row) return;
      const raw = rawOf(row); const due = row.due_at || raw.due_at || null;
      const overdue = due && new Date(due).getTime() < Date.now() && !['done','closed','resolved'].includes(lower(row.status));
      const td = document.createElement('td'); td.dataset.voxDueCell = '1'; td.dataset.label = 'Fällig'; td.className = 'vox-case-due-cell';
      td.innerHTML = `<input class="input" type="datetime-local" value="${esc(localDateTime(due))}"><div class="muted" style="margin-top:4px;color:${overdue?'var(--red)':'var(--slate2)'}">${overdue?'Überfällig':'Änderbar'}</div>`;
      td.querySelector('input').addEventListener('change', async event => {
        const parsed = new Date(event.target.value); if (Number.isNaN(parsed.getTime())) return;
        try {
          const json = await w.callAdminFunction('cases-due-update', { case_id:id, due_at:parsed.toISOString() });
          if (!json?.success || !json?.case) throw new Error(json?.error || 'Fälligkeit konnte nicht gespeichert werden.');
          Object.assign(row, json.case, { raw:Object.assign({}, raw, json.case) });
          if (typeof w.showToast === 'function') w.showToast('✓ Fälligkeit aktualisiert.');
        } catch (_) { if (typeof w.showToast === 'function') w.showToast('Fälligkeit konnte nicht gespeichert werden.'); }
      });
      tr.appendChild(td);
    });
  }

  function reminderInfo(invoice) {
    const level = Number(invoice?.reminder_level || 0);
    return {
      level,
      l1: invoice?.reminder_1_sent_at || null,
      l2: invoice?.final_reminder_sent_at || null,
      finalSent: level >= 2
    };
  }

  function normalizeReminderNotes() {
    // Dunning state is canonical DB data. Human notes remain audit text only.
  }

  function dunningState(invoice) {
    if (typeof w.getInvoiceDunningEligibility === 'function') {
      return w.getInvoiceDunningEligibility(invoice);
    }
    return { canRemind:false, stage:'unavailable' };
  }

  function reminderDue(invoice) {
    return Boolean(dunningState(invoice).canRemind);
  }

  function finalWarnings() {
    return (w.state?.invoices || []).filter(invoice => dunningState(invoice).stage === 'suspension_review');
  }

  function setText(node, value) {
    const text = String(value);
    if (node && node.textContent !== text) node.textContent = text;
  }

  async function pauseCustomer(customerId, invoiceId) {
    const customer = typeof w.customerById === 'function' ? w.customerById(customerId) : null;
    if (!customer) return;
    const current = typeof w.getCustomerLifecycleStatus === 'function' ? w.getCustomerLifecycleStatus(customer, typeof w.onboardingForCustomer === 'function' ? w.onboardingForCustomer(customerId) : null) : lower(customer.status);
    if (current === 'paused') { if (typeof w.showToast === 'function') w.showToast('Konto ist bereits pausiert.'); return; }
    const message = `Konto von ${customer.name || 'diesem Kunden'} pausieren? Der Customer-Portal-Zugang wird gesperrt. Die Rechnung bleibt offen und nachvollziehbar.`;
    const confirmed = typeof w.voxConfirm === 'function' ? await w.voxConfirm({ title:'Konto pausieren', message, confirmText:'Konto pausieren', cancelText:'Abbrechen', danger:true }) : w.confirm(message);
    if (!confirmed) return;
    const json = await w.callAdminFunction('customer-status-update', { customer_id:customerId, status:'paused', reason:'billing_final_warning', invoice_id:invoiceId || null });
    if (!json?.success || !json?.customer) throw new Error(json?.error || 'Konto konnte nicht pausiert werden.');
    Object.assign(customer, json.customer, { status:'paused' });
    if (typeof w.renderAll === 'function') w.renderAll();
    if (typeof w.showToast === 'function') w.showToast('✓ Kundenkonto pausiert.');
  }

  function patchBilling() {
    normalizeReminderNotes();
    const due = (w.state?.invoices || []).filter(reminderDue);
    const finals = finalWarnings();
    document.querySelectorAll('.finance-quick-action').forEach(row => {
      if (/Mahn-Worklist/i.test(row.textContent || '')) setText(row.querySelector('.badge'), due.length);
    });
    document.querySelectorAll('.finance-work-item').forEach(row => {
      if (!/Follow-up nötig/i.test(row.textContent || '')) return;
      setText(row.querySelector('.badge'), due.length);
      setText(row.querySelector('.list-sub'), 'Aktuell fällige Mahnungen');
    });
    if (document.getElementById('finance-status-filter')?.value === 'followup') {
      const ids = new Set(due.map(invoice => String(invoice.id)));
      const tbody = document.getElementById('finance-invoice-body');
      [...(tbody?.querySelectorAll('.bf-invoice-row') || [])].forEach(row => {
        const id = String(row.querySelector('[id^="send-btn-"]')?.id || '').replace('send-btn-', '');
        if (!id || ids.has(id)) return;
        const history = row.nextElementSibling?.classList.contains('bf-history-row') ? row.nextElementSibling : null;
        history?.remove(); row.remove();
      });
    }
    const queue = document.getElementById('bf-action-queue');
    if (!queue) return;
    const signature = finals.map(invoice => `${invoice.id}:${invoice.updated_at || invoice.raw?.updated_at || ''}`).join('|');
    const existing = queue.querySelector('[data-vox-escalations]');
    if (existing?.dataset.signature === signature) return;
    existing?.remove();
    if (!finals.length) return;
    queue.querySelectorAll('.bf-empty,.vx-empty-state').forEach(node => node.remove());
    const box = document.createElement('div'); box.dataset.voxEscalations = '1'; box.dataset.signature = signature; box.className = 'vox-escalation-box';
    box.innerHTML = `<div style="font-weight:750;color:#991B1B;margin-bottom:6px">Letzte Warnung versendet · Sperrung prüfen (${finals.length})</div>${finals.map(invoice => {
      const customerId = String(invoice.customer_id || invoice.customerId || invoice.raw?.customer_id || '');
      const customer = typeof w.customerById === 'function' ? w.customerById(customerId) : null;
      return `<div class="vox-escalation-row"><div><strong>${esc(customer?.name || 'Unbekannter Kunde')}</strong><div class="muted">Rechnung ${esc(invoice.invoice_number || invoice.number || String(invoice.id).slice(0,8))} · letzte Warnung protokolliert</div></div><div class="inline-actions"><button class="btn btn-quiet btn-sm" type="button" onclick="openInvoiceOperational('${esc(invoice.id)}','${esc(customerId)}')">Rechnung öffnen</button><button class="btn btn-danger btn-sm" type="button" onclick="VoxeraOperationsV3.pauseCustomer('${esc(customerId)}','${esc(invoice.id)}')">Konto pausieren</button></div></div>`;
    }).join('')}`;
    queue.prepend(box);
  }

  function schedulePatch() {
    if (patchScheduled) return;
    patchScheduled = true;
    setTimeout(() => {
      patchScheduled = false;
      purgeCases(); enhanceCaseTable(); patchBilling();
    }, 20);
  }

  function wrap(name) {
    const current = w[name];
    if (typeof current !== 'function' || current.__voxOpsV3) return;
    const wrapped = function () {
      purgeCases(); normalizeReminderNotes();
      const result = current.apply(this, arguments);
      purgeCases(); schedulePatch();
      return result;
    };
    wrapped.__voxOpsV3 = true;
    w[name] = wrapped;
  }

  function install() {
    ensureDueField(); purgeCases();
    const open = w.openCaseCaptureModal;
    if (typeof open === 'function' && !open.__voxOpsV3) {
      const wrapped = function () { const result = open.apply(this, arguments); resetDue(); return result; };
      wrapped.__voxOpsV3 = true; w.openCaseCaptureModal = wrapped;
    }
    w.createCaseForCustomer = async function (customerId, title, note) {
      try { return await createAdminCase(customerId, title, note); }
      catch (error) { if (typeof w.setCaseCaptureFeedback === 'function') w.setCaseCaptureFeedback('error', error?.message || 'Case konnte nicht gespeichert werden.'); throw error; }
    };
    const load = w.loadDataFromSupabase;
    if (typeof load === 'function' && !load.__voxOpsV3) {
      const wrapped = async function () { const result = await load.apply(this, arguments); purgeCases(); normalizeReminderNotes(); return result; };
      wrapped.__voxOpsV3 = true; w.loadDataFromSupabase = wrapped;
    }
    ['renderCases','renderAll','renderOverview','renderBillingFinance','renderActionQueue','renderCustomers','renderCustomerWorkspace','renderOnboarding'].forEach(wrap);
  }

  w.VoxeraOperationsV3 = Object.freeze({ isAdminCase, purgeCases, reminderDue, pauseCustomer });

  ready(() => {
    install(); resetDue(); normalizeReminderNotes(); schedulePatch();
    setTimeout(() => { install(); schedulePatch(); }, 500);
    setTimeout(() => { install(); schedulePatch(); }, 1500);
    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.querySelector('.main') || document.body, { childList:true, subtree:true });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
