(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;
  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once: true });
  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  ready(() => {
    function selectBox() {
      const head = document.getElementById('ai-sync-log-card')?.querySelector('.card-head'); if (!head) return null;
      let select = document.getElementById('ai-sync-customer-select');
      if (!select) { select = document.createElement('select'); select.id = 'ai-sync-customer-select'; select.className = 'select'; select.style.cssText = 'height:32px;min-width:220px'; head.insertBefore(select, document.getElementById('ai-sync-log-customer-name')); select.onchange = () => loadSafe(select.value); }
      const customers = state.customers || [], current = String(state.aiSelectedCustomerId || select.value || '');
      select.innerHTML = customers.length ? customers.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name || c.email || c.id)}</option>`).join('') : '<option value="">Keine Kunden vorhanden</option>';
      const chosen = customers.some(c => String(c.id) === current) ? current : String(customers[0]?.id || ''); select.value = chosen; state.aiSelectedCustomerId = chosen || null; return select;
    }

    async function loadSafe(customerId) {
      const list = document.getElementById('ai-sync-log-list'), name = document.getElementById('ai-sync-log-customer-name'); if (!list) return;
      const id = String(customerId || ''); if (!id) { list.innerHTML = '<div class="empty">Bitte einen Kunden auswählen.</div>'; return; }
      const c = typeof customerById === 'function' ? customerById(id) : null; if (name) name.textContent = c?.name || c?.email || id;
      list.innerHTML = '<div style="font-size:12px;color:var(--slate2);padding:12px 0">Sync-Historie wird geladen…</div>';
      try {
        const query = authClient.from('elevenlabs_sync_log').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(10);
        const result = await Promise.race([query, new Promise((_, reject) => setTimeout(() => reject(new Error('Zeitüberschreitung beim Laden.')), 12000))]);
        if (result.error) throw result.error;
        const rows = result.data || []; if (!rows.length) { list.innerHTML = '<div class="empty">Noch kein Sync für diesen Kunden protokolliert.</div>'; return; }
        const trigger = { admin_save:'Admin Portal', wizard:'Wizard', customer_request:'Kundenanfrage' };
        list.innerHTML = rows.map(r => { const ok = r.status === 'success', date = new Date(r.created_at).toLocaleString('de-CH'); return `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><strong>${escHtml(date)}</strong> <span class="badge badge-${ok?'green':'red'}">${ok?'Erfolg':'Fehler'}</span></div><span style="font-size:11px;color:var(--slate2)">${escHtml(trigger[r.triggered_by] || r.triggered_by || '—')}</span></div>${r.error_message?`<div style="margin-top:5px;font-size:11px;color:var(--red)">Fehler: ${escHtml(r.error_message)}</div>`:''}</div>`; }).join('');
      } catch (err) {
        list.innerHTML = `<div class="empty" style="border-color:#FECACA;background:#FEF2F2;color:#991B1B"><strong>Sync-Historie konnte nicht geladen werden.</strong><div style="margin-top:5px;font-size:11px">${escHtml(err?.message || err)}</div><button class="btn btn-secondary btn-sm" id="vox-sync-retry" style="margin-top:10px">Erneut versuchen</button></div>`;
        document.getElementById('vox-sync-retry')?.addEventListener('click', () => loadSafe(id));
      }
    }

    const tab = typeof aiShowTab === 'function' ? aiShowTab : null;
    if (tab) aiShowTab = function (name) { const r = tab.apply(this, arguments); if (name === 'sync') { const s = selectBox(); if (s?.value) loadSafe(s.value); else document.getElementById('ai-sync-log-list').innerHTML = '<div class="empty">Keine Kunden vorhanden.</div>'; } return r; };
    if (typeof loadSyncLog === 'function') loadSyncLog = loadSafe;
    w.selectAiSyncCustomer = id => loadSafe(id);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
