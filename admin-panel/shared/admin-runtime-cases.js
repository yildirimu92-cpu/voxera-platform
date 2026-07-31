(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete'
    ? setTimeout(fn, 0)
    : w.addEventListener('load', fn, { once: true });
  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const lower = value => String(value || '').trim().toLowerCase();

  const typeMeta = {
    internal_task: { label: 'Intern', cls: 'badge-gray' },
    customer_support: { label: 'Support', cls: 'badge-red' },
    assistant_change: { label: 'Assistent', cls: 'badge-blue' }
  };

  function rawOf(row) {
    return row && row.raw && typeof row.raw === 'object' ? row.raw : (row || {});
  }

  function caseType(row) {
    const raw = rawOf(row);
    return String(row.caseType || row.case_type || raw.case_type || 'internal_task').trim() || 'internal_task';
  }

  function caseCustomerId(row) {
    const raw = rawOf(row);
    return String(row.customerId || row.customer_id || raw.customer_id || '');
  }

  function isCustomerFollowUp(row) {
    const raw = rawOf(row);
    const type = lower(caseType(row));
    const source = lower(row.source || raw.source);
    const origin = lower(row.origin_channel || raw.origin_channel);
    const legacyType = lower(row.type || raw.type);
    const title = lower(row.title || raw.title);

    if (type === 'customer_support' || type === 'assistant_change') return false;

    const directMarkers = new Set([
      'customer_task', 'customer_tasks', 'customer_followup', 'customer_follow_up',
      'followup', 'follow_up', 'follow-up', 'callback', 'reminder'
    ]);
    if (directMarkers.has(source) || directMarkers.has(origin) || directMarkers.has(legacyType)) return true;

    const hasFollowUpFields = Boolean(
      raw.due_at || raw.due_time || raw.due_at_time || raw.phone ||
      row.dueAt || row.due_at || row.dueTime || row.due_time || row.phone
    );
    const followUpTitle = /follow[ -]?up|rückruf|callback|erinnerung/.test(title);

    // Legacy customer follow-ups were historically stored in voxera_cases and
    // are recognisable by their due-date/phone payload. Admin cases created by
    // the current Admin endpoint do not use these fields.
    if (hasFollowUpFields && (followUpTitle || type === 'internal_task')) return true;

    return false;
  }

  function operationalRows() {
    return (state.cases || []).filter(row => !isCustomerFollowUp(row));
  }

  function addCasesCss() {
    if (document.getElementById('voxera-cases-runtime-css')) return;
    const style = document.createElement('style');
    style.id = 'voxera-cases-runtime-css';
    style.textContent = `
      #section-cases .card{overflow:hidden!important}
      #section-cases .section-head.vox-cases-head{
        background:#fff!important;color:var(--ink)!important;
        border-bottom:1px solid var(--line)!important;
        border-radius:14px 14px 0 0!important;
        margin:0!important;padding:16px 18px!important
      }
      #section-cases .section-head.vox-cases-head h2,
      #section-cases .section-head.vox-cases-head h3,
      #section-cases .section-head.vox-cases-head strong{color:var(--ink)!important}
      #section-cases .section-head.vox-cases-head .muted,
      #section-cases .section-head.vox-cases-head p{color:var(--slate)!important}
      #section-cases .toolbar{border:0!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;box-shadow:none!important;margin:0!important}
      #section-cases .table-wrap{border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important}
      #section-cases .data-table td{vertical-align:top}
      #section-cases .case-source-note{font-size:10px;color:var(--slate2);margin-top:3px}
      @media(max-width:768px){
        #section-cases .section-head.vox-cases-head{align-items:stretch!important}
        #section-cases .section-head.vox-cases-head .inline-actions,
        #section-cases .section-head.vox-cases-head button{width:100%!important}
        #section-cases .toolbar{display:grid!important;grid-template-columns:1fr!important;padding:12px!important}
        #section-cases .toolbar>*{width:100%!important;min-width:0!important}
      }
    `;
    document.head.appendChild(style);
  }

  async function hydrateMetadata() {
    if (typeof authClient === 'undefined' || !authClient || typeof state === 'undefined') return;
    try {
      const { data, error } = await authClient
        .from('voxera_cases')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const byId = new Map((data || []).map(row => [String(row.id), row]));
      (state.cases || []).forEach(row => {
        const dbRow = byId.get(String(row.id));
        if (!dbRow) return;
        Object.assign(row, dbRow, { raw: Object.assign({}, rawOf(row), dbRow) });
      });
    } catch (error) {
      console.warn('[runtime-cases] metadata:', error?.message || error);
    }
  }

  function ensureCasesNavigation() {
    const nav = document.querySelector('.sidebar .nav');
    if (!nav || nav.querySelector('[data-route="cases"]')) return;
    const billing = nav.querySelector('[data-route="billing-finance"]');
    const item = document.createElement('a');
    item.href = '#cases';
    item.className = 'nav-item';
    item.dataset.route = 'cases';
    item.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5h10v11H3z"/><path d="M5.5 5h5M5.5 8h5M5.5 11h3"/></svg>Cases & Support';
    if (billing?.nextSibling) billing.parentNode.insertBefore(item, billing.nextSibling);
    else nav.appendChild(item);
    item.addEventListener('click', event => {
      event.preventDefault();
      if (typeof setRoute === 'function') setRoute('cases');
    });
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

  function statusOptions(row) {
    const normalized = typeof normalizeCaseStatus === 'function'
      ? normalizeCaseStatus(row.status)
      : String(row.status || 'open');
    return [CASE_STATUS.OPEN, CASE_STATUS.IN_PROGRESS, CASE_STATUS.WAITING, CASE_STATUS.DONE]
      .map(status => `<option value="${status}" ${status === normalized ? 'selected' : ''}>${escHtml(caseStatusLabel(status))}</option>`)
      .join('');
  }

  function renderOperationalCases() {
    const tbody = document.getElementById('cases-all');
    if (!tbody || typeof state === 'undefined') return;
    const search = (document.getElementById('cases-search')?.value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('cases-type-filter')?.value || 'all';
    const rows = operationalRows().filter(row => {
      const type = caseType(row);
      if (typeFilter !== 'all' && type !== typeFilter) return false;
      const customerId = caseCustomerId(row);
      const customer = typeof customerById === 'function' ? customerById(customerId) : null;
      const raw = rawOf(row);
      const haystack = `${row.id || ''} ${customer?.name || ''} ${row.title || row.type || ''} ${row.note || row.notes || ''} ${row.status || ''} ${type} ${row.source || raw.source || ''}`.toLowerCase();
      return !search || haystack.includes(search);
    });

    tbody.innerHTML = rows.map(row => {
      const customerId = caseCustomerId(row);
      const customer = typeof customerById === 'function' ? customerById(customerId) : null;
      const customerName = customer?.name || '—';
      const type = caseType(row);
      const meta = typeMeta[type] || typeMeta.internal_task;
      const raw = rawOf(row);
      const action = type === 'assistant_change'
        ? `<button class="btn btn-primary btn-sm" onclick="openOperationalAssistantCase('${escHtml(customerId)}')">Assistent öffnen</button>`
        : `<button class="btn btn-quiet btn-sm" onclick="openCustomerWorkspace('${escHtml(customerId)}')">Workspace</button>`;
      return `<tr>
        <td><button class="btn btn-quiet btn-sm" onclick="openCustomerWorkspace('${escHtml(customerId)}')">${escHtml(customerName)}</button></td>
        <td><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><strong>${escHtml(row.title || row.type || '—')}</strong><span class="badge ${meta.cls}">${meta.label}</span></div><div class="case-source-note">${escHtml(row.source || raw.source || (type === 'internal_task' ? 'admin' : 'customer_portal'))}</div></td>
        <td class="wrap">${escHtml(row.note || row.notes || '')}</td>
        <td><select class="select" style="height:30px;padding:4px 8px" onchange="updateCase('${escHtml(row.id)}','status',this.value)">${statusOptions(row)}</select></td>
        <td>${action}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5"><div class="empty">Keine internen Cases oder Support-Anfragen für die aktuelle Auswahl.</div></td></tr>';
  }

  function patchCasesHeader() {
    const section = document.getElementById('section-cases');
    if (!section) return;
    const head = section.querySelector('.section-head');
    if (head) head.classList.add('vox-cases-head');
    const title = head?.querySelector('h2,h3');
    if (title) {
      title.textContent = 'Cases & Support';
      title.style.color = 'var(--ink)';
    }
    const button = document.getElementById('cases-create-btn');
    if (button && button.lastChild) button.lastChild.textContent = ' Case erfassen';
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

  function renderAssistantRequestsInline() {
    const card = document.getElementById('ai-change-requests-card');
    const list = document.getElementById('ai-change-requests-list');
    if (!card || !list || typeof state === 'undefined') return;

    const rows = operationalRows()
      .filter(row => caseType(row) === 'assistant_change')
      .filter(row => (typeof normalizeCaseStatus === 'function' ? normalizeCaseStatus(row.status) : String(row.status || 'open')) !== CASE_STATUS.DONE)
      .sort((a, b) => new Date(b.updated_at || b.created_at || rawOf(b).updated_at || rawOf(b).created_at || 0) - new Date(a.updated_at || a.created_at || rawOf(a).updated_at || rawOf(a).created_at || 0));

    const badge = document.getElementById('ai-change-requests-badge');
    if (badge) {
      badge.textContent = `${rows.length} offen`;
      badge.style.display = rows.length ? '' : 'none';
    }

    if (!rows.length) {
      list.innerHTML = '<div class="empty" style="padding:18px">Keine offenen Änderungsanfragen.</div>';
      return;
    }

    list.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">${rows.map(row => {
      const customerId = caseCustomerId(row);
      const customer = typeof customerById === 'function' ? customerById(customerId) : null;
      const title = row.title || 'Assistenten-Änderung';
      const note = row.note || row.notes || '';
      return `<div style="border:1px solid var(--line);border-radius:12px;background:#fff;padding:13px 14px">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
          <div style="min-width:0;flex:1">
            <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><strong>${escHtml(customer?.name || customer?.email || 'Unbekannter Kunde')}</strong><span class="badge badge-blue">Änderungsanfrage</span></div>
            <div style="font-size:13px;font-weight:600;color:var(--ink);margin-top:7px">${escHtml(title)}</div>
            <div style="font-size:12px;color:var(--slate);margin-top:4px;white-space:pre-wrap">${escHtml(note)}</div>
          </div>
          <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
            <select class="select" style="height:32px;padding:4px 8px" onchange="updateCase('${escHtml(row.id)}','status',this.value)">${statusOptions(row)}</select>
            <button class="btn btn-primary btn-sm" onclick="openOperationalAssistantCase('${escHtml(customerId)}')">Assistent öffnen</button>
          </div>
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  ready(async () => {
    addCasesCss();
    w.openOperationalAssistantCase = openAssistant;
    ensureCasesNavigation();
    patchCasesHeader();
    await hydrateMetadata();

    if (typeof renderCases === 'function') w.renderCases = renderOperationalCases;
    if (typeof loadAiChangeRequests === 'function') {
      w.loadAiChangeRequests = async function () {
        await hydrateMetadata();
        renderAssistantRequestsInline();
      };
    }
    const originalUpdate = typeof updateCase === 'function' ? updateCase : null;
    if (originalUpdate) {
      w.updateCase = async function () {
        const result = await originalUpdate.apply(this, arguments);
        await hydrateMetadata();
        renderOperationalCases();
        renderAssistantRequestsInline();
        return result;
      };
    }
    const originalAll = typeof renderAll === 'function' ? renderAll : null;
    if (originalAll) {
      w.renderAll = function () {
        const result = originalAll.apply(this, arguments);
        ensureCasesNavigation();
        patchCasesHeader();
        renderOperationalCases();
        renderAssistantRequestsInline();
        return result;
      };
    }

    renderOperationalCases();
    renderAssistantRequestsInline();
    document.getElementById('cases-search')?.addEventListener('input', renderOperationalCases);
    document.getElementById('cases-reset')?.addEventListener('click', () => setTimeout(() => {
      const filter = document.getElementById('cases-type-filter');
      if (filter) filter.value = 'all';
      renderOperationalCases();
    }, 0));
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
