(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const lower = value => String(value || '').trim().toLowerCase();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
  const rawOf = row => row && row.raw && typeof row.raw === 'object' ? row.raw : (row || {});

  function appState() {
    try {
      if (typeof state !== 'undefined' && state && typeof state === 'object') return state;
    } catch (_error) {}
    return w.state && typeof w.state === 'object' ? w.state : null;
  }

  function exposeStateCompatibility() {
    const current = appState();
    if (current && w.state !== current) w.state = current;
    return current;
  }

  function caseType(row) {
    const raw = rawOf(row);
    return lower(row?.caseType || row?.case_type || raw.case_type || 'internal_task');
  }

  function queueScope(row) {
    const raw = rawOf(row);
    return lower(row?.queue_scope || raw.queue_scope);
  }

  function caseSource(row) {
    const raw = rawOf(row);
    return lower(row?.source || raw.source);
  }

  function caseCustomerId(row) {
    const raw = rawOf(row);
    return String(row?.customerId || row?.customer_id || raw.customer_id || '');
  }

  function isAdminQueueCase(row) {
    const raw = rawOf(row);
    const type = caseType(row);
    const scope = queueScope(row);
    const source = caseSource(row);
    const origin = lower(row?.origin_channel || raw.origin_channel);
    const legacyType = lower(row?.type || raw.type);

    if (scope === 'customer_followup') return false;
    if (type === 'customer_support' || type === 'assistant_change') return true;
    if (type !== 'internal_task') return false;

    // An explicit queue scope is authoritative. In particular, a due date on an
    // Admin case must never make the record look like a Customer follow-up.
    if (scope === 'admin') return true;

    if (source.startsWith('customer_portal') || origin === 'customer_portal' || origin === 'customer_dashboard') return false;
    if (/customer[_ -]?(task|follow)|call[_ -]?follow|callback|follow[_ -]?up/.test(`${source} ${origin} ${legacyType}`)) return false;

    const title = lower(row?.title || raw.title);
    const note = lower(row?.note || row?.notes || raw.note || raw.notes);
    const callReference = Boolean(
      row?.call_id || raw.call_id || row?.conversation_id || raw.conversation_id ||
      row?.phone || raw.phone || row?.callback_at || raw.callback_at
    );
    if (callReference && /follow[ -]?up|rückruf|callback|zurückrufen|anruf.?nachfassen/.test(`${title} ${note}`)) return false;

    return ['', 'admin', 'admin_portal', 'manual_admin', 'internal', 'operations'].includes(source);
  }

  function stripCustomerFollowups() {
    const current = exposeStateCompatibility();
    if (!current || !Array.isArray(current.cases)) return [];
    current.cases = current.cases.filter(isAdminQueueCase);
    return current.cases;
  }

  function normalizeStatus(value) {
    const key = lower(value).replace(/\s+/g, '_');
    if (key === 'in_bearbeitung') return 'in_progress';
    if (key === 'wartend') return 'waiting';
    if (['erledigt', 'geschlossen', 'closed'].includes(key)) return 'done';
    return ['open', 'in_progress', 'waiting', 'done'].includes(key) ? key : 'open';
  }

  function statusOptions(row) {
    const current = normalizeStatus(row?.status);
    const labels = {
      open: 'Offen',
      in_progress: 'In Bearbeitung',
      waiting: 'Wartend',
      done: 'Erledigt'
    };
    return Object.keys(labels)
      .map(status => `<option value="${status}" ${status === current ? 'selected' : ''}>${labels[status]}</option>`)
      .join('');
  }

  function typeMeta(type) {
    if (type === 'customer_support') return { label:'Support', cls:'badge-red' };
    if (type === 'assistant_change') return { label:'Assistent', cls:'badge-blue' };
    return { label:'Intern', cls:'badge-gray' };
  }

  function localDateTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const p = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
  }

  function customerFor(id) {
    if (typeof w.customerById === 'function') return w.customerById(id);
    try {
      if (typeof customerById === 'function') return customerById(id);
    } catch (_error) {}
    return null;
  }

  function renderCasesFixed() {
    const current = exposeStateCompatibility();
    const tbody = document.getElementById('cases-all');
    if (!current || !tbody) return;

    const search = lower(document.getElementById('cases-search')?.value);
    const typeFilter = document.getElementById('cases-type-filter')?.value || 'all';
    const rows = stripCustomerFollowups().filter(row => {
      const type = caseType(row);
      if (typeFilter !== 'all' && type !== typeFilter) return false;
      const customer = customerFor(caseCustomerId(row));
      const raw = rawOf(row);
      const haystack = lower([
        row?.id,
        customer?.name,
        customer?.email,
        row?.title || row?.type,
        row?.note || row?.notes,
        row?.status,
        type,
        row?.source || raw.source
      ].filter(Boolean).join(' '));
      return !search || haystack.includes(search);
    });

    const table = tbody.closest('table');
    const header = table?.querySelector('thead tr');
    if (header && !header.querySelector('[data-vox-due-head]')) {
      const th = document.createElement('th');
      th.dataset.voxDueHead = '1';
      th.textContent = 'Fällig';
      header.appendChild(th);
    }

    tbody.innerHTML = rows.map(row => {
      const customerId = caseCustomerId(row);
      const customer = customerFor(customerId);
      const type = caseType(row);
      const meta = typeMeta(type);
      const raw = rawOf(row);
      const dueAt = row?.due_at || raw.due_at || '';
      const status = normalizeStatus(row?.status);
      const overdue = dueAt && new Date(dueAt).getTime() < Date.now() && status !== 'done';
      const action = type === 'assistant_change'
        ? `<button class="btn btn-primary btn-sm" onclick="openOperationalAssistantCase('${esc(customerId)}')">Assistent öffnen</button>`
        : `<button class="btn btn-quiet btn-sm" onclick="openCustomerWorkspace('${esc(customerId)}')">Workspace</button>`;

      return `<tr>
        <td><button class="btn btn-quiet btn-sm" onclick="openCustomerWorkspace('${esc(customerId)}')">${esc(customer?.name || customer?.email || '—')}</button></td>
        <td><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><strong>${esc(row?.title || row?.type || '—')}</strong><span class="badge ${meta.cls}">${meta.label}</span></div><div class="case-source-note">${esc(row?.source || raw.source || 'admin')}</div></td>
        <td class="wrap">${esc(row?.note || row?.notes || '')}</td>
        <td><select class="select" style="height:30px;padding:4px 8px" onchange="updateCase('${esc(row.id)}','status',this.value)">${statusOptions(row)}</select></td>
        <td>${action}</td>
        <td class="vox-case-due-cell" data-vox-due-cell="1" data-label="Fällig"><input class="input" type="datetime-local" value="${esc(localDateTime(dueAt))}" onchange="updateCaseDueFixed('${esc(row.id)}',this.value)"><div class="muted" style="margin-top:4px;color:${overdue ? 'var(--red)' : 'var(--slate2)'}">${overdue ? 'Überfällig' : 'Änderbar'}</div></td>
      </tr>`;
    }).join('') || '<tr><td colspan="6"><div class="empty">Keine internen Cases oder Support-Anfragen für die aktuelle Auswahl.</div></td></tr>';
  }

  function mergeDbCase(dbRow) {
    let mapped = {};
    try {
      if (typeof w.mapDbCaseToUi === 'function') mapped = w.mapDbCaseToUi(dbRow) || {};
      else if (typeof mapDbCaseToUi === 'function') mapped = mapDbCaseToUi(dbRow) || {};
    } catch (_error) {}
    return Object.assign({}, mapped, dbRow, {
      id: dbRow.id,
      customerId: mapped.customerId || dbRow.customer_id,
      caseType: dbRow.case_type || mapped.caseType || 'internal_task',
      raw: Object.assign({}, rawOf(mapped), dbRow)
    });
  }

  async function adminCall(name, payload) {
    if (typeof w.callAdminFunction === 'function') return w.callAdminFunction(name, payload);
    try {
      if (typeof callAdminFunction === 'function') return callAdminFunction(name, payload);
    } catch (_error) {}
    throw new Error('Admin-Funktion ist nicht verfügbar.');
  }

  function refreshCounts() {
    try {
      if (typeof w.refreshCustomerCaseCounts === 'function') w.refreshCustomerCaseCounts();
      else if (typeof refreshCustomerCaseCounts === 'function') refreshCustomerCaseCounts();
    } catch (_error) {}
  }

  function feedback(type, message) {
    try {
      if (typeof w.setCaseCaptureFeedback === 'function') w.setCaseCaptureFeedback(type, message);
      else if (typeof setCaseCaptureFeedback === 'function') setCaseCaptureFeedback(type, message);
    } catch (_error) {}
  }

  async function createCaseFixed(customerId, title, note) {
    const current = exposeStateCompatibility();
    if (!current || !Array.isArray(current.cases)) throw new Error('Case-Daten sind noch nicht geladen.');
    const dueInput = document.getElementById('case-capture-due-at')?.value;
    const parsedDue = dueInput ? new Date(dueInput) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dueAt = Number.isNaN(parsedDue.getTime())
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : parsedDue.toISOString();

    try {
      const json = await adminCall('cases-create-admin', {
        customer_id: String(customerId || ''),
        title: String(title || '').trim(),
        note: String(note || '').trim(),
        due_at: dueAt
      });
      if (!json?.success || !json?.case) throw new Error(json?.error || 'Case konnte nicht erstellt werden.');
      const merged = mergeDbCase(json.case);
      current.cases = current.cases.filter(row => String(row.id) !== String(merged.id));
      current.cases.unshift(merged);
      stripCustomerFollowups();
      refreshCounts();
      renderCasesFixed();
      if (typeof w.showToast === 'function') w.showToast('✓ Case gespeichert · Fälligkeit gesetzt.');
      return merged;
    } catch (error) {
      feedback('error', error?.message || 'Case konnte nicht gespeichert werden.');
      throw error;
    }
  }

  async function updateCaseFixed(caseId, field, value) {
    const current = exposeStateCompatibility();
    if (!current || !Array.isArray(current.cases)) return;
    const target = current.cases.find(row => String(row.id) === String(caseId));
    if (!target) {
      if (typeof w.showToast === 'function') w.showToast('Case konnte nicht aktualisiert werden: nicht gefunden.');
      renderCasesFixed();
      return;
    }

    try {
      const json = await adminCall('cases-update', { case_id:caseId, field, value });
      if (!json?.success || !json?.case) throw new Error(json?.error || 'Case konnte nicht aktualisiert werden.');
      const merged = mergeDbCase(json.case);
      const index = current.cases.findIndex(row => String(row.id) === String(merged.id));
      if (index >= 0) current.cases[index] = merged;
      else current.cases.unshift(merged);
      stripCustomerFollowups();
      refreshCounts();
      renderCasesFixed();
      if (typeof w.showToast === 'function') w.showToast('✓ Case aktualisiert.');
      try {
        if (typeof w.loadAiChangeRequests === 'function') Promise.resolve(w.loadAiChangeRequests()).catch(() => {});
      } catch (_error) {}
      return merged;
    } catch (error) {
      renderCasesFixed();
      if (typeof w.showToast === 'function') w.showToast(error?.message || 'Case konnte nicht aktualisiert werden.');
      throw error;
    }
  }

  async function updateCaseDueFixed(caseId, value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    const current = exposeStateCompatibility();
    const target = current?.cases?.find(row => String(row.id) === String(caseId));
    if (!target) return;
    try {
      const json = await adminCall('cases-due-update', { case_id:caseId, due_at:date.toISOString() });
      if (!json?.success || !json?.case) throw new Error(json?.error || 'Fälligkeit konnte nicht gespeichert werden.');
      const merged = mergeDbCase(json.case);
      const index = current.cases.findIndex(row => String(row.id) === String(merged.id));
      if (index >= 0) current.cases[index] = merged;
      renderCasesFixed();
      if (typeof w.showToast === 'function') w.showToast('✓ Fälligkeit aktualisiert.');
    } catch (error) {
      renderCasesFixed();
      if (typeof w.showToast === 'function') w.showToast(error?.message || 'Fälligkeit konnte nicht gespeichert werden.');
    }
  }

  function install() {
    exposeStateCompatibility();
    stripCustomerFollowups();

    w.VoxeraAdminCases = Object.freeze({
      isAdminQueueCase,
      filter: rows => (Array.isArray(rows) ? rows : []).filter(isAdminQueueCase)
    });
    w.renderCases = renderCasesFixed;
    w.createCaseForCustomer = createCaseFixed;
    w.updateCase = updateCaseFixed;
    w.updateCaseDueFixed = updateCaseDueFixed;

    const currentLoad = w.loadDataFromSupabase;
    if (typeof currentLoad === 'function' && !currentLoad.__voxCasesStateHotfix) {
      const wrapped = async function () {
        const result = await currentLoad.apply(this, arguments);
        exposeStateCompatibility();
        stripCustomerFollowups();
        renderCasesFixed();
        return result;
      };
      wrapped.__voxCasesStateHotfix = true;
      w.loadDataFromSupabase = wrapped;
    }

    const currentRenderAll = w.renderAll;
    if (typeof currentRenderAll === 'function' && !currentRenderAll.__voxCasesStateHotfix) {
      const wrapped = function () {
        const result = currentRenderAll.apply(this, arguments);
        renderCasesFixed();
        return result;
      };
      wrapped.__voxCasesStateHotfix = true;
      w.renderAll = wrapped;
    }

    renderCasesFixed();
  }

  const start = () => {
    install();
    document.getElementById('cases-search')?.addEventListener('input', renderCasesFixed);
    document.getElementById('cases-type-filter')?.addEventListener('change', renderCasesFixed);
    setTimeout(install, 250);
    setTimeout(install, 750);
    setTimeout(install, 1800);
    setTimeout(install, 3000);
  };

  if (document.readyState === 'complete') start();
  else w.addEventListener('load', start, { once:true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
