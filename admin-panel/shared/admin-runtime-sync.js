(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once:true });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const timeout = (promise, ms, message) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);

  ready(() => {
    let selectedCustomerId = '';
    let loading = false;

    function customers() {
      return typeof state !== 'undefined' && Array.isArray(state.customers) ? state.customers : [];
    }

    function customerName(id) {
      const customer = typeof customerById === 'function'
        ? customerById(id)
        : customers().find(item => String(item.id) === String(id));
      return customer?.name || customer?.customer_display_name || customer?.customer_name || customer?.email || id;
    }

    function selectBox() {
      const card = document.getElementById('ai-sync-log-card');
      const head = card?.querySelector('.card-head');
      if (!head) return null;
      let select = document.getElementById('ai-sync-customer-select');
      if (!select) {
        select = document.createElement('select');
        select.id = 'ai-sync-customer-select';
        select.className = 'select';
        select.style.cssText = 'height:34px;min-width:220px;max-width:340px';
        head.insertBefore(select, document.getElementById('ai-sync-log-customer-name'));
        select.addEventListener('change', () => {
          selectedCustomerId = String(select.value || '');
          if (typeof state !== 'undefined') state.aiSelectedCustomerId = selectedCustomerId || null;
          loadSafe(selectedCustomerId);
        });
      }
      const rows = customers();
      const desired = String(selectedCustomerId || (typeof state !== 'undefined' ? state.aiSelectedCustomerId : '') || select.value || '');
      select.innerHTML = rows.length
        ? rows.map(item => `<option value="${esc(item.id)}">${esc(customerName(item.id))}</option>`).join('')
        : '<option value="">Keine Kunden vorhanden</option>';
      const chosen = rows.some(item => String(item.id) === desired) ? desired : String(rows[0]?.id || '');
      select.value = chosen;
      selectedCustomerId = chosen;
      if (typeof state !== 'undefined') state.aiSelectedCustomerId = chosen || null;
      return select;
    }

    function statusBlock(customer) {
      const status = String(customer?.sync_status || 'never').toLowerCase();
      const map = {
        success: ['Synchronisiert', 'green'],
        failed: ['Fehler', 'red'],
        syncing: ['Synchronisierung läuft', 'amber'],
        never: ['Noch nie synchronisiert', 'gray']
      };
      const [label, cls] = map[status] || map.never;
      const last = customer?.last_sync_at ? new Date(customer.last_sync_at).toLocaleString('de-CH') : '—';
      const agent = customer?.agent_id || 'Nicht angelegt';
      // S4 / Stufe 1: "Erfolgreich synchronisiert" und "auf dem aktuellen Stand"
      // sind zwei verschiedene Aussagen. Ein Kunde kann gruen dastehen und
      // trotzdem auf einem Prompt von vor drei Deploys laufen -- genau das war
      // am 09.08. der Fall. Der Hinweis steht deshalb neben dem Status, nicht
      // statt ihm.
      // Drei Zustaende: veraltet (gemessen), unbekannt (noch nie gemessen) und
      // aktuell. "Unbekannt" ist kein Fehler, sondern eine fehlende Messung --
      // direkt nach der Einfuehrung stehen alle Bestandskunden so da. Es wird
      // deshalb ruhiger dargestellt, zieht aber denselben Sync nach sich.
      const promptState = customer?.prompt_state
        || (customer?.prompt_outdated === true ? 'outdated' : null);
      const stale = promptState === 'outdated' || promptState === 'unknown';
      const staleCopy = {
        outdated: ['Prompt veraltet',
          'Der Agent laeuft auf einem aelteren Stand von Master-Prompt, Branchenvorlage oder Prompt-Builder. Ein Sync zieht ihn nach.'],
        unknown: ['Stand unbekannt',
          'Fuer diesen Agenten ist noch kein Prompt-Stand festgehalten. Der naechste Sync haelt ihn fest.']
      };
      const [staleLabel, staleText] = staleCopy[promptState] || [];
      const outdatedBlock = stale
        ? `<div style="margin-top:9px;padding:8px 10px;border-radius:9px;background:#FEF3C7;border:1px solid #FCD34D">
            <div style="font-size:12px;color:#92400E;font-weight:600">${esc(staleLabel)}</div>
            <div style="font-size:11px;color:#92400E;margin-top:3px">${esc(staleText)}</div>
            <div style="font-size:10px;color:#B45309;margin-top:4px;font-family:ui-monospace,monospace">ist: ${esc(customer?.prompt_fingerprint || '—')} · soll: ${esc(customer?.expected_prompt_fingerprint || '—')}</div>
          </div>`
        : '';
      return `<div style="border:1px solid var(--line);border-radius:12px;background:#F8FAFC;padding:12px 14px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
          <div>
            <span class="badge badge-${cls}">${esc(label)}</span>${stale ? ` <span class="badge badge-amber">${esc(staleLabel)}</span>` : ''}
            <div style="font-size:11px;color:var(--slate2);margin-top:5px">Letzter Versuch: ${esc(last)} · Agent: ${esc(agent)}</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="vox-sync-now" ${loading || !customer?.agent_id ? 'disabled' : ''}>${loading ? 'Synchronisiere…' : 'Jetzt synchronisieren'}</button>
        </div>
        ${customer?.sync_error ? `<div style="margin-top:9px;font-size:12px;color:var(--red);white-space:pre-wrap">${esc(customer.sync_error)}</div>` : ''}
        ${outdatedBlock}
      </div>`;
    }

    function logRows(rows) {
      const trigger = {
        admin_save:'Admin Portal', wizard:'Wizard', customer_request:'Kundenanfrage',
        admin_manual:'Manuell', provision_admin_manual:'Provisionierung', provision_onboarding:'Provisionierung'
      };
      if (!rows.length) return '<div class="empty">Noch kein Sync für diesen Kunden protokolliert.</div>';
      return rows.map(row => {
        const status = String(row.status || '').toLowerCase();
        const ok = status === 'success';
        const running = status === 'syncing';
        const date = row.created_at ? new Date(row.created_at).toLocaleString('de-CH') : '—';
        const badge = running ? 'amber' : (ok ? 'green' : 'red');
        const label = running ? 'Läuft' : (ok ? 'Erfolg' : 'Fehler');
        return `<div style="padding:11px 0;border-bottom:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div><strong>${esc(date)}</strong> <span class="badge badge-${badge}">${label}</span></div>
            <span style="font-size:11px;color:var(--slate2)">${esc(trigger[row.triggered_by] || row.triggered_by || '—')}</span>
          </div>
          ${row.prompt_length ? `<div style="margin-top:4px;font-size:11px;color:var(--slate2)">Prompt: ${esc(row.prompt_length)} Zeichen</div>` : ''}
          ${row.error_message ? `<div style="margin-top:5px;font-size:11px;color:var(--red)">${esc(row.error_message)}</div>` : ''}
        </div>`;
      }).join('');
    }

    async function runSync(id) {
      if (!id || loading) return;
      loading = true;
      await loadSafe(id, { preserveLoading:true });
      try {
        await timeout(
          callAdminFunction('trigger-elevenlabs-sync', { customer_id:id, triggered_by:'admin_manual' }),
          30_000,
          'Der Sync hat nicht rechtzeitig geantwortet.'
        );
        if (typeof showToast === 'function') showToast('✓ ElevenLabs synchronisiert.');
      } catch (error) {
        if (typeof showToast === 'function') showToast(error?.message || 'ElevenLabs-Sync fehlgeschlagen.');
      } finally {
        loading = false;
        await loadSafe(id);
      }
    }

    async function loadSafe(customerId, options = {}) {
      const list = document.getElementById('ai-sync-log-list');
      const name = document.getElementById('ai-sync-log-customer-name');
      if (!list) return;
      const id = String(customerId || selectedCustomerId || '');
      if (!id) {
        list.innerHTML = '<div class="empty">Bitte einen Kunden auswählen.</div>';
        return;
      }
      selectedCustomerId = id;
      if (name) name.textContent = customerName(id);
      if (!options.preserveLoading) list.innerHTML = '<div style="font-size:12px;color:var(--slate2);padding:12px 0">Sync-Status wird geladen…</div>';
      try {
        const json = await timeout(
          callAdminFunction('elevenlabs-sync-status', { customer_id:id }),
          15_000,
          'Zeitüberschreitung beim Laden des Sync-Status.'
        );
        list.innerHTML = statusBlock(json.customer || {}) + logRows(json.logs || []);
        document.getElementById('vox-sync-now')?.addEventListener('click', () => runSync(id));
      } catch (error) {
        list.innerHTML = `<div class="empty" style="border-color:#FECACA;background:#FEF2F2;color:#991B1B"><strong>Sync-Status konnte nicht geladen werden.</strong><div style="margin-top:5px;font-size:11px">${esc(error?.message || error)}</div><button class="btn btn-secondary btn-sm" id="vox-sync-retry" style="margin-top:10px">Erneut versuchen</button></div>`;
        document.getElementById('vox-sync-retry')?.addEventListener('click', () => loadSafe(id));
      }
    }

    const originalTab = typeof aiShowTab === 'function' ? aiShowTab : null;
    if (originalTab && !originalTab.__voxSyncV2) {
      const wrapped = function (name) {
        const result = originalTab.apply(this, arguments);
        if (name === 'sync') {
          const select = selectBox();
          if (select?.value) loadSafe(select.value);
          else {
            const list = document.getElementById('ai-sync-log-list');
            if (list) list.innerHTML = '<div class="empty">Keine Kunden vorhanden.</div>';
          }
        }
        return result;
      };
      wrapped.__voxSyncV2 = true;
      w.aiShowTab = wrapped;
    }

    w.loadSyncLog = loadSafe;
    w.selectAiSyncCustomer = id => {
      selectedCustomerId = String(id || '');
      const select = selectBox();
      if (select && selectedCustomerId) select.value = selectedCustomerId;
      return loadSafe(selectedCustomerId);
    };
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
