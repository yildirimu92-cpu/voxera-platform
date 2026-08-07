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

  function inject() {
    const main = document.getElementById('mehr-main');
    const tab = document.getElementById('tab-mehr');
    if (!main || !tab) return false;

    if (!document.getElementById('vx-calendar-settings-entry')) {
      const list = main.querySelector('.vx-settings-list') || main.querySelector('.vx-appbar')?.nextElementSibling;
      if (list) {
        const entry = document.createElement('button');
        entry.type = 'button';
        entry.id = 'vx-calendar-settings-entry';
        entry.className = 'vx-settings-entry vx-settings-entry--calendar';
        entry.hidden = false;
        entry.innerHTML = '<span class="vx-settings-entry-icon"><i class="ph-bold ph-calendar-dots" aria-hidden="true"></i></span><span class="vx-settings-entry-copy"><span class="vx-settings-entry-title">Kalender</span><span id="vx-calendar-entry-sub" class="vx-settings-entry-subtitle">Kalender verbinden</span></span><i class="ph-bold ph-caret-right vx-settings-entry-caret" aria-hidden="true"></i>';
        entry.addEventListener('click', open);
        const help = Array.from(list.children).find((child) => /Hilfe/.test(child.textContent || ''));
        list.insertBefore(entry, help || null);
      }
    }

    if (!document.getElementById('mehr-sub-kalender')) {
      const page = document.createElement('div');
      page.id = 'mehr-sub-kalender';
      page.className = 'vx-cal-page';
      page.hidden = true;
      page.innerHTML = (root.VoxeraUI
        ? root.VoxeraUI.appBar({ title: 'Kalenderintegration', back: { label: 'Zurück zu Einstellungen' } })
        : '<header class="vx-appbar"><button type="button" class="vx-appbar-back" aria-label="Zurück zu Einstellungen"><i class="ph-bold ph-arrow-left" aria-hidden="true"></i></button><h1 class="vx-appbar-title">Kalenderintegration</h1></header>'
      ) + '<div id="vx-calendar-page-body"></div>';
      tab.appendChild(page);
      const backButton = page.querySelector('.vx-appbar-back');
      backButton.setAttribute('data-cal-back', '');
      backButton.addEventListener('click', () => {
        if (typeof root.vxScreenBack === 'function') root.vxScreenBack(back);
        else back();
      });
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

  function visibleProviders() {
    const configured = state?.provider_configured || {};
    const announced = Array.isArray(state?.available_providers) ? state.available_providers : Object.keys(providerLabels);
    return announced.filter((provider) => providerLabels[provider] && (configured[provider] === true || connection(provider)));
  }

  function noticeOptions(value) {
    const selected = Number(value || 120);
    const presets = [[30, '30 Minuten'], [60, '1 Stunde'], [120, '2 Stunden'], [360, '6 Stunden'], [720, '12 Stunden'], [1440, '24 Stunden'], [2880, '2 Tage'], [4320, '3 Tage'], [5760, '4 Tage'], [10080, '7 Tage']];
    if (!presets.some(([minutes]) => minutes === selected)) presets.unshift([selected, selected + ' Minuten']);
    return presets.map(([minutes, label]) => '<option value="' + minutes + '"' + (minutes === selected ? ' selected' : '') + '>' + label + '</option>').join('');
  }

  function providerCard(provider) {
    const item = connection(provider);
    const configured = state?.provider_configured?.[provider] === true;
    const connected = item?.status === 'connected';
    const disabled = !state?.enabled || !configured || busy;
    const calendars = Array.isArray(item?.calendars) ? item.calendars.filter((calendar) => calendar.writable !== false) : [];
    return '<div class="vx-cal-card"><div class="vx-cal-head"><div><div class="vx-cal-provider">' + esc(providerLabels[provider]) + '</div><div class="vx-cal-meta">' + (connected ? esc(item.account_email || item.account_label || 'Verbunden') : configured ? 'Bereit zur Verbindung' : 'OAuth-Konfiguration fehlt') + '</div></div><span class="vx-cal-pill ' + (connected ? 'ok' : '') + '">' + (connected ? 'Verbunden' : 'Nicht verbunden') + '</span></div>' +
      (connected ? '<div class="vx-cal-field vx-cal-field--spaced"><label>Buchungskalender</label><select data-calendar-select="' + provider + '">' + calendars.map((calendar) => '<option value="' + esc(calendar.id) + '"' + (calendar.id === item.selected_calendar_id ? ' selected' : '') + '>' + esc(calendar.name) + (calendar.primary ? ' · Standard' : '') + '</option>').join('') + '</select></div>' : '') +
      '<div class="vx-cal-actions">' +
      (connected
        ? '<button type="button" class="btn vx-cal-btn secondary" data-calendar-test="' + provider + '"' + (busy ? ' disabled' : '') + '>Verbindung prüfen</button><button type="button" class="btn vx-cal-btn danger" data-calendar-disconnect="' + provider + '"' + (busy ? ' disabled' : '') + '>Trennen</button>'
        : '<button type="button" class="btn vx-cal-btn" data-calendar-connect="' + provider + '"' + (disabled ? ' disabled' : '') + '>Verbinden</button>') +
      '</div></div>';
  }

  function render() {
    const body = document.getElementById('vx-calendar-page-body');
    if (!body) return;
    if (!state) {
      body.innerHTML = root.VoxeraUI
        ? root.VoxeraUI.skeleton({ lines: 3, label: 'Kalenderintegration', inset: true, block: true })
        : '';
      return;
    }

    const providers = visibleProviders();
    const entry = document.getElementById('vx-calendar-settings-entry');
    if (entry) entry.hidden = false;
    const settings = state.settings || {};
    const connectedProviders = (state.connections || []).filter((item) => item.status === 'connected');
    const activeOptions = connectedProviders.map((item) => '<option value="' + item.provider + '"' + (settings.active_provider === item.provider ? ' selected' : '') + '>' + providerLabels[item.provider] + '</option>').join('');
    const providerCards = providers.length
      ? providers.map((provider) => providerCard(provider)).join('')
      : '<div class="vx-cal-card"><div class="vx-cal-provider">Kein Kalenderanbieter verfügbar</div><div class="vx-cal-meta">Die OAuth-Konfiguration ist noch nicht vollständig.</div></div>';
    const providerSummary = providers.map((provider) => providerLabels[provider]).join(' und ');

    const availabilityBanner = state.enabled ? '' : '<div class="vx-cal-banner">Sicher vorbereitet, aber noch nicht produktiv aktiviert. Verbindungen und Buchungen sind gesperrt.</div>';

    body.innerHTML =
      availabilityBanner + '<div id="vx-calendar-status" class="vx-cal-status" role="status" aria-live="polite"></div>' +
      '<div class="vx-cal-grid' + (providers.length === 1 ? ' single' : '') + '">' + providerCards + '</div>' +
      '<div class="vx-cal-card vx-cal-rules-card"><div class="vx-cal-provider">Buchungsregeln</div><div class="vx-cal-meta">Diese Regeln gelten unabhängig vom verbundenen Anbieter.</div><div class="vx-cal-form vx-cal-form--spaced">' +
      '<div class="vx-cal-field"><label>Aktiver Anbieter</label><select id="vx-cal-active-provider"><option value="">Nicht aktiv</option>' + activeOptions + '</select></div>' +
      '<div class="vx-cal-field"><label>Zeitzone</label><select id="vx-cal-timezone"><option value="Europe/Zurich"' + (settings.timezone === 'Europe/Zurich' ? ' selected' : '') + '>Europe/Zurich</option><option value="UTC"' + (settings.timezone === 'UTC' ? ' selected' : '') + '>UTC</option></select></div>' +
      '<div class="vx-cal-field"><label>Termindauer (Min.)</label><input id="vx-cal-duration" type="number" min="10" max="240" value="' + esc(settings.appointment_duration_minutes || 30) + '"></div>' +
      '<div class="vx-cal-field"><label>Mindestvorlauf</label><select id="vx-cal-notice">' + noticeOptions(settings.minimum_notice_minutes || 120) + '</select></div>' +
      '<div class="vx-cal-field"><label>Puffer vorher (Min.)</label><input id="vx-cal-buffer-before" type="number" min="0" max="180" value="' + esc(settings.buffer_before_minutes || 0) + '"></div>' +
      '<div class="vx-cal-field"><label>Puffer nachher (Min.)</label><input id="vx-cal-buffer-after" type="number" min="0" max="180" value="' + esc(settings.buffer_after_minutes || 10) + '"></div>' +
      '<div class="vx-cal-field"><label>Buchungshorizont (Tage)</label><input id="vx-cal-horizon" type="number" min="1" max="365" value="' + esc(settings.booking_horizon_days || 60) + '"></div>' +
      '<div class="vx-cal-field vx-cal-field--checkbox"><label class="vx-cal-checkbox"><input id="vx-cal-customer-enabled" type="checkbox"' + (settings.feature_enabled ? ' checked' : '') + '><span>Buchungen durch Assistent erlauben</span></label></div>' +
      '</div><div class="vx-cal-actions"><button type="button" class="btn vx-cal-btn" id="vx-calendar-save"' + (!state.enabled || busy ? ' disabled' : '') + '>Einstellungen speichern</button></div></div>';

    bind();
    const entrySub = document.getElementById('vx-calendar-entry-sub');
    if (entrySub) entrySub.textContent = connectedProviders.length ? connectedProviders.length + ' Anbieter verbunden' : state.enabled && providerSummary ? providerSummary + ' verbinden' : 'Vorbereitet · noch deaktiviert';
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
    render();
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
    let finalMessage = '✓ Änderung gespeichert.';
    let finalTone = 'success';
    try {
      state = await operation();
    } catch (error) {
      finalMessage = error?.message || 'Aktion fehlgeschlagen.';
      finalTone = 'error';
    } finally {
      busy = false;
      render();
      setStatus(finalMessage, finalTone);
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
      busy = false;
      render();
      setStatus(error?.message || 'Verbindung konnte nicht gestartet werden.', 'error');
      return;
    }
    busy = false;
    render();
    setStatus('Anmeldung wurde in einem neuen Fenster geöffnet.', 'loading');
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

  async function preload(attempt = 0) {
    if (typeof root.callDashboardFunction !== 'function') {
      if (attempt < 20) root.setTimeout(() => preload(attempt + 1), 300);
      return;
    }
    try {
      state = await call({ action: 'status' });
      render();
    } catch (_error) {
      if (attempt < 3) root.setTimeout(() => preload(attempt + 1), 1000);
    }
  }

  function setCalendarPageOpen(isOpen) {
    const main = document.getElementById('mehr-main');
    const page = document.getElementById('mehr-sub-kalender');
    if (!main || !page) return false;
    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => { node.hidden = true; });
    page.removeAttribute('style');
    if (isOpen) {
      main.hidden = true;
      page.hidden = false;
    } else {
      page.hidden = true;
      main.hidden = false;
    }
    // The calendar page opens outside vxMehrShow, so it registers itself with
    // the shared sub-screen history that the .vx-appbar back arrow uses.
    if (isOpen) root.vxScreenNav?.enter('mehr:kalender');
    else root.vxScreenNav?.exit('mehr:kalender');
    return true;
  }

  function open() {
    if (!inject() || !setCalendarPageOpen(true)) return;
    render();
    load();
  }

  function back() {
    setCalendarPageOpen(false);
  }

  root.addEventListener('message', async (event) => {
    if (event.origin !== root.location.origin || event.data?.type !== 'voxera-calendar-oauth') return;
    if (event.data.payload?.ok) {
      await load();
      setStatus('✓ Kalender wurde verbunden.', 'success');
    } else {
      setStatus(event.data.payload?.error || 'OAuth-Verbindung fehlgeschlagen.', 'error');
    }
  });

  root.vxCalendarOpen = open;
  const install = () => {
    if (!inject()) {
      root.setTimeout(install, 300);
      return;
    }
    preload();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);
