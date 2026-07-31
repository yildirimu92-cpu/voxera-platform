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

  function addCss() {
    if (document.getElementById('voxera-ops-v3-css')) return;
    const style = document.createElement('style');
    style.id = 'voxera-ops-v3-css';
    style.textContent = `
      #case-capture-modal .modal{max-width:620px!important;border-radius:18px!important;padding:0!important;overflow:hidden!important;border:1px solid var(--line)!important;box-shadow:0 24px 70px rgba(13,31,60,.22)!important}
      #case-capture-modal .modal-top{padding:18px 20px!important;margin:0!important;border-bottom:1px solid var(--line)!important;background:linear-gradient(180deg,#fff,#F8FAFC)!important}
      #case-capture-modal .modal-title{font-family:var(--font-display)!important;font-size:18px!important;color:var(--ink)!important}
      #case-capture-modal .modal-sub{color:var(--slate)!important;margin-top:3px!important}
      #case-capture-modal #case-capture-feedback{margin:14px 20px 0!important}
      #case-capture-modal form{padding:18px 20px 20px!important;display:grid!important;gap:14px!important}
      #case-capture-modal form>div{margin:0!important}
      #case-capture-modal label{display:block!important;font-size:11px!important;font-weight:700!important;letter-spacing:.055em!important;text-transform:uppercase!important;color:var(--slate2)!important;margin-bottom:6px!important}
      #case-capture-modal .input,#case-capture-modal .select,#case-capture-modal .textarea{width:100%!important;min-height:42px!important;border:1px solid var(--line)!important;border-radius:10px!important;background:#fff!important;padding:10px 12px!important;font:inherit!important;color:var(--ink)!important}
      #case-capture-modal .textarea{min-height:110px!important;resize:vertical!important}
      #case-capture-modal .input:focus,#case-capture-modal .select:focus,#case-capture-modal .textarea:focus,#reminder-modal-note:focus{outline:none!important;border-color:var(--blue)!important;box-shadow:0 0 0 3px rgba(26,111,232,.12)!important}
      .vox-case-due-grid{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end}
      .vox-case-due-quick{display:flex;gap:6px;flex-wrap:wrap}.vox-case-due-quick button{min-height:42px}
      #reminder-modal .billing-dialog-field{background:#F8FAFC!important;border:1px solid var(--line)!important;border-radius:12px!important;padding:12px 14px!important}
      #reminder-modal-note{display:block!important;width:100%!important;min-height:96px!important;border:1px solid #D8DEE9!important;border-radius:10px!important;background:#fff!important;padding:11px 12px!important;font:inherit!important;line-height:1.45!important;color:var(--ink)!important;resize:vertical!important}
      .vox-case-due-cell{min-width:185px}.vox-case-due-cell input{width:100%;min-width:0}
      .vox-escalation-box{border:1px solid #F4C7C7;background:#FFF7F7;border-radius:12px;margin:10px 0;padding:12px 14px}
      .vox-escalation-row{display:flex;gap:12px;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #F8DADA}.vox-escalation-row:last-child{border-bottom:0}
      @media(max-width:768px){#case-capture-modal .modal{width:calc(100vw - 20px)!important;max-height:calc(100dvh - 20px)!important}.vox-case-due-grid{grid-template-columns:1fr}.vox-case-due-quick button{flex:1}.vox-escalation-row{align-items:stretch;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

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
    const notes = String(invoice?.notes || invoice?.raw?.notes || '');
    const l1 = [...notes.matchAll(/\[REMINDER L1 ([^\]]+)\]/g)].pop()?.[1] || null;
    const l2 = [...notes.matchAll(/\[(?:REMINDER L2|REMINDER_FINAL) ([^\]]+)\]/g)].pop()?.[1] || null;
    return { notes, l1, l2, finalSent:Boolean(l2) };
  }

  function normalizeReminderNotes() {
    (w.state?.invoices || []).forEach(invoice => {
      const notes = String(invoice.notes || invoice.raw?.notes || '');
      if (notes.includes('[REMINDER_FINAL')) return;
      const match = [...notes.matchAll(/\[REMINDER L2 ([^\]]+)\]/g)].pop();
      if (!match) return;
      const normalized = `${notes}\n[REMINDER_FINAL ${match[1]}]`.trim();
      invoice.notes = normalized;
      if (invoice.raw && typeof invoice.raw === 'object') invoice.raw.notes = normalized;
    });
  }

  function reminderDue(invoice) {
    const status = lower(invoice?.status || invoice?.payment_status);
    if (!['open','sent','overdue'].includes(status)) return false;
    const due = new Date(invoice?.due_at || invoice?.due_date || invoice?.invoice_due_date || '');
    if (Number.isNaN(due.getTime())) return false;
    const info = reminderInfo(invoice);
    if (info.finalSent) return false;
    if (!info.l1) return Date.now() - due.getTime() >= 7 * 86400000;
    const l1 = new Date(info.l1);
    return !Number.isNaN(l1.getTime()) && Date.now() - l1.getTime() >= 7 * 86400000;
  }

  function finalWarnings() {
    return (w.state?.invoices || []).filter(invoice => {
      const status = lower(invoice?.status || invoice?.payment_status);
      return !['paid','cancelled','void'].includes(status) && reminderInfo(invoice).finalSent;
    });
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
    addCss(); ensureDueField(); purgeCases();
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
