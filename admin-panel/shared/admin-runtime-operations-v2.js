(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const lower = value => String(value || '').trim().toLowerCase();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
  const rawOf = row => row && row.raw && typeof row.raw === 'object' ? row.raw : (row || {});
  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once:true });

  function toLocalInputValue(value) {
    const date = value ? new Date(value) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (Number.isNaN(date.getTime())) return '';
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function dueIsoFromInput() {
    const value = document.getElementById('case-capture-due-at')?.value || '';
    if (!value) return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : parsed.toISOString();
  }

  function caseType(row) {
    const raw = rawOf(row);
    return lower(row?.caseType || row?.case_type || raw.case_type || 'internal_task');
  }

  function queueScope(row) {
    const raw = rawOf(row);
    return lower(row?.queue_scope || row?.queueScope || raw.queue_scope || '');
  }

  function isCustomerFollowUp(row) {
    const raw = rawOf(row);
    const scope = queueScope(row);
    if (scope === 'customer_followup') return true;
    if (scope === 'admin') return false;

    const type = caseType(row);
    if (type === 'customer_support' || type === 'assistant_change') return false;
    const source = lower(row?.source || raw.source);
    const origin = lower(row?.origin_channel || raw.origin_channel);
    const legacyType = lower(row?.type || raw.type);
    const title = lower(row?.title || raw.title);
    const note = lower(row?.note || row?.notes || raw.note || raw.notes);
    const direct = `${source} ${origin} ${legacyType}`;
    if (/customer[_ -]?(task|follow)|call[_ -]?follow|callback|follow[_ -]?up/.test(direct)) return true;
    if (origin === 'customer_dashboard' || source.startsWith('customer_portal')) return true;
    const hasCallRef = Boolean(raw.call_id || raw.conversation_id || row?.call_id || row?.conversation_id);
    const hasPhone = Boolean(raw.phone || row?.phone);
    const followLanguage = /follow[ -]?up|rückruf|callback|zurückrufen|anruf.?nachfassen/.test(`${title} ${note}`);
    return (hasCallRef && (hasPhone || followLanguage)) || (hasPhone && followLanguage);
  }

  function isAdminCase(row) {
    const scope = queueScope(row);
    if (scope === 'customer_followup') return false;
    const type = caseType(row);
    if (!['internal_task','customer_support','assistant_change'].includes(type)) return false;
    if (type === 'internal_task' && isCustomerFollowUp(row)) return false;
    return true;
  }

  function purgeAdminCaseState() {
    if (!w.state || !Array.isArray(w.state.cases)) return;
    w.state.cases = w.state.cases.filter(isAdminCase);
  }

  function addCss() {
    if (document.getElementById('voxera-operations-v2-css')) return;
    const style = document.createElement('style');
    style.id = 'voxera-operations-v2-css';
    style.textContent = `
      #case-capture-modal .modal{max-width:620px!important;border-radius:18px!important;padding:0!important;overflow:hidden!important;border:1px solid var(--line)!important;box-shadow:0 24px 70px rgba(13,31,60,.22)!important}
      #case-capture-modal .modal-top{padding:18px 20px!important;margin:0!important;border-bottom:1px solid var(--line)!important;background:linear-gradient(180deg,#fff 0%,#F8FAFC 100%)!important}
      #case-capture-modal .modal-title{font-family:var(--font-display)!important;font-size:18px!important;color:var(--ink)!important}
      #case-capture-modal .modal-sub{color:var(--slate)!important;margin-top:3px!important}
      #case-capture-modal #case-capture-feedback{margin:14px 20px 0!important}
      #case-capture-modal form{padding:18px 20px 20px!important;display:grid!important;gap:14px!important}
      #case-capture-modal form>div{margin:0!important}
      #case-capture-modal label{display:block!important;font-size:11px!important;font-weight:700!important;letter-spacing:.055em!important;text-transform:uppercase!important;color:var(--slate2)!important;margin-bottom:6px!important}
      #case-capture-modal .input,#case-capture-modal .select,#case-capture-modal .textarea{width:100%!important;min-height:42px!important;border:1px solid var(--line)!important;border-radius:10px!important;background:#fff!important;padding:10px 12px!important;font:inherit!important;color:var(--ink)!important;box-shadow:0 1px 2px rgba(15,23,42,.03)!important}
      #case-capture-modal .textarea{min-height:110px!important;resize:vertical!important}
      #case-capture-modal .input:focus,#case-capture-modal .select:focus,#case-capture-modal .textarea:focus,#reminder-modal-note:focus{outline:none!important;border-color:var(--blue)!important;box-shadow:0 0 0 3px rgba(26,111,232,.12)!important}
      .vox-case-due-grid{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end}
      .vox-case-due-quick{display:flex;gap:6px;flex-wrap:wrap}
      .vox-case-due-quick button{min-height:42px}
      #reminder-modal .billing-dialog-field{background:#F8FAFC!important;border:1px solid var(--line)!important;border-radius:12px!important;padding:12px 14px!important}
      #reminder-modal-note{display:block!important;width:100%!important;min-height:96px!important;border:1px solid #D8DEE9!important;border-radius:10px!important;background:#fff!important;padding:11px 12px!important;font:inherit!important;line-height:1.45!important;color:var(--ink)!important;resize:vertical!important}
      .vox-case-due-cell{min-width:185px}
      .vox-case-due-cell input{width:100%;min-width:0}
      .vox-escalation-box{border:1px solid #F4C7C7;background:#FFF7F7;border-radius:12px;margin:10px 0;padding:12px 14px}
      .vox-escalation-row{display:flex;gap:12px;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #F8DADA}
      .vox-escalation-row:last-child{border-bottom:0}
      @media(max-width:768px){
        #case-capture-modal .modal{width:calc(100vw - 20px)!important;max-height:calc(100dvh - 20px)!important}
        #case-capture-modal form{padding:14px!important}
        .vox-case-due-grid{grid-template-columns:1fr}
        .vox-case-due-quick button{flex:1}
        .vox-escalation-row{align-items:stretch;flex-direction:column}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureCaseDueField() {
    const form = document.getElementById('case-capture-form');
    if (!form || document.getElementById('case-capture-due-at')) return;
    const noteBlock = document.getElementById('case-capture-note')?.closest('div');
    const block = document.createElement('div');
    block.className = 'vox-case-due-grid';
    block.innerHTML = `<div><label for="case-capture-due-at">Fällig am</label><input class="input" id="case-capture-due-at" type="datetime-local" required></div><div class="vox-case-due-quick"><button class="btn btn-quiet btn-sm" type="button" data-case-offset="24">24 Std.</button><button class="btn btn-quiet btn-sm" type="button" data-case-offset="72">3 Tage</button><button class="btn btn-quiet btn-sm" type="button" data-case-offset="168">7 Tage</button></div>`;
    if (noteBlock) form.insertBefore(block, noteBlock);
    else form.insertBefore(block, form.lastElementChild);
    block.querySelectorAll('[data-case-offset]').forEach(button => button.addEventListener('click', () => {
      const hours = Number(button.dataset.caseOffset || 24);
      document.getElementById('case-capture-due-at').value = toLocalInputValue(new Date(Date.now() + hours * 60 * 60 * 1000));
    }));
  }

  function resetCaseDueField() {
    ensureCaseDueField();
    const input = document.getElementById('case-capture-due-at');
    if (input) input.value = toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
  }

  async function createAdminCase(customerId, title, note) {
    const customer = typeof w.customerById === 'function' ? w.customerById(customerId) : null;
    if (!customer) throw new Error('Kunde nicht gefunden.');
    const json = await w.callAdminFunction('cases-create-admin', {
      customer_id: customerId,
      title,
      note,
      due_at: dueIsoFromInput()
    });
    if (!json?.success || !json?.case) throw new Error(json?.error || 'Case konnte nicht erstellt werden.');
    const mapped = typeof w.mapDbCaseToUi === 'function' ? w.mapDbCaseToUi(json.case) : json.case;
    Object.assign(mapped, json.case, { raw: json.case, caseType:'internal_task', queue_scope:'admin' });
    w.state.cases = (w.state.cases || []).filter(existing => String(existing.id) !== String(mapped.id));
    w.state.cases.unshift(mapped);
    purgeAdminCaseState();
    if (typeof w.refreshCustomerCaseCounts === 'function') w.refreshCustomerCaseCounts();
    if (typeof w.renderAll === 'function') w.renderAll();
    if (typeof w.showToast === 'function') w.showToast('✓ Case gespeichert · Fälligkeit gesetzt.');
    return mapped;
  }

  function dueValue(row) {
    const raw = rawOf(row);
    return row?.due_at || row?.dueAt || raw.due_at || null;
  }

  function enhanceCaseTable() {
    purgeAdminCaseState();
    const tbody = document.getElementById('cases-all');
    const table = tbody?.closest('table');
    if (!tbody || !table) return;
    const header = table.querySelector('thead tr');
    if (header && !header.querySelector('[data-vox-due-head]')) {
      const th = document.createElement('th');
      th.dataset.voxDueHead = '1';
      th.textContent = 'Fällig';
      header.appendChild(th);
    }
    [...tbody.querySelectorAll('tr')].forEach(tr => {
      if (tr.querySelector('.empty') || tr.querySelector('[data-vox-due-cell]')) return;
      const statusSelect = tr.querySelector('select[onchange*="updateCase"]');
      const match = String(statusSelect?.getAttribute('onchange') || '').match(/updateCase\(['"]([^'"]+)/);
      const id = match?.[1];
      if (!id) return;
      const row = (w.state.cases || []).find(item => String(item.id) === String(id));
      if (!row) return;
      const td = document.createElement('td');
      td.dataset.voxDueCell = '1';
      td.dataset.label = 'Fällig';
      td.className = 'vox-case-due-cell';
      const due = dueValue(row);
      const overdue = due && new Date(due).getTime() < Date.now() && !['done','closed','resolved'].includes(lower(row.status));
      td.innerHTML = `<input class="input" type="datetime-local" value="${esc(toLocalInputValue(due))}" aria-label="Fälligkeit ändern"><div class="muted" style="margin-top:4px;color:${overdue?'var(--red)':'var(--slate2)'}">${overdue?'Überfällig':'Änderbar'}</div>`;
      td.querySelector('input').addEventListener('change', async event => {
        const parsed = new Date(event.target.value);
        if (Number.isNaN(parsed.getTime())) return;
        try {
          const json = await w.callAdminFunction('cases-due-update', { case_id:id, due_at:parsed.toISOString() });
          if (!json?.success || !json?.case) throw new Error(json?.error || 'Fälligkeit konnte nicht gespeichert werden.');
          Object.assign(row, json.case, { raw:Object.assign({}, rawOf(row), json.case) });
          if (typeof w.showToast === 'function') w.showToast('✓ Fälligkeit aktualisiert.');
          enhanceCaseTable();
        } catch (error) {
          if (typeof w.showToast === 'function') w.showToast('Fälligkeit konnte nicht gespeichert werden.');
        }
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

  function reminderIsDue(invoice) {
    const status = lower(invoice?.status || invoice?.payment_status);
    if (!['open','sent','overdue'].includes(status)) return false;
    const dueRaw = invoice?.due_at || invoice?.due_date || invoice?.invoice_due_date;
    const due = dueRaw ? new Date(dueRaw) : null;
    if (!due || Number.isNaN(due.getTime())) return false;
    const info = reminderInfo(invoice);
    if (info.finalSent) return false;
    const now = Date.now();
    if (info.l1) {
      const l1Date = new Date(info.l1);
      return !Number.isNaN(l1Date.getTime()) && now - l1Date.getTime() >= 7 * 24 * 60 * 60 * 1000;
    }
    return now - due.getTime() >= 7 * 24 * 60 * 60 * 1000;
  }

  function finalWarningRows() {
    return (w.state?.invoices || []).filter(invoice => {
      const status = lower(invoice?.status || invoice?.payment_status);
      return !['paid','cancelled','void'].includes(status) && reminderInfo(invoice).finalSent;
    });
  }

  async function pauseCustomer(customerId, invoiceId) {
    const customer = typeof w.customerById === 'function' ? w.customerById(customerId) : null;
    if (!customer) return;
    const current = typeof w.getCustomerLifecycleStatus === 'function'
      ? w.getCustomerLifecycleStatus(customer, typeof w.onboardingForCustomer === 'function' ? w.onboardingForCustomer(customerId) : null)
      : lower(customer.status);
    if (current === 'paused') {
      if (typeof w.showToast === 'function') w.showToast('Konto ist bereits pausiert.');
      return;
    }
    const message = `Konto von ${customer.name || 'diesem Kunden'} pausieren? Der Customer-Portal-Zugang wird gesperrt. Die Rechnung bleibt offen und nachvollziehbar.`;
    const confirmed = typeof w.voxConfirm === 'function'
      ? await w.voxConfirm({ title:'Konto pausieren', message, confirmText:'Konto pausieren', cancelText:'Abbrechen', danger:true })
      : w.confirm(message);
    if (!confirmed) return;
    const json = await w.callAdminFunction('customer-status-update', { customer_id:customerId, status:'paused', reason:'billing_final_warning', invoice_id:invoiceId || null });
    if (!json?.success || !json?.customer) throw new Error(json?.error || 'Konto konnte nicht pausiert werden.');
    Object.assign(customer, json.customer, { status:'paused' });
    if (typeof w.renderAll === 'function') w.renderAll();
    if (typeof w.showToast === 'function') w.showToast('✓ Kundenkonto pausiert.');
  }

  function patchBillingDom() {
    normalizeReminderNotes();
    const dueRows = (w.state?.invoices || []).filter(reminderIsDue);
    const finalRows = finalWarningRows();

    document.querySelectorAll('.finance-quick-action').forEach(row => {
      if (!/Mahn-Worklist/i.test(row.textContent || '')) return;
      const badge = row.querySelector('.badge');
      if (badge) badge.textContent = String(dueRows.length);
    });
    document.querySelectorAll('.finance-work-item').forEach(row => {
      if (!/Follow-up nötig/i.test(row.textContent || '')) return;
      const badge = row.querySelector('.badge');
      if (badge) badge.textContent = String(dueRows.length);
      const sub = row.querySelector('.list-sub');
      if (sub) sub.textContent = 'Aktuell fällige Mahnungen';
    });

    if (document.getElementById('finance-status-filter')?.value === 'followup') {
      const dueIds = new Set(dueRows.map(invoice => String(invoice.id)));
      const tbody = document.getElementById('finance-invoice-body');
      [...(tbody?.querySelectorAll('.bf-invoice-row') || [])].forEach(row => {
        const send = row.querySelector('[id^="send-btn-"]');
        const id = String(send?.id || '').replace('send-btn-', '');
        if (!id || dueIds.has(id)) return;
        const history = row.nextElementSibling?.classList.contains('bf-history-row') ? row.nextElementSibling : null;
        history?.remove();
        row.remove();
      });
    }

    const queue = document.getElementById('bf-action-queue');
    queue?.querySelector('[data-vox-escalations]')?.remove();
    if (queue && finalRows.length) {
      const box = document.createElement('div');
      box.dataset.voxEscalations = '1';
      box.className = 'vox-escalation-box';
      box.innerHTML = `<div style="font-weight:750;color:#991B1B;margin-bottom:6px">Letzte Warnung versendet · Sperrung prüfen (${finalRows.length})</div>${finalRows.map(invoice => {
        const customerId = String(invoice.customer_id || invoice.customerId || invoice.raw?.customer_id || '');
        const customer = typeof w.customerById === 'function' ? w.customerById(customerId) : null;
        return `<div class="vox-escalation-row"><div><strong>${esc(customer?.name || 'Unbekannter Kunde')}</strong><div class="muted">Rechnung ${esc(invoice.invoice_number || invoice.number || String(invoice.id).slice(0,8))} · letzte Warnung protokolliert</div></div><div class="inline-actions"><button class="btn btn-quiet btn-sm" type="button" onclick="openInvoiceOperational('${esc(invoice.id)}','${esc(customerId)}')">Rechnung öffnen</button><button class="btn btn-danger btn-sm" type="button" onclick="VoxeraOperationsV2.pauseCustomer('${esc(customerId)}','${esc(invoice.id)}')">Konto pausieren</button></div></div>`;
      }).join('')}`;
      queue.prepend(box);
    }
  }

  function wrapRender(name, after) {
    const current = w[name];
    if (typeof current !== 'function' || current.__voxOpsV2) return;
    const wrapped = function () {
      purgeAdminCaseState();
      normalizeReminderNotes();
      const result = current.apply(this, arguments);
      purgeAdminCaseState();
      if (after) setTimeout(after, 0);
      return result;
    };
    wrapped.__voxOpsV2 = true;
    w[name] = wrapped;
  }

  function install() {
    addCss();
    ensureCaseDueField();
    purgeAdminCaseState();

    const originalOpen = w.openCaseCaptureModal;
    if (typeof originalOpen === 'function' && !originalOpen.__voxOpsV2) {
      const wrappedOpen = function () {
        const result = originalOpen.apply(this, arguments);
        resetCaseDueField();
        return result;
      };
      wrappedOpen.__voxOpsV2 = true;
      w.openCaseCaptureModal = wrappedOpen;
    }

    w.createCaseForCustomer = async function (customerId, title, note) {
      try {
        return await createAdminCase(customerId, title, note);
      } catch (error) {
        if (typeof w.setCaseCaptureFeedback === 'function') w.setCaseCaptureFeedback('error', error?.message || 'Case konnte nicht gespeichert werden.');
        throw error;
      }
    };

    const originalLoad = w.loadDataFromSupabase;
    if (typeof originalLoad === 'function' && !originalLoad.__voxOpsV2) {
      const wrappedLoad = async function () {
        const result = await originalLoad.apply(this, arguments);
        purgeAdminCaseState();
        normalizeReminderNotes();
        return result;
      };
      wrappedLoad.__voxOpsV2 = true;
      w.loadDataFromSupabase = wrappedLoad;
    }

    wrapRender('renderCases', enhanceCaseTable);
    wrapRender('renderAll', () => { enhanceCaseTable(); patchBillingDom(); });
    wrapRender('renderOverview', patchBillingDom);
    wrapRender('renderBillingFinance', patchBillingDom);
    wrapRender('renderActionQueue', patchBillingDom);
  }

  w.VoxeraOperationsV2 = Object.freeze({
    isAdminCase,
    purgeAdminCaseState,
    reminderIsDue,
    pauseCustomer
  });

  ready(() => {
    install();
    resetCaseDueField();
    normalizeReminderNotes();
    setTimeout(() => { install(); enhanceCaseTable(); patchBillingDom(); }, 400);
    setTimeout(() => { install(); purgeAdminCaseState(); enhanceCaseTable(); patchBillingDom(); }, 1400);
    const observer = new MutationObserver(() => setTimeout(() => { enhanceCaseTable(); patchBillingDom(); }, 20));
    observer.observe(document.querySelector('.main') || document.body, { childList:true, subtree:true });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
