(function initVoxeraCalendarSettings(root) {
  'use strict';
  if (!root || !root.document || root.__vxCalendarSettingsInstalled) return;
  root.__vxCalendarSettingsInstalled = true;

  const providerLabels = { google: 'Google Calendar', microsoft: 'Microsoft 365 / Outlook' };
  let state = null;
  let busy = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function style() {
    if (document.getElementById('vx-calendar-settings-style')) return;
    const node = document.createElement('style');
    node.id = 'vx-calendar-settings-style';
    node.textContent = [
      '.vx-cal-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.vx-cal-card{background:#fff;border:.5px solid var(--line,#e4e8f0);border-radius:14px;padding:16px}.vx-cal-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.vx-cal-provider{font-size:14px;font-weight:700;color:var(--ink,#0d1f3c)}.vx-cal-meta{font-size:12px;color:var(--slate2,#7a8599);margin-top:4px;line-height:1.5}.vx-cal-pill{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:650;background:#f1f5f9;color:#64748b}.vx-cal-pill.ok{background:#ecfdf5;color:#047857}.vx-cal-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.vx-cal-btn{border:0;border-radius:9px;padding:9px 12px;font:600 12px inherit;cursor:pointer;background:#0d1f3c;color:#fff}.vx-cal-btn.secondary{background:#eef4ff;color:#1a6fe8}.vx-cal-btn.danger{background:#fef2f2;color:#b91c1c}.vx-cal-btn:disabled{opacity:.45;cursor:not-allowed}.vx-cal-banner{padding:12px 14px;border-radius:11px;margin-bottom:14px;font-size:13px;background:#fff7ed;color:#9a3412}.vx-cal-banner.ok{background:#ecfdf5;color:#047857}.vx-cal-status{display:none;margin:12px 0;padding:10px 12px;border-radius:10px;font-size:12px}.vx-cal-status.loading{display:block;background:#eff6ff;color:#1d4ed8}.vx-cal-status.success{display:block;background:#ecfdf5;color:#047857}.vx-cal-status.error{display:block;background:#fef2f2;color:#b91c1c}.vx-cal-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.vx-cal-field label{display:block;font-size:11px;font-weight:650;color:var(--slate2,#7a8599);margin-bottom:5px}.vx-cal-field input,.vx-cal-field select{width:100%;box-sizing:border-box;border:.5px solid var(--line,#e4e8f0);border-radius:9px;padding:10px 11px;background:#fff;color:var(--ink,#0d1f3c);font:500 13px inherit}@media(max-width:720px){.vx-cal-grid,.vx-cal-form{grid-template-columns:1fr}}'
    ].join('');
    document.head.appendChild(node);
  }

  function inject() {
    style();
    const main = document.getElementById('mehr-main');
    const tab = document.getElementById('tab-mehr');
    if (!main || !tab) return false;
    if (!document.getElementById('vx-calendar-settings-entry')) {
      const list = main.querySelector('.vx-page-header')?.nextElementSibling;
      if (list) {
        const entry = document.createElement('div');
        entry.id = 'vx-calendar-settings-entry';
        entry.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;border-bottom:.5px solid var(--line)';
        entry.innerHTML = '<div style="width:36px;height:36px;background:#eef4ff;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ph-bold ph-calendar-dots" style="color:#1a6fe8;font-size:17px" aria-hidden="true"></i></div><div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--ink)">Kalender</div><div id="vx-calendar-entry-sub" style="font-size:11px;color:var(--slate2)">Google und Microsoft verbinden</div></div><i class="ph-bold ph-caret-right" style="color:var(--slate2);font-size:15px" aria-hidden="true"></i>';
        entry.addEventListener('click', open);
        const help = Array.from(list.children).find((child) => /Hilfe/.test(child.textContent || ''));
        list.insertBefore(entry, help || null);
      }
    }
    if (!document.getElementById('mehr-sub-kalender')) {
      const page = document.createElement('div');
      page.id = 'mehr-sub-kalender';
      page.style.display = 'none';
      page.innerHTML = '<div class="vx-page-header" style="align-items:center;gap:12px"><button type="button" class="vx-back-btn" data-cal-back><i class="ph-bold ph-arrow-left" style="font-size:18px" aria-hidden="true"></i></button><div style="flex:1"><div class="vx-page-header-title">Kalenderintegration</div><div style="font-size:12px;color:var(--slate2);margin-top:3px">Google Calendar und Microsoft 365 sicher mit Voxera verbinden.</div></div></div><div id="vx-calendar-page-body"></div>';
      tab.appendChild(page);
      page.querySelector('[data-cal-back]').addEventListener('click', back);
    }
    return true;
  }

  function setStatus(message, tone) {
    const node = document.getElementById('vx-calendar-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'vx-cal-status' + (message ? ' ' + (tone || 'loading') : '');
  }

  function connection(provider) {
    return (state?.connections || []).find((item) => item.provider === provider) || null;
  }

  function providerCard(provider) {
    const item = connection(provider);
    const configured = state?.provider_configured?.[provider] === true;
    const connected = item?.status === 'connected';
    const disabled = !state?.enabled || !configured || busy;
    const calendars = Array.isArray(item?.calendars) ? item.calendars.filter((calendar) => calendar.writable !== false) : [];
    return '<div class="vx-cal-card"><div class="vx-cal-head"><div><div class="vx-cal-provider">' + esc(providerLabels[provider]) + '</div><div class="vx-cal-meta">' + (connected ? esc(item.account_email || item.account_label || 'Verbunden') : configured ? 'Bereit zur Verbindung' : 'OAuth-Konfiguration fehlt') + '</div></div><span class="vx-cal-pill ' + (connected ? 'ok' : '') + '">' + (connected ? 'Verbunden' : 'Nicht verbunden') + '</span></div>' +
      (connected ? '<div class="vx-cal-field" style="margin-top:14px"><label>Buchungskalender</label><select data-calendar-select="' + provider + '">' + calendars.map((calendar) => '<option value="' + esc(calendar.id) + '"' + (calendar.id === item.selected_calendar_id ? ' selected' : '') + '>' + esc(calendar.name) + (calendar.primary ? ' · Standard' : '') + '</option>').join('') + '</select></div>' : '') +
      '<div class="vx-cal-actions">' +
      (connected
        ? '<button type="button" class="vx-cal-btn secondary" data-calendar-test="' + provider + '"' + (busy ? ' disabled' : '') + '>Verbindung prüfen</button><button type="button" class="vx-cal-btn danger" data-calendar-disconnect="' + provider + '"' + (busy ? ' disabled' : '') + '>Trennen</button>'
        : '<button type="button" class="vx-cal-btn" data-calendar-connect="' + provider + '"' + (disabled ? ' disabled' : '') + '>Verbinden</button>') +
      '</div></div>';
  }

  function render() {
    const body = document.getElementById('vx-calendar-page-body');
    if (!body) return;
    if (!state) {
      body.innerHTML = '<div class="vx-cal-banner">Kalenderstatus wird geladen …</div>';
      return;
    }
    const settings = state.settings || {};
    const connectedProviders = (state.connections || []).filter((item) => item.status === 'connected');
    const activeOptions = connectedProviders.map((item) => '<option value="' + item.provider + '"' + (settings.active_provider === item.provider ? ' selected' : '') + '>' + providerLabels[item.provider] + '</option>').join('');
    body.innerHTML =
      '<div class="vx-cal-banner ' + (state.enabled ? 'ok' : '') + '">' +
      (state.enabled ? 'Kalenderintegration ist freigeschaltet. Verbindungen bleiben kundenspezifisch.' : 'Sicher vorbereitet, aber noch nicht produktiv aktiviert. Verbindungen und Buchungen sind gesperrt.') +
      '</div><div id="vx-calendar-status" class="vx-cal-status" role="status" aria-live="polite"></div>' +
      '<div class="vx-cal-grid">' + providerCard('google') + providerCard('microsoft') + '</div>' +
      '<div class="vx-cal-card" style="margin-top:12px"><div class="vx-cal-provider">Buchungsregeln</div><div class="vx-cal-meta">Diese Regeln gelten unabhängig vom verbundenen Anbieter.</div><div class="vx-cal-form" style="margin-top:14px">' +
      '<div class="vx-cal-field"><label>Aktiver Anbieter</label><select id="vx-cal-active-provider"><option value="">Nicht aktiv</option>' + activeOptions + '</select></div>' +
      '<div class="vx-cal-field"><label>Zeitzone</label><select id="vx-cal-timezone"><option value="Europe/Zurich"' + (settings.timezone === 'Europe/Zurich' ? ' selected' : '') + '>Europe/Zurich</option><option value="UTC"' + (settings.timezone === 'UTC' ? ' selected' : '') + '>UTC</option></select></div>' +
      '<div class="vx-cal-field"><label>Termindauer (Min.)</label><input id="vx-cal-duration" type="number" min="10" max="240" value="' + esc(settings.appointment_duration_minutes || 30) + '"></div>' +
      '<div class="vx-cal-field"><label>Mindestvorlauf (Min.)</label><input id="vx-cal-notice" type="number" min="0" max="10080" value="' + esc(settings.minimum_notice_minutes || 120) + '"></div>' +
      '<div class="vx-cal-field"><label>Puffer vorher (Min.)</label><input id="vx-cal-buffer-before" type="number" min="0" max="180" value="' + esc(settings.buffer_before_minutes || 0) + '"></div>' +
      '<div class="vx-cal-field"><label>Puffer nachher (Min.)</label><input id="vx-cal-buffer-after" type="number" min="0" max="180" value="' + esc(settings.buffer_after_minutes || 10) + '"></div>' +
      '<div class="vx-cal-field"><label>Buchungshorizont (Tage)</label><input id="vx-cal-horizon" type="number" min="1" max="365" value="' + esc(settings.booking_horizon_days || 60) + '"></div>' +
      '<div class="vx-cal-field"><label><input id="vx-cal-customer-enabled" type="checkbox" style="width:auto;margin-right:6px"' + (settings.feature_enabled ? ' checked' : '') + '>Buchungen durch Assistent erlauben</label></div>' +
      '</div><div class="vx-cal-actions"><button type="button" class="vx-cal-btn" id="vx-calendar-save"' + (!state.enabled || busy ? ' disabled' : '') + '>Einstellungen speichern</button></div></div>';
    bind();
    const entrySub = document.getElementById('vx-calendar-entry-sub');
    if (entrySub) entrySub.textContent = connectedProviders.length ? connectedProviders.length + ' Anbieter verbunden' : state.enabled ? 'Google und Microsoft verbinden' : 'Vorbereitet · noch deaktiviert';
  }

  function bind() {
    document.querySelectorAll('[data-calendar-connect]').forEach((node) => node.addEventListener('click', () => connect(node.dataset.calendarConnect)));
    document.querySelectorAll('[data-calendar-test]').forEach((node) => node.addEventListener('click', () => test(node.dataset.calendarTest)));
    document.querySelectorAll('[data-calendar-disconnect]').forEach((node) => node.addEventListener('click', () => disconnect(node.dataset.calendarDisconnect)));
    document.querySelectorAll('[data-calendar-select]').forEach((node) => node.addEventListener('change', () => selectCalendar(node.dataset.calendarSelect, node.value)));
    document.getElementById('vx-calendar-save')?.addEventListener('click', save);
  }

  async function call(payload) {
    if (typeof root.callDashboardFunction !== 'function') throw new Error('Dashboard-Funktion ist nicht verfügbar.');
    return root.callDashboardFunction('calendar-connections', payload);
  }

  async function load() {
    setStatus('Kalenderstatus wird geladen …', 'loading');
    try {
      state = await call({ action: 'status' });
      render();
    } catch (error) {
      setStatus(error?.message || 'Kalenderstatus konnte nicht geladen werden.', 'error');
    }
  }

  async function run(message, operation) {
    if (busy) return;
    busy = true;
    render();
    setStatus(message, 'loading');
    try {
      state = await operation();
      render();
      setStatus('✓ Änderung gespeichert.', 'success');
    } catch (error) {
      render();
      setStatus(error?.message || 'Aktion fehlgeschlagen.', 'error');
    } finally {
      busy = false;
      render();
    }
  }

  async function connect(provider) {
    if (busy) return;
    try {
      busy = true;
      render();
      setStatus(providerLabels[provider] + ' wird vorbereitet …', 'loading');
      const result = await call({ action: 'oauth_start', provider });
      const popup = root.open(result.authorize_url, 'voxera-calendar-oauth', 'width=620,height=760,resizable=yes,scrollbars=yes');
      if (!popup) throw new Error('Popup wurde blockiert. Bitte Popups für Voxera erlauben.');
      setStatus('Anmeldung wurde in einem neuen Fenster geöffnet.', 'loading');
    } catch (error) {
      setStatus(error?.message || 'Verbindung konnte nicht gestartet werden.', 'error');
    } finally {
      busy = false;
      render();
    }
  }

  function test(provider) {
    run('Verbindung wird geprüft …', () => call({ action: 'test', provider }));
  }

  async function disconnect(provider) {
    if (!root.confirm(providerLabels[provider] + ' wirklich trennen?')) return;
    run('Kalender wird getrennt …', () => call({ action: 'disconnect', provider }));
  }

  function selectCalendar(provider, calendarId) {
    run('Buchungskalender wird gespeichert …', () => call({ action: 'select_calendar', provider, calendar_id: calendarId }));
  }

  function save() {
    const settings = {
      active_provider: document.getElementById('vx-cal-active-provider')?.value || null,
      timezone: document.getElementById('vx-cal-timezone')?.value || 'Europe/Zurich',
      appointment_duration_minutes: Number(document.getElementById('vx-cal-duration')?.value || 30),
      minimum_notice_minutes: Number(document.getElementById('vx-cal-notice')?.value || 0),
      buffer_before_minutes: Number(document.getElementById('vx-cal-buffer-before')?.value || 0),
      buffer_after_minutes: Number(document.getElementById('vx-cal-buffer-after')?.value || 0),
      booking_horizon_days: Number(document.getElementById('vx-cal-horizon')?.value || 60),
      feature_enabled: document.getElementById('vx-cal-customer-enabled')?.checked === true
    };
    run('Einstellungen werden gespeichert …', () => call({ action: 'save_settings', settings }));
  }

  function open() {
    if (!inject()) return;
    document.getElementById('mehr-main').style.display = 'none';
    document.querySelectorAll('[id^="mehr-sub-"]').forEach((node) => { node.style.display = 'none'; });
    document.getElementById('mehr-sub-kalender').style.display = 'block';
    render();
    load();
  }

  function back() {
    document.querySelectorAll('[id^="mehr-sub-"]').forEach((node) => { node.style.display = 'none'; });
    document.getElementById('mehr-main').style.display = 'block';
  }

  root.addEventListener('message', (event) => {
    if (event.origin !== root.location.origin || event.data?.type !== 'voxera-calendar-oauth') return;
    if (event.data.payload?.ok) {
      load();
      setStatus('✓ Kalender wurde verbunden.', 'success');
    } else {
      setStatus(event.data.payload?.error || 'OAuth-Verbindung fehlgeschlagen.', 'error');
    }
  });

  root.vxCalendarOpen = open;
  const install = () => {
    if (!inject()) root.setTimeout(install, 300);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);
