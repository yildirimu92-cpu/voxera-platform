(function initVoxeraAssistantStatus(root) {
  'use strict';
  if (!root || !root.document || root.__vxAssistantStatusInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxAssistantStatusInstalled = true;

  let snapshot = null;
  let loading = false;
  let scheduled = false;
  let hadExtension = false;

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function addStyles() {
    if (document.getElementById('vx-assistant-status-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-assistant-status-style';
    style.textContent = `
      .vx-as-cap-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:14px}
      .vx-as-cap{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;padding:12px;border:.5px solid var(--line,#e4e8f0);border-radius:12px;background:#fff;min-width:0}
      .vx-as-icon{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;font-size:15px;background:#f1f5f9;color:#64748b}
      .vx-as-icon.active{background:#ecfdf5;color:#047857}.vx-as-icon.attention{background:#fff7ed;color:#b45309}.vx-as-icon.error{background:#fef2f2;color:#b91c1c}
      .vx-as-cap-title{font-size:12px;font-weight:700;color:var(--ink,#0d1f3c);line-height:1.35}.vx-as-cap-detail{font-size:11px;color:var(--slate2,#7a8599);line-height:1.45;margin-top:3px}
      .vx-as-state{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:750;margin-top:6px;color:#64748b}.vx-as-state:before{content:'';width:6px;height:6px;border-radius:50%;background:#94a3b8}
      .vx-as-state.active{color:#047857}.vx-as-state.active:before{background:#10b981}.vx-as-state.attention{color:#b45309}.vx-as-state.attention:before{background:#f59e0b}.vx-as-state.error{color:#b91c1c}.vx-as-state.error:before{background:#ef4444}
      .vx-as-tech{display:grid;gap:0;margin-top:13px}.vx-as-tech-row{display:grid;grid-template-columns:minmax(145px,.8fr) minmax(120px,.55fr) minmax(0,1.4fr);gap:12px;align-items:center;padding:11px 0;border-bottom:.5px solid var(--line,#e4e8f0)}.vx-as-tech-row:last-child{border-bottom:0}
      .vx-as-tech-name{font-size:12px;font-weight:650;color:var(--ink,#0d1f3c)}.vx-as-tech-detail{font-size:11px;color:var(--slate2,#7a8599);line-height:1.45}
      .vx-as-ops{margin-top:13px;padding:12px;border-radius:12px;background:#f8fafc;border:.5px solid var(--line,#e4e8f0);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.vx-as-ops-copy{font-size:11px;color:var(--slate2,#7a8599);line-height:1.5}.vx-as-ops-copy strong{display:block;color:var(--ink,#0d1f3c);font-size:12px;margin-bottom:2px}
      @media(max-width:720px){.vx-as-cap-grid{grid-template-columns:1fr}.vx-as-tech-row{grid-template-columns:1fr;gap:4px}.vx-as-tech-row .vx-as-state{margin-top:0}}
    `;
    document.head.appendChild(style);
  }

  async function token() {
    const client = typeof root.getSupabaseAuthClient === 'function' ? root.getSupabaseAuthClient() : root._sb;
    if (!client?.auth?.getSession) throw new Error('Ihre Sitzung ist nicht verfügbar.');
    const result = await client.auth.getSession();
    const accessToken = String(result?.data?.session?.access_token || '').trim();
    if (!accessToken) throw new Error('Ihre Sitzung ist abgelaufen.');
    return accessToken;
  }

  async function loadSnapshot() {
    const accessToken = await token();
    const response = await fetch('/.netlify/functions/customer-assistant-profile', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
      cache: 'no-store'
    });
    let payload = {};
    try { payload = await response.json(); } catch (_error) {}
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Status konnte nicht geladen werden.');
    return payload;
  }

  function iconFor(id) {
    return {
      calls: 'ph-phone-call',
      callback: 'ph-arrow-u-up-left',
      appointments: 'ph-calendar-check',
      appointment_changes: 'ph-calendar-dots',
      transfer: 'ph-phone-transfer',
      notifications: 'ph-bell-ringing'
    }[id] || 'ph-check-circle';
  }

  function safeTone(value) {
    const tone = String(value || '').toLowerCase();
    return ['active', 'attention', 'error'].includes(tone) ? tone : 'inactive';
  }

  function capabilityHtml(item) {
    const tone = safeTone(item.status);
    return `<div class="vx-as-cap">
      <div class="vx-as-icon ${tone}"><i class="ph-bold ${iconFor(item.id)}" aria-hidden="true"></i></div>
      <div><div class="vx-as-cap-title">${esc(item.title)}</div><div class="vx-as-cap-detail">${esc(item.detail)}</div><div class="vx-as-state ${tone}">${esc(item.label)}</div></div>
    </div>`;
  }

  function technicalRow(title, item) {
    const tone = safeTone(item?.status);
    return `<div class="vx-as-tech-row"><div class="vx-as-tech-name">${esc(title)}</div><div class="vx-as-state ${tone}">${esc(item?.label || 'Nicht verfügbar')}</div><div class="vx-as-tech-detail">${esc(item?.detail || '')}</div></div>`;
  }

  function formatDate(value) {
    if (!value) return 'Noch keine erfolgreiche Synchronisierung';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Zeitpunkt nicht verfügbar';
    try {
      return new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    } catch (_error) {
      return date.toLocaleString('de-CH');
    }
  }

  function openBusiness() {
    document.getElementById('vx-open-business-profile')?.click();
  }

  function openOperational() {
    const entry = document.getElementById('vx-operational-entry');
    if (entry) entry.click();
  }

  function openCalendar() {
    const entry = document.getElementById('vx-calendar-settings-entry');
    if (entry) entry.click();
  }

  function render() {
    const body = document.getElementById('vx-assistant-profile-body');
    const stack = body?.querySelector('.vx-ap-stack');
    if (!stack || !snapshot || body.querySelector('#vx-assistant-status-extension')) return;

    const capabilities = Array.isArray(snapshot.capabilities) ? snapshot.capabilities : [];
    const technical = snapshot.technical_status || {};
    const updates = snapshot.operational_updates || {};
    const businessCard = Array.from(stack.querySelectorAll('.vx-ap-card')).find((card) =>
      /Geschäftswissen/.test(card.querySelector('.vx-ap-title')?.textContent || '')
    );

    const capabilitiesCard = document.createElement('section');
    capabilitiesCard.id = 'vx-assistant-capabilities-card';
    capabilitiesCard.className = 'vx-ap-card';
    capabilitiesCard.innerHTML = `<div class="vx-ap-head"><div><div class="vx-ap-title">Aktive Fähigkeiten</div><div class="vx-ap-meta">Was Ihr Assistent aktuell übernehmen kann. Die Anzeige basiert auf der freigegebenen Gesprächslogik und den verbundenen Diensten.</div></div></div><div class="vx-as-cap-grid">${capabilities.length ? capabilities.map(capabilityHtml).join('') : '<div class="vx-ap-empty">Fähigkeiten konnten nicht ermittelt werden.</div>'}</div>`;

    const technicalCard = document.createElement('section');
    technicalCard.id = 'vx-assistant-status-extension';
    technicalCard.className = 'vx-ap-card';
    technicalCard.innerHTML = `<div class="vx-ap-head"><div><div class="vx-ap-title">Systemstatus</div><div class="vx-ap-meta">Vereinfachte Betriebsanzeige ohne technische IDs oder Promptdetails.</div></div></div><div class="vx-as-tech">${technicalRow('Assistent', technical.assistant)}${technicalRow('Rufnummer & Weiterleitung', technical.forwarding)}${technicalRow('Konfiguration & Stimme', technical.voice_sync)}${technicalRow('Kalender', technical.calendar)}</div><div class="vx-ap-meta" style="margin-top:10px">Letzte erfolgreiche Synchronisierung: <strong style="color:var(--ink,#0d1f3c)">${esc(formatDate(technical.last_successful_sync_at))}</strong></div><div class="vx-ap-actions"><button type="button" class="vx-ap-btn secondary" id="vx-assistant-open-calendar">Kalender öffnen</button></div>`;

    if (businessCard) stack.insertBefore(capabilitiesCard, businessCard);
    else stack.appendChild(capabilitiesCard);
    stack.appendChild(technicalCard);

    if (businessCard && !businessCard.querySelector('#vx-assistant-operational-summary')) {
      const active = Number(updates.active_count || 0);
      const planned = Number(updates.planned_count || 0);
      const failed = Number(updates.sync_attention_count || 0);
      const ops = document.createElement('div');
      ops.id = 'vx-assistant-operational-summary';
      ops.className = 'vx-as-ops';
      ops.innerHTML = `<div class="vx-as-ops-copy"><strong>Aktuelle Änderungen</strong>${active} aktiv · ${planned} geplant${failed ? ` · ${failed} nicht synchronisiert` : ''}</div><button type="button" class="vx-ap-btn secondary" id="vx-assistant-open-operational">Öffnen</button>`;
      businessCard.appendChild(ops);
    }

    document.getElementById('vx-assistant-open-operational')?.addEventListener('click', openOperational);
    document.getElementById('vx-assistant-open-calendar')?.addEventListener('click', openCalendar);
    hadExtension = true;
  }

  async function refresh() {
    const body = document.getElementById('vx-assistant-profile-body');
    if (!body || loading || !body.querySelector('.vx-ap-stack')) return;
    if (snapshot) {
      render();
      return;
    }
    loading = true;
    try {
      snapshot = await loadSnapshot();
      render();
    } catch (error) {
      const stack = body.querySelector('.vx-ap-stack');
      if (stack && !document.getElementById('vx-assistant-status-extension')) {
        const card = document.createElement('section');
        card.id = 'vx-assistant-status-extension';
        card.className = 'vx-ap-card';
        card.innerHTML = `<div class="vx-ap-title">Status nicht verfügbar</div><div class="vx-ap-meta">${esc(error?.message || 'Die Statusinformationen konnten nicht geladen werden.')}</div>`;
        stack.appendChild(card);
      }
    } finally {
      loading = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    root.setTimeout(() => {
      scheduled = false;
      refresh();
    }, 60);
  }

  function install() {
    addStyles();
    const observer = new MutationObserver(() => {
      const body = document.getElementById('vx-assistant-profile-body');
      const hasExtension = Boolean(body?.querySelector('#vx-assistant-status-extension'));
      if (hadExtension && !hasExtension && body?.querySelector('.vx-ap-stack')) snapshot = null;
      hadExtension = hasExtension;
      schedule();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('#vx-assistant-profile-entry')) {
        snapshot = null;
        root.setTimeout(schedule, 100);
      }
    });
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : this);
