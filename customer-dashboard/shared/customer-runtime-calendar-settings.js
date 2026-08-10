(function initVoxeraCalendarSettings(root) {
  'use strict';
  if (!root || !root.document || root.__vxCalendarSettingsInstalled) return;
  root.__vxCalendarSettingsInstalled = true;

  const providerLabels = { google: 'Google Calendar', microsoft: 'Microsoft 365 / Outlook' };

  // Anbieter-Marken als Inline-SVG. Bewusst keine externen Bilddateien: die
  // Seite laedt sonst fuer zwei kleine Marken zwei Anfragen, und ein
  // fehlendes Asset erzeugt eine leere Flaeche mitten in der Kopfzeile.
  // Die Markenfarben stehen als Literale — sie gehoeren Google und
  // Microsoft und duerfen sich gerade NICHT mit unseren Tokens aendern.
  const providerMarks = {
    google: '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
      + '<path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 1.9-1.6 4.9-4.5 6.9l6.9 5.3c4.1-3.8 6.6-9.4 6.6-15.5z"/>'
      + '<path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.9 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z"/>'
      + '<path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10z"/>'
      + '<path fill="#EA4335" d="M24 9.9c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.8 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14l7.1 5.5C13.3 13.7 18.2 9.9 24 9.9z"/>'
      + '</svg>',
    microsoft: '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
      + '<path fill="#F25022" d="M4 4h19v19H4z"/>'
      + '<path fill="#7FBA00" d="M25 4h19v19H25z"/>'
      + '<path fill="#00A4EF" d="M4 25h19v19H4z"/>'
      + '<path fill="#FFB900" d="M25 25h19v19H25z"/>'
      + '</svg>'
  };

  function providerMark(provider) {
    const mark = providerMarks[provider];
    return mark ? '<span class="vx-cal-provider-mark">' + mark + '</span>' : '';
  }
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
        entry.innerHTML = '<span class="vx-settings-entry-icon"><i class="ph-bold ph-calendar-dots" aria-hidden="true"></i></span><span class="vx-settings-entry-copy"><span class="vx-settings-entry-title">Kalender</span><span id="vx-calendar-entry-sub" class="vx-settings-entry-subtitle">Kalender verbinden</span></span><i class="ph-light ph-caret-right vx-settings-entry-caret" aria-hidden="true"></i>';
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

  // Klick-Test 10.08.: Beim geprueften Kunden standen in
  // `calendar_settings.business_hours` Mo–Fr 08:00–17:00, waehrend das
  // Geschaeftsprofil fuer dieselben Tage „geschlossen" anzeigte — zwei
  // Wahrheiten ueber dieselbe Sache, von denen der Kunde nur eine sehen konnte.
  //
  // Beim Nachpruefen zeigte sich, dass die zweite gar keine Wirkung hat:
  // `business_hours` hat heute keinen Leser. calendar-tool.js verwendet aus
  // calendar_settings nur active_provider, timezone, Termindauer, Puffer,
  // Mindestvorlauf und Horizont — die Terminbuchung prueft ueberhaupt keine
  // Oeffnungszeiten. Die Migration 2026-08-09_opening_hours.sql haelt das
  // ausdruecklich fest ("ist definiert, hat denselben Zuschnitt und keinen
  // Leser") und verweist auf F5/J3 als eigenen Auftrag.
  //
  // Die Zeile sagt deshalb genau das: ein hinterlegter Wert, der derzeit nichts
  // bewirkt. Sie darf keine Wirkung behaupten, die es nicht gibt — und sie nimmt
  // der offenen Entscheidung nichts vorweg, welche Quelle kuenftig fuehrt.
  const HOURS_DAY_LABELS = [
    ['mon', 'Mo'], ['tue', 'Di'], ['wed', 'Mi'], ['thu', 'Do'],
    ['fri', 'Fr'], ['sat', 'Sa'], ['sun', 'So']
  ];

  function bookingWindowRow(settings) {
    const week = settings && typeof settings.business_hours === 'object' && settings.business_hours
      ? settings.business_hours
      : null;
    if (!week) return '';
    const parts = HOURS_DAY_LABELS.map(([key, label]) => {
      const ranges = Array.isArray(week[key]) ? week[key] : [];
      const text = ranges.length
        ? ranges.map((pair) => (Array.isArray(pair) ? pair.filter(Boolean).join('–') : '')).filter(Boolean).join(', ')
        : '';
      return text ? label + ' ' + text : '';
    }).filter(Boolean);
    const summary = parts.length ? parts.join(' · ') : 'Kein Zeitfenster hinterlegt.';
    return '<div class="vx-cal-field vx-cal-field--wide"><label>Hinterlegtes Zeitfenster</label>'
      + '<div class="vx-cal-readout">' + esc(summary) + '</div>'
      + '<div class="vx-cal-meta">Dieser Wert ist gespeichert, wird bei der Terminbuchung aber noch nicht ausgewertet: '
      + 'der Assistent prüft derzeit keine Öffnungszeiten, sondern nur Mindestvorlauf, Puffer und Buchungshorizont. '
      + 'Was er am Telefon zu Öffnungszeiten sagt, steht separat im Geschäftsprofil.</div></div>';
  }

  // lead: die fuehrende Karte des Screens traegt den Marken-Streifen
  // (--vx-ui-brand-rule ueber .vx-ui-brand-rule). Genau eine pro Screen und
  // zustandsunabhaengig — siehe customer-ui-components.css, Abschnitt 9.
  function providerCard(provider, lead) {
    const item = connection(provider);
    const configured = state?.provider_configured?.[provider] === true;
    const connected = item?.status === 'connected';
    const disabled = !state?.enabled || !configured || busy;
    const calendars = Array.isArray(item?.calendars) ? item.calendars.filter((calendar) => calendar.writable !== false) : [];
    return '<div class="vx-cal-card' + (lead ? ' vx-ui-brand-rule' : '') + '"><div class="vx-cal-head"><div><div class="vx-cal-provider">' + providerMark(provider) + '<span>' + esc(providerLabels[provider]) + '</span></div><div class="vx-cal-meta">' + (connected ? esc(item.account_email || item.account_label || 'Verbunden') : configured ? 'Bereit zur Verbindung' : 'OAuth-Konfiguration fehlt') + '</div></div><span class="vx-cal-pill ' + (connected ? 'ok' : '') + '">' + (connected ? 'Verbunden' : 'Nicht verbunden') + '</span></div>' +
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
    let activeOptions = connectedProviders.map((item) => '<option value="' + item.provider + '"' + (settings.active_provider === item.provider ? ' selected' : '') + '>' + providerLabels[item.provider] + '</option>').join('');

    // Klick-Test 10.08.: Der gespeicherte Anbieter verschwand spurlos aus der
    // Liste, sobald seine Verbindung nicht mehr `connected` war (typisch:
    // abgelaufenes Refresh-Token -> `reauthorization_required`). Die Auswahl
    // stand dann auf „Nicht aktiv", obwohl in der Datenbank weiterhin ein
    // Anbieter hinterlegt war — und `save()` schrieb genau dieses „Nicht aktiv"
    // zurueck. Wer nur die Termindauer aendern wollte, schaltete damit
    // unbemerkt die Kalenderbuchung ab.
    //
    // Bewusst NICHT im Speicherpfad geloest: `save_settings` ist serverseitig
    // eine Vollzustands-Speicherung mit Querpruefungen (feature_enabled
    // verlangt einen aktiven Anbieter; ein aktiver Anbieter verlangt eine
    // verbundene Verbindung mit gewaehltem Kalender). Nur geaenderte Felder zu
    // schicken wuerde diese Pruefungen unterlaufen, den gespeicherten Wert
    // mitzuschicken wuerde am 409 scheitern. Richtig ist, den Zustand ehrlich
    // zu zeigen und in ihm nicht zu speichern.
    const storedProvider = String(settings.active_provider || '');
    const storedIsConnected = connectedProviders.some((item) => item.provider === storedProvider);
    const storedConnection = (state.connections || []).find((item) => item.provider === storedProvider);
    const storedNeedsAttention = !!storedProvider && !storedIsConnected;
    if (storedNeedsAttention) {
      const reason = storedConnection ? 'Neuanmeldung nötig' : 'Verbindung fehlt';
      activeOptions += '<option value="' + esc(storedProvider) + '" selected>'
        + esc(providerLabels[storedProvider] || storedProvider) + ' — ' + reason + '</option>';
    }
    const providerCards = providers.length
      ? providers.map((provider, index) => providerCard(provider, index === 0)).join('')
      : '<div class="vx-cal-card vx-ui-brand-rule"><div class="vx-cal-provider">Kein Kalenderanbieter verfügbar</div><div class="vx-cal-meta">Die OAuth-Konfiguration ist noch nicht vollständig.</div></div>';
    const providerSummary = providers.map((provider) => providerLabels[provider]).join(' und ');

    const availabilityBanner = state.enabled ? '' : '<div class="vx-cal-banner">Sicher vorbereitet, aber noch nicht produktiv aktiviert. Verbindungen und Buchungen sind gesperrt.</div>';

    body.innerHTML =
      availabilityBanner + '<div id="vx-calendar-status" class="vx-cal-status" role="status" aria-live="polite"></div>' +
      '<div class="vx-cal-grid' + (providers.length === 1 ? ' single' : '') + '">' + providerCards + '</div>' +
      '<div class="vx-cal-card vx-cal-rules-card"><div class="vx-cal-provider">Buchungsregeln</div><div class="vx-cal-meta">Diese Regeln gelten unabhängig vom verbundenen Anbieter.</div><div class="vx-cal-form vx-cal-form--spaced">' +
      '<div class="vx-cal-field"><label>Aktiver Anbieter</label><select id="vx-cal-active-provider"'
        + (storedNeedsAttention ? ' disabled' : '') + '><option value="">Nicht aktiv</option>' + activeOptions + '</select>'
        + (storedNeedsAttention
          ? '<div class="vx-cal-meta">' + esc(providerLabels[storedProvider] || storedProvider)
            + ' ist weiterhin als aktiver Anbieter gespeichert. Solange die Verbindung nicht erneuert ist, bleiben die Buchungsregeln unverändert und können nicht gespeichert werden.</div>'
          : '')
        + '</div>' +
      '<div class="vx-cal-field"><label>Zeitzone</label><select id="vx-cal-timezone"><option value="Europe/Zurich"' + (settings.timezone === 'Europe/Zurich' ? ' selected' : '') + '>Europe/Zurich</option><option value="UTC"' + (settings.timezone === 'UTC' ? ' selected' : '') + '>UTC</option></select></div>' +
      '<div class="vx-cal-field"><label>Termindauer (Min.)</label><input id="vx-cal-duration" type="number" min="10" max="240" value="' + esc(settings.appointment_duration_minutes || 30) + '"></div>' +
      '<div class="vx-cal-field"><label>Mindestvorlauf</label><select id="vx-cal-notice">' + noticeOptions(settings.minimum_notice_minutes || 120) + '</select></div>' +
      '<div class="vx-cal-field"><label>Puffer vorher (Min.)</label><input id="vx-cal-buffer-before" type="number" min="0" max="180" value="' + esc(settings.buffer_before_minutes || 0) + '"></div>' +
      '<div class="vx-cal-field"><label>Puffer nachher (Min.)</label><input id="vx-cal-buffer-after" type="number" min="0" max="180" value="' + esc(settings.buffer_after_minutes || 10) + '"></div>' +
      '<div class="vx-cal-field"><label>Buchungshorizont (Tage)</label><input id="vx-cal-horizon" type="number" min="1" max="365" value="' + esc(settings.booking_horizon_days || 60) + '"></div>' +
      '<div class="vx-cal-field vx-cal-field--checkbox"><label class="vx-cal-checkbox"><input id="vx-cal-customer-enabled" type="checkbox"' + (settings.feature_enabled ? ' checked' : '') + '><span>Buchungen durch Assistent erlauben</span></label></div>' +
      bookingWindowRow(settings) +
      '</div><div class="vx-cal-actions"><button type="button" class="btn vx-cal-btn" id="vx-calendar-save"'
        + (!state.enabled || busy || storedNeedsAttention ? ' disabled' : '') + '>Einstellungen speichern</button></div></div>';

    bind();
    const entrySub = document.getElementById('vx-calendar-entry-sub');
    if (entrySub) entrySub.textContent = connectedProviders.length ? connectedProviders.length + ' Anbieter verbunden' : state.enabled && providerSummary ? providerSummary + ' verbinden' : 'Vorbereitet · noch deaktiviert';
  }

  function bind() {
    document.querySelectorAll('[data-calendar-connect]').forEach((node) => node.addEventListener('click', () => connect(node.dataset.calendarConnect, node)));
    document.querySelectorAll('[data-calendar-test]').forEach((node) => node.addEventListener('click', () => test(node.dataset.calendarTest, node)));
    document.querySelectorAll('[data-calendar-disconnect]').forEach((node) => node.addEventListener('click', () => disconnect(node.dataset.calendarDisconnect, node)));
    document.querySelectorAll('[data-calendar-select]').forEach((node) => node.addEventListener('change', () => selectCalendar(node.dataset.calendarSelect, node.value)));
    document.getElementById('vx-calendar-save')?.addEventListener('click', (event) => save(event.currentTarget));
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

  // button: the element to animate (Speichert … → Gespeichert ✓ → its
  // original label). Pass null for actions without one of their own (e.g. a
  // <select> change) — those fall back to the small inline status line,
  // which never scrolls the page.
  async function run(button, message, operation) {
    if (busy) return;
    busy = true;
    if (!button) setStatus(message, 'loading');
    let finalMessage = '';
    let finalTone = null;
    try {
      state = await root.vxInlineSaveStatus(button, operation, { savingLabel: message, doneLabel: '✓ Gespeichert' });
      if (!button) { finalMessage = '✓ Gespeichert.'; finalTone = 'success'; }
    } catch (error) {
      finalMessage = error?.message || 'Aktion fehlgeschlagen.';
      finalTone = 'error';
    } finally {
      busy = false;
      render();
      setStatus(finalMessage, finalTone);
    }
  }

  async function connect(provider, button) {
    if (busy) return;
    busy = true;
    try {
      await root.vxInlineSaveStatus(button, async () => {
        const result = await call({ action: 'oauth_start', provider });
        const popup = root.open(result.authorize_url, 'voxera-calendar-oauth', 'width=620,height=760,resizable=yes,scrollbars=yes');
        if (!popup) throw new Error('Popup wurde blockiert. Bitte Popups für Voxera erlauben.');
      }, { savingLabel: 'Verbindet …', doneLabel: 'Fenster geöffnet ✓' });
    } catch (error) {
      setStatus(error?.message || 'Verbindung konnte nicht gestartet werden.', 'error');
    } finally {
      busy = false;
    }
  }

  function test(provider, button) {
    run(button, 'Prüft …', () => call({ action: 'test', provider }));
  }

  async function disconnect(provider, button) {
    if (!root.confirm(providerLabels[provider] + ' wirklich trennen?')) return;
    run(button, 'Trennt …', () => call({ action: 'disconnect', provider }));
  }

  function selectCalendar(provider, calendarId) {
    run(null, 'Buchungskalender wird gespeichert …', () => call({ action: 'select_calendar', provider, calendar_id: calendarId }));
  }

  function save(button) {
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
    run(button, 'Speichert …', () => call({ action: 'save_settings', settings }));
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
