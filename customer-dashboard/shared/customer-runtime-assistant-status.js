(function initVoxeraAssistantStatus(root) {
  'use strict';
  if (!root || !root.document || root.__vxAssistantStatusInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxAssistantStatusInstalled = true;

  let snapshot = null;
  let loading = false;
  let scheduled = false;
  let statusObserver = null;
  let bootAttempts = 0;

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

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

  function render() {
    const body = document.getElementById('vx-assistant-profile-body');
    const stack = body?.querySelector('.vx-ap-stack');
    if (!stack || !snapshot || body.querySelector('#vx-assistant-status-extension')) return;

    const capabilities = Array.isArray(snapshot.capabilities) ? snapshot.capabilities : [];
    const technical = snapshot.technical_status || {};
    const businessCard = Array.from(stack.querySelectorAll('.vx-ap-card')).find((card) =>
      /Geschäftswissen/.test(card.querySelector('.vx-ap-title')?.textContent || '')
    );

    const capabilitiesCard = document.createElement('section');
    capabilitiesCard.id = 'vx-assistant-capabilities-card';
    capabilitiesCard.className = 'vx-ap-card';
    capabilitiesCard.innerHTML = `<div class="vx-ap-head"><div><div class="vx-ap-title">Fähigkeiten</div><div class="vx-ap-meta">Die wichtigsten Aufgaben, die Ihr Assistent aktuell übernimmt.</div></div></div><div class="vx-as-cap-grid">${capabilities.length ? capabilities.map(capabilityHtml).join('') : '<div class="vx-ap-empty">Fähigkeiten konnten nicht ermittelt werden.</div>'}</div>`;

    const technicalCard = document.createElement('section');
    technicalCard.id = 'vx-assistant-status-extension';
    technicalCard.className = 'vx-ap-card';
    technicalCard.innerHTML = `<div class="vx-ap-head"><div><div class="vx-ap-title">Einrichtung</div><div class="vx-ap-meta">Der aktuelle Zustand der wichtigsten Verbindungen.</div></div></div><div class="vx-as-tech">${technicalRow('Assistent', technical.assistant)}${technicalRow('Telefonie', technical.forwarding)}${technicalRow('Stimme & Einstellungen', technical.voice_sync)}${technicalRow('Kalender', technical.calendar)}</div>`;

    if (businessCard) stack.insertBefore(capabilitiesCard, businessCard);
    else stack.appendChild(capabilitiesCard);
    stack.appendChild(technicalCard);
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

  function observeStatusBody(body) {
    if (statusObserver || typeof MutationObserver !== 'function') return;
    statusObserver = new MutationObserver(() => {
      if (!body.querySelector('#vx-assistant-status-extension') && body.querySelector('.vx-ap-stack')) {
        snapshot = null;
      }
      schedule();
    });
    statusObserver.observe(body, { childList: true, subtree: true });
  }

  function boot() {
    const body = document.getElementById('vx-assistant-profile-body');
    if (!body) {
      bootAttempts += 1;
      if (bootAttempts < 80) root.setTimeout(boot, 250);
      return;
    }

    observeStatusBody(body);
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('#vx-assistant-profile-entry,[data-vx-root-tab="assistent"]')) {
        snapshot = null;
        root.setTimeout(schedule, 100);
      }
    });
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
