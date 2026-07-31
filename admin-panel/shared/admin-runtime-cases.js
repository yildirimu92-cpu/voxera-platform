(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;
  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once: true });
  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const typeMeta = {
    internal_task: { label: 'Intern', cls: 'badge-gray' },
    customer_support: { label: 'Support', cls: 'badge-red' },
    assistant_change: { label: 'Assistent', cls: 'badge-blue' }
  };

  function caseType(row) {
    return String(row.caseType || row.case_type || row.raw?.case_type || 'internal_task').trim() || 'internal_task';
  }

  async function hydrateMetadata() {
    if (typeof authClient === 'undefined' || !authClient || typeof state === 'undefined') return;
    try {
      const { data, error } = await authClient
        .from('voxera_cases')
        .select('id,case_type,source,source_ref_id,origin_channel,requester_email');
      if (error) {
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes('column') || msg.includes('schema cache')) return;
        throw error;
      }
      const byId = new Map((data || []).map(row => [String(row.id), row]));
      (state.cases || []).forEach(row => Object.assign(row, byId.get(String(row.id)) || {}));
    } catch (error) {
      console.warn('[runtime-cases] metadata:', error?.message || error);
    }
  }

  function openAssistant(customerId) {
    state.aiSelectedCustomerId = String(customerId || '');
    setRoute('ai-setup');
    if (typeof renderAISetup === 'function') renderAISetup();
    setTimeout(() => {
      if (typeof aiShowTab === 'function') aiShowTab('config');
      if (typeof selectAiCustomer === 'function') selectAiCustomer(customerId);
    }, 80);
  }

  function renderOperationalCases() {
    const tbody = document.getElementById('cases-all');
    if (!tbody || typeof state === 'undefined') return;
    const search = (document.getElementById('cases-search')?.value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('cases-type-filter')?.value || 'all';
    const rows = (state.cases || []).filter(row => {
      const type = caseType(row);
      if (typeFilter !== 'all' && type !== typeFilter) return false;
      const customer = typeof customerById === 'function' ? customerById(row.customerId) : null;
      const haystack = `${row.id || ''} ${customer?.name || ''} ${row.title || row.type || ''} ${row.note || row.notes || ''} ${row.status || ''} ${type} ${row.source || ''}`.toLowerCase();
      return !search || haystack.includes(search);
    });

    tbody.innerHTML = rows.map(row => {
      const customer = typeof customerById === 'function' ? customerById(row.customerId) : null;
      const customerName = customer?.name || '—';
      const type = caseType(row);
      const meta = typeMeta[type] || typeMeta.internal_task;
      const normalized = typeof normalizeCaseStatus === 'function' ? normalizeCaseStatus(row.status) : String(row.status || 'open');
      const options = [CASE_STATUS.OPEN, CASE_STATUS.IN_PROGRESS, CASE_STATUS.WAITING, CASE_STATUS.DONE]
        .map(status => `<option value="${status}" ${status === normalized ? 'selected' : ''}>${escHtml(caseStatusLabel(status))}</option>`).join('');
      const action = type === 'assistant_change'
        ? `<button class="btn btn-primary btn-sm" onclick="openOperationalAssistantCase('${escHtml(row.customerId)}')">Assistent öffnen</button>`
        : `<button class="btn btn-quiet btn-sm" onclick="openCustomerWorkspace('${escHtml(row.customerId)}')">Workspace</button>`;
      return `<tr>
        <td><button class="btn btn-quiet btn-sm" onclick="openCustomerWorkspace('${escHtml(row.customerId)}')">${escHtml(customerName)}</button></td>
        <td><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><strong>${escHtml(row.title || row.type || '—')}</strong><span class="badge ${meta.cls}">${meta.label}</span></div><div style="font-size:10px;color:var(--slate2);margin-top:3px">${escHtml(row.source || (type === 'internal_task' ? 'admin' : 'customer_portal'))}</div></td>
        <td class="wrap">${escHtml(row.note || row.notes || '')}</td>
        <td><select class="select" style="height:30px;padding:4px 8px" onchange="updateCase('${escHtml(row.id)}','status',this.value)">${options}</select></td>
        <td>${action}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5"><div class="empty">Keine internen Cases für die aktuelle Auswahl.</div></td></tr>';
  }

  function patchCasesHeader() {
    const section = document.getElementById('section-cases');
    if (!section) return;
    const title = section.querySelector('.section-head h3');
    if (title) title.textContent = 'Cases & Support';
    const button = document.getElementById('cases-create-btn');
    if (button) button.lastChild.textContent = ' Case erfassen';
    const toolbar = section.querySelector('.toolbar');
    if (toolbar && !document.getElementById('cases-type-filter')) {
      const select = document.createElement('select');
      select.className = 'select';
      select.id = 'cases-type-filter';
      select.innerHTML = '<option value="all">Typ: Alle</option><option value="internal_task">Intern</option><option value="customer_support">Support</option><option value="assistant_change">Assistent</option>';
      select.onchange = renderOperationalCases;
      toolbar.insertBefore(select, document.getElementById('cases-reset'));
    }
  }

  function redirectAiRequestsToCases() {
    const card = document.getElementById('ai-change-requests-card');
    const list = document.getElementById('ai-change-requests-list');
    if (!card || !list) return;
    const count = (state.cases || []).filter(row => caseType(row) === 'assistant_change' && normalizeCaseStatus(row.status) !== CASE_STATUS.DONE).length;
    const badge = document.getElementById('ai-change-requests-badge');
    if (badge) { badge.textContent = `${count} offen`; badge.style.display = count ? '' : 'none'; }
    list.innerHTML = `<div style="padding:14px;border:1px solid var(--line);border-radius:12px;background:#F8FAFC"><strong>Änderungsanfragen werden zentral als Cases bearbeitet.</strong><div style="font-size:12px;color:var(--slate2);margin:5px 0 10px">Die AI-Konfiguration bleibt der Ort für die technische Umsetzung. Status, Priorität und Nachverfolgung erfolgen unter Cases & Support.</div><button class="btn btn-primary btn-sm" onclick="setRoute('cases');setTimeout(()=>{const f=document.getElementById('cases-type-filter');if(f){f.value='assistant_change';f.dispatchEvent(new Event('change'));}},80)">Zu den Assistenten-Cases</button></div>`;
  }

  ready(async () => {
    w.openOperationalAssistantCase = openAssistant;
    patchCasesHeader();
    await hydrateMetadata();

    if (typeof renderCases === 'function') w.renderCases = renderOperationalCases;
    if (typeof loadAiChangeRequests === 'function') w.loadAiChangeRequests = async function () { await hydrateMetadata(); redirectAiRequestsToCases(); };
    const originalUpdate = typeof updateCase === 'function' ? updateCase : null;
    if (originalUpdate) w.updateCase = async function () {
      const result = await originalUpdate.apply(this, arguments);
      await hydrateMetadata();
      renderOperationalCases();
      redirectAiRequestsToCases();
      return result;
    };
    const originalAll = typeof renderAll === 'function' ? renderAll : null;
    if (originalAll) w.renderAll = function () {
      const result = originalAll.apply(this, arguments);
      patchCasesHeader(); renderOperationalCases(); redirectAiRequestsToCases();
      return result;
    };

    renderOperationalCases();
    redirectAiRequestsToCases();
    document.getElementById('cases-search')?.addEventListener('input', renderOperationalCases);
    document.getElementById('cases-reset')?.addEventListener('click', () => setTimeout(() => {
      const filter = document.getElementById('cases-type-filter'); if (filter) filter.value = 'all';
      renderOperationalCases();
    }, 0));
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
