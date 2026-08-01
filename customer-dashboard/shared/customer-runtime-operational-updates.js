(function initVoxeraOperationalUpdates(root) {
  'use strict';
  if (!root || !root.document || root.__vxOperationalUpdatesInstalled) return;
  root.__vxOperationalUpdatesInstalled = true;

  const labels = {
    closure: 'Ferien / geschlossen',
    special_hours: 'Geänderte Öffnungszeiten',
    absence: 'Abwesenheit',
    temporary_contact: 'Temporäre Kontaktperson',
    appointment_pause: 'Terminannahme pausieren',
    notice: 'Temporärer Hinweis'
  };
  let state = { updates: [], server_time: new Date().toISOString() };
  let editingId = '';
  let busy = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function addStyle() {
    if (document.getElementById('vx-ops-style')) return;
    const node = document.createElement('style');
    node.id = 'vx-ops-style';
    node.textContent = [
      '.vx-ops-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.72fr);gap:14px}.vx-ops-card{background:#fff;border:.5px solid var(--line,#e4e8f0);border-radius:14px;padding:16px}.vx-ops-title{font-size:14px;font-weight:700;color:var(--ink,#0d1f3c)}.vx-ops-sub{font-size:12px;line-height:1.5;color:var(--slate2,#7a8599);margin-top:4px}.vx-ops-list{display:grid;gap:10px;margin-top:14px}.vx-ops-item{border:.5px solid var(--line,#e4e8f0);border-radius:12px;padding:13px}.vx-ops-item.cancelled{opacity:.55}.vx-ops-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.vx-ops-pill{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:700;background:#eef4ff;color:#1a6fe8}.vx-ops-pill.active{background:#ecfdf5;color:#047857}.vx-ops-pill.expired,.vx-ops-pill.cancelled{background:#f1f5f9;color:#64748b}.vx-ops-message{font-size:13px;line-height:1.5;color:var(--ink,#0d1f3c);margin-top:8px}.vx-ops-meta{font-size:11px;color:var(--slate2,#7a8599);margin-top:7px}.vx-ops-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.vx-ops-btn{border:0;border-radius:9px;padding:9px 12px;font:600 12px inherit;cursor:pointer;background:#0d1f3c;color:#fff}.vx-ops-btn.secondary{background:#eef4ff;color:#1a6fe8}.vx-ops-btn.danger{background:#fef2f2;color:#b91c1c}.vx-ops-btn:disabled{opacity:.45;cursor:not-allowed}.vx-ops-form{display:grid;gap:11px;margin-top:14px}.vx-ops-field label{display:block;font-size:11px;font-weight:650;color:var(--slate2,#7a8599);margin-bottom:5px}.vx-ops-field input,.vx-ops-field select,.vx-ops-field textarea{width:100%;box-sizing:border-box;border:.5px solid var(--line,#e4e8f0);border-radius:9px;padding:10px 11px;background:#fff;color:var(--ink,#0d1f3c);font:500 13px inherit}.vx-ops-field textarea{min-height:82px;resize:vertical}.vx-ops-status{display:none;margin:0 0 12px;padding:10px 12px;border-radius:10px;font-size:12px}.vx-ops-status.loading{display:block;background:#eff6ff;color:#1d4ed8}.vx-ops-status.success{display:block;background:#ecfdf5;color:#047857}.vx-ops-status.warning{display:block;background:#fff7ed;color:#9a3412}.vx-ops-status.error{display:block;background:#fef2f2;color:#b91c1c}.vx-ops-empty{padding:24px 12px;text-align:center;color:var(--slate2,#7a8599);font-size:12px}.vx-ops-note{margin-top:12px;padding:11px 12px;border-radius:10px;background:#f8fafc;color:#64748b;font-size:11px;line-height:1.5}@media(max-width:820px){.vx-ops-layout{grid-template-columns:1fr}}'
    ].join('');
    document.head.appendChild(node);
  }

  function inject() {
    addStyle();
    const main = document.getElementById('mehr-main');
    const tab = document.getElementById('tab-mehr');
    if (!main || !tab) return false;

    if (!document.getElementById('vx-operational-entry')) {
      const list = main.querySelector('.vx-page-header')?.nextElementSibling;
      if (list) {
        const entry = document.createElement('div');
        entry.id = 'vx-operational-entry';
        entry.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;border-bottom:.5px solid var(--line)';
        entry.innerHTML = '<div style="width:36px;height:36px;background:#ecfdf5;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ph-bold ph-megaphone" style="color:#047857;font-size:17px" aria-hidden="true"></i></div><div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--ink)">Aktuelle Betriebsinfos</div><div id="vx-operational-entry-sub" style="font-size:11px;color:var(--slate2)">Ferien, Abwesenheiten und Sonderzeiten</div></div><i class="ph-bold ph-caret-right" style="color:var(--slate2);font-size:15px" aria-hidden="true"></i>';
        entry.addEventListener('click', open);
        const calendar = document.getElementById('vx-calendar-settings-entry');
        const help = Array.from(list.children).find((child) => /Hilfe/.test(child.textContent || ''));
        list.insertBefore(entry, calendar || help || null);
      }
    }

    if (!document.getElementById('mehr-sub-betriebsinfos')) {
      const page = document.createElement('div');
      page.id = 'mehr-sub-betriebsinfos';
      page.style.display = 'none';
      page.innerHTML = '<div class="vx-page-header" style="align-items:center;gap:12px"><button type="button" class="vx-back-btn" data-ops-back><i class="ph-bold ph-arrow-left" style="font-size:18px" aria-hidden="true"></i></button><div style="flex:1"><div class="vx-page-header-title">Aktuelle Betriebsinfos</div><div style="font-size:12px;color:var(--slate2);margin-top:3px">Zeitlich begrenzte Angaben für den Assistenten.</div></div></div><div id="vx-operational-page-body"></div>';
      tab.appendChild(page);
      page.querySelector('[data-ops-back]').addEventListener('click', back);
    }
    return true;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '–';
    return new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short'
    }).format(date);
  }

  function localValue(value) {
    const date = value ? new Date(value) : new Date();
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
  }

  function phase(item) {
    if (item.status === 'cancelled') return { key: 'cancelled', label: 'Zurückgezogen' };
    const now = new Date(state.server_time || Date.now()).getTime();
    if (new Date(item.ends_at).getTime() <= now) return { key: 'expired', label: 'Abgelaufen' };
    if (new Date(item.starts_at).getTime() <= now) return { key: 'active', label: 'Aktiv' };
    return { key: 'scheduled', label: 'Geplant' };
  }

  function visibleItems() {
    return [...(state.updates || [])].sort((a, b) => {
      const rank = { active: 0, scheduled: 1, expired: 2, cancelled: 3 };
      return rank[phase(a).key] - rank[phase(b).key] || new Date(a.starts_at) - new Date(b.starts_at);
    });
  }

  function itemHtml(item) {
    const status = phase(item);
    const canEdit = item.status !== 'cancelled' && status.key !== 'expired';
    const sync = item.sync_status === 'failed' ? ' · Prompt-Sync ausstehend' : '';
    return '<div class="vx-ops-item ' + esc(status.key) + '"><div class="vx-ops-head"><div><div class="vx-ops-title">' + esc(item.title) + '</div><div class="vx-ops-sub">' + esc(labels[item.type] || item.type) + '</div></div><span class="vx-ops-pill ' + esc(status.key) + '">' + esc(status.label) + '</span></div><div class="vx-ops-message">' + esc(item.message) + '</div>' + (item.behavior ? '<div class="vx-ops-meta"><strong>Verhalten:</strong> ' + esc(item.behavior) + '</div>' : '') + '<div class="vx-ops-meta">' + esc(formatDate(item.starts_at)) + ' – ' + esc(formatDate(item.ends_at)) + esc(sync) + '</div>' + (canEdit ? '<div class="vx-ops-actions"><button type="button" class="vx-ops-btn secondary" data-ops-edit="' + esc(item.id) + '">Bearbeiten</button><button type="button" class="vx-ops-btn danger" data-ops-cancel="' + esc(item.id) + '">Zurückziehen</button></div>' : '') + '</div>';
  }

  function render() {
    const body = document.getElementById('vx-operational-page-body');
    if (!body) return;
    const items = visibleItems();
    const activeCount = items.filter((item) => ['active','scheduled'].includes(phase(item).key)).length;
    body.innerHTML = '<div id="vx-ops-status" class="vx-ops-status" role="status" aria-live="polite"></div><div class="vx-ops-layout"><section class="vx-ops-card"><div class="vx-ops-title">Aktiv und geplant</div><div class="vx-ops-sub">Der Assistent berücksichtigt veröffentlichte Angaben nur im gewählten Zeitraum.</div><div class="vx-ops-list">' + (items.length ? items.map(itemHtml).join('') : '<div class="vx-ops-empty">Noch keine Betriebsinfo erfasst.</div>') + '</div></section><section class="vx-ops-card"><div class="vx-ops-title" id="vx-ops-form-title">' + (editingId ? 'Betriebsinfo bearbeiten' : 'Neue Betriebsinfo') + '</div><div class="vx-ops-form"><div class="vx-ops-field"><label>Art</label><select id="vx-ops-type">' + Object.entries(labels).map(([value, label]) => '<option value="' + value + '">' + esc(label) + '</option>').join('') + '</select></div><div class="vx-ops-field"><label>Titel</label><input id="vx-ops-title" maxlength="100" placeholder="z. B. Betriebsferien Weihnachten"></div><div class="vx-ops-field"><label>Information für Anrufende</label><textarea id="vx-ops-message" maxlength="500" placeholder="Was soll der Assistent mitteilen?"></textarea></div><div class="vx-ops-field"><label>Gewünschtes Verhalten (optional)</label><textarea id="vx-ops-behavior" maxlength="500" placeholder="z. B. Rückrufanfrage aufnehmen, aber keine Termine zusagen"></textarea></div><div class="vx-ops-field"><label>Gültig ab</label><input id="vx-ops-start" type="datetime-local"></div><div class="vx-ops-field"><label>Gültig bis</label><input id="vx-ops-end" type="datetime-local"></div><div class="vx-ops-actions"><button type="button" class="vx-ops-btn" id="vx-ops-save"' + (busy ? ' disabled' : '') + '>' + (editingId ? 'Änderung speichern' : 'Veröffentlichen') + '</button>' + (editingId ? '<button type="button" class="vx-ops-btn secondary" id="vx-ops-reset">Abbrechen</button>' : '') + '</div></div><div class="vx-ops-note">Hier werden nur tägliche Betriebsänderungen gepflegt. Dauerhafte Leistungen, Preise, Agent-Funktionen und Sicherheitsregeln bleiben geschützt.</div></section></div>';
    bind();
    if (!editingId) setDefaults();
    const entrySub = document.getElementById('vx-operational-entry-sub');
    if (entrySub) entrySub.textContent = activeCount ? activeCount + ' aktiv oder geplant' : 'Ferien, Abwesenheiten und Sonderzeiten';
  }

  function setStatus(message, tone) {
    const node = document.getElementById('vx-ops-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'vx-ops-status' + (message ? ' ' + (tone || 'loading') : '');
  }

  function setDefaults() {
    const start = document.getElementById('vx-ops-start');
    const end = document.getElementById('vx-ops-end');
    if (start && !start.value) start.value = localValue(new Date());
    if (end && !end.value) end.value = localValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
  }

  function bind() {
    document.getElementById('vx-ops-save')?.addEventListener('click', save);
    document.getElementById('vx-ops-reset')?.addEventListener('click', resetForm);
    document.querySelectorAll('[data-ops-edit]').forEach((node) => node.addEventListener('click', () => edit(node.dataset.opsEdit)));
    document.querySelectorAll('[data-ops-cancel]').forEach((node) => node.addEventListener('click', () => cancel(node.dataset.opsCancel)));
  }

  async function call(payload) {
    if (typeof root.callDashboardFunction !== 'function') throw new Error('Dashboard-Funktion ist nicht verfügbar.');
    return root.callDashboardFunction('customer-operational-updates', payload);
  }

  async function load() {
    setStatus('Betriebsinfos werden geladen …', 'loading');
    try {
      state = await call({ action: 'list' });
      render();
    } catch (error) {
      setStatus(error?.message || 'Betriebsinfos konnten nicht geladen werden.', 'error');
    }
  }

  function edit(id) {
    const item = (state.updates || []).find((entry) => entry.id === id);
    if (!item) return;
    editingId = id;
    render();
    document.getElementById('vx-ops-type').value = item.type;
    document.getElementById('vx-ops-title').value = item.title;
    document.getElementById('vx-ops-message').value = item.message;
    document.getElementById('vx-ops-behavior').value = item.behavior || '';
    document.getElementById('vx-ops-start').value = localValue(item.starts_at);
    document.getElementById('vx-ops-end').value = localValue(item.ends_at);
  }

  function resetForm() {
    editingId = '';
    render();
  }

  async function save() {
    if (busy) return;
    const update = {
      type: document.getElementById('vx-ops-type')?.value,
      title: document.getElementById('vx-ops-title')?.value,
      message: document.getElementById('vx-ops-message')?.value,
      behavior: document.getElementById('vx-ops-behavior')?.value,
      starts_at: new Date(document.getElementById('vx-ops-start')?.value || '').toISOString(),
      ends_at: new Date(document.getElementById('vx-ops-end')?.value || '').toISOString()
    };
    if (!update.title.trim() || !update.message.trim()) {
      setStatus('Bitte Titel und Information ausfüllen.', 'error');
      return;
    }
    busy = true;
    setStatus('Betriebsinfo und Agenten-Prompt werden aktualisiert …', 'loading');
    try {
      state = await call({ action: editingId ? 'update' : 'create', id: editingId || undefined, update });
      editingId = '';
      render();
      if (state.sync_status === 'failed') {
        setStatus('Betriebsinfo gespeichert. Der Prompt-Sync wird als ausstehend markiert.', 'warning');
      } else {
        setStatus('✓ Betriebsinfo gespeichert und mit dem Assistenten synchronisiert.', 'success');
      }
    } catch (error) {
      setStatus(error?.message || 'Betriebsinfo konnte nicht gespeichert werden.', 'error');
    } finally {
      busy = false;
    }
  }

  async function cancel(id) {
    if (busy || !root.confirm('Diese Betriebsinfo wirklich zurückziehen?')) return;
    busy = true;
    setStatus('Betriebsinfo wird zurückgezogen …', 'loading');
    try {
      state = await call({ action: 'cancel', id });
      editingId = '';
      render();
      setStatus(state.sync_status === 'failed' ? 'Betriebsinfo zurückgezogen. Prompt-Sync ist noch ausstehend.' : '✓ Betriebsinfo wurde zurückgezogen.', state.sync_status === 'failed' ? 'warning' : 'success');
    } catch (error) {
      setStatus(error?.message || 'Betriebsinfo konnte nicht zurückgezogen werden.', 'error');
    } finally {
      busy = false;
    }
  }

  function open() {
    if (!inject()) return;
    document.getElementById('mehr-main').style.display = 'none';
    document.querySelectorAll('[id^="mehr-sub-"]').forEach((node) => { node.style.display = 'none'; });
    document.getElementById('mehr-sub-betriebsinfos').style.display = 'block';
    render();
    load();
  }

  function back() {
    document.querySelectorAll('[id^="mehr-sub-"]').forEach((node) => { node.style.display = 'none'; });
    document.getElementById('mehr-main').style.display = 'block';
  }

  root.vxOperationalUpdatesOpen = open;
  const install = () => {
    if (!inject()) {
      root.setTimeout(install, 300);
      return;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);
