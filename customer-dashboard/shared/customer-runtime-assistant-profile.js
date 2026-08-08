(function initVoxeraAssistantProfile(root) {
  'use strict';
  if (!root || !root.document || root.__vxAssistantProfileInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxAssistantProfileInstalled = true;

  let profile = null;
  let voices = [];
  let voiceFilter = 'all';
  let busy = false;
  let previewLoading = false;
  let pendingVoiceId = '';
  let activeAudio = null;
  let activeAudioUrl = '';
  let bootAttempts = 0;
  let activeView = 'assistant';
  let loadPromise = null;
  let loadSequence = 0;
  const pageStatus = { assistant: null, business: null };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function ensurePage(id, bodyId, label) {
    const tab = document.getElementById('tab-assistent');
    if (!tab) return false;
    if (!document.getElementById(id)) {
      const page = document.createElement('div');
      page.id = id;
      page.hidden = true;
      page.setAttribute('aria-label', label);
      page.innerHTML = '<div id="' + bodyId + '"></div>';
      tab.appendChild(page);
    }
    return true;
  }

  function inject() {
    if (!ensurePage('mehr-sub-assistant-profile', 'vx-assistant-profile-body', 'Mein Assistent')) return false;
    if (!ensurePage('mehr-sub-business-profile', 'vx-business-profile-body', 'Geschäftsprofil')) return false;
    if (!document.getElementById('vx-assistant-voice-modal')) {
      const modal = document.createElement('div');
      modal.id = 'vx-assistant-voice-modal';
      modal.className = 'vx-ap-modal';
      modal.innerHTML = '<div class="vx-ap-dialog" role="dialog" aria-modal="true" aria-labelledby="vx-ap-modal-title"><div class="vx-ap-title" id="vx-ap-modal-title">Stimme übernehmen?</div><div class="vx-ap-meta vx-ap-modal-copy" id="vx-ap-modal-copy"></div><div class="vx-ap-actions vx-ap-actions--end"><button type="button" class="vx-ap-btn ghost" data-vx-voice-cancel>Abbrechen</button><button type="button" class="vx-ap-btn" data-vx-voice-confirm>Stimme übernehmen</button></div></div>';
      document.body.appendChild(modal);
      modal.querySelector('[data-vx-voice-cancel]').addEventListener('click', closeVoiceModal);
      modal.querySelector('[data-vx-voice-confirm]').addEventListener('click', confirmVoiceChange);
      modal.addEventListener('click', (event) => { if (event.target === modal) closeVoiceModal(); });
    }
    return true;
  }

  function open(view) {
    if (!inject()) return null;
    activeView = view === 'business' ? 'business' : 'assistant';
    if (activeView === 'business') renderBusiness();
    else renderAssistant();
    return profile ? Promise.resolve(profile) : load();
  }

  async function token() {
    const client = typeof root.getSupabaseAuthClient === 'function' ? root.getSupabaseAuthClient() : root._sb;
    if (!client?.auth?.getSession) throw new Error('Ihre Sitzung ist nicht verfügbar.');
    const result = await client.auth.getSession();
    const accessToken = String(result?.data?.session?.access_token || '').trim();
    if (!accessToken) throw new Error('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
    return accessToken;
  }

  async function request(name, options = {}) {
    const accessToken = await token();
    const response = await fetch('/.netlify/functions/' + name, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Aktion fehlgeschlagen.');
    return payload;
  }

  function previewErrorMessage(payload, status) {
    const code = String(payload?.provider_code || payload?.metadata_code || payload?.error || '').trim();
    const reason = String(payload?.reason || '').trim();
    if (['payment_required', 'quota_exceeded', 'credits_exhausted'].includes(code)) {
      return 'Für die individuelle Sprachvorschau ist ein aktives ElevenLabs-Abonnement oder Guthaben erforderlich.';
    }
    if (code === 'missing_permissions') {
      return 'Der ElevenLabs-Schlüssel benötigt Lesezugriff auf Stimmen.';
    }
    if (reason === 'managed_preview_not_generated') {
      return 'Die individuelle Vorschau wurde noch nicht erzeugt. Bis dahin ist keine Ersatzvorschau verfügbar.';
    }
    if (status === 401) return 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.';
    if (status === 403) return 'Diese Stimme ist in Ihrem Paket nicht verfügbar.';
    return 'Sprachvorschau konnte nicht geladen werden.';
  }

  async function loadVoicePreview(voiceId) {
    const accessToken = await token();
    const response = await fetch('/.netlify/functions/preview-voice', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg, audio/*, application/octet-stream'
      },
      body: JSON.stringify({ voice_id: voiceId }),
      cache: 'no-store'
    });

    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch (_error) {}
      throw new Error(previewErrorMessage(payload, response.status));
    }

    return {
      blob: await response.blob(),
      notice: String(response.headers.get('X-Voxera-Preview-Notice') || '')
    };
  }

  // The save button itself carries the saving/done state (see
  // vxInlineSaveStatus). These status nodes are reserved for messages that
  // outlive that brief animation — sync warnings and errors — so they are
  // written to, but the page is never scrolled to reveal them.
  function statusNodes(page) {
    return {
      page: document.getElementById(page === 'business' ? 'vx-business-profile-status' : 'vx-assistant-profile-status'),
      anchorId: page === 'business' ? 'vx-business-save-status' : 'vx-assistant-name-status'
    };
  }

  function paintStatus(node, message, tone, inline) {
    if (!node) return;
    node.textContent = message || '';
    node.className = 'vx-ap-status'
      + (inline ? ' vx-ap-status--inline' : '')
      + (message ? ' ' + (tone || 'loading') : '');
  }

  function setStatus(page, message, tone, anchored) {
    pageStatus[page] = message ? { message, tone: tone || 'loading', anchored: !!anchored } : null;
    const nodes = statusNodes(page);
    const anchor = anchored ? document.getElementById(nodes.anchorId) : null;
    const target = anchor || nodes.page;
    // Only one of the two ever carries the message.
    paintStatus(nodes.page, target === nodes.page ? message : '', tone, false);
    paintStatus(document.getElementById(nodes.anchorId), target === anchor ? message : '', tone, true);
  }

  function restoreStatus(page) {
    const current = pageStatus[page];
    if (current) setStatus(page, current.message, current.tone, current.anchored);
  }

  function genderKey(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['female', 'weiblich', 'woman', 'f'].includes(normalized)) return 'female';
    if (['male', 'männlich', 'maennlich', 'man', 'm'].includes(normalized)) return 'male';
    return 'other';
  }

  function genderLabel(value) {
    const key = genderKey(value);
    return key === 'female' ? 'Weiblich' : key === 'male' ? 'Männlich' : 'Neutral';
  }

  // Wortlaut bewusst gleich wie im Prompt-Builder (toneMap in
  // prompt-builder-v2.js) — der Kunde soll denselben Begriff lesen, nach dem
  // sein Assistent tatsächlich spricht. Ohne 'formal'/'casual' stand hier bisher
  // der rohe Datenbankwert.
  function toneLabel(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'professional') return 'warm-professionell';
    if (normalized === 'formal') return 'konservativ-formell';
    if (normalized === 'casual') return 'locker und direkt';
    return normalized ? String(value) : 'warm-professionell';
  }

  function addressLabel(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'sie') return 'Sie';
    if (normalized === 'du') return 'Du';
    return String(value || 'Sie');
  }

  const CHANGE_PRESETS = [
    ['Branche wechseln', 'Ich möchte die Branche wechseln auf: '],
    ['Weiterleitung einrichten', 'Bitte eine Weiterleitung einrichten: '],
    ['Individuelle Anpassung', 'Ich benötige eine individuelle Anpassung: '],
    ['Sonstiges', 'Sonstige Anfrage: ']
  ];

  function urgentForwardingRow(item) {
    return '<div class="vx-ap-summary-row"><span class="vx-ap-summary-key">' + esc(item.name) + '</span><span class="vx-ap-summary-value">' + esc(item.number) + (item.trigger ? ' · ' + esc(item.trigger) : '') + '</span></div>';
  }

  function urgentCard() {
    const urgent = profile?.urgent || { emergency_number: '', forwarding: [] };
    const forwarding = Array.isArray(urgent.forwarding) ? urgent.forwarding : [];
    const hasEmergency = Boolean(urgent.emergency_number);
    const hasForwarding = forwarding.length > 0;
    // Notfallnummer hat serverseitig immer einen Default (144) — ein reines
    // "irgendwas vorhanden?"-Flag würde die Weiterleitungs-Leerzeile deshalb
    // nie zeigen. Beide Zustände unabhängig behandeln.
    const body = (hasEmergency || hasForwarding)
      ? '<div class="vx-ap-summary">'
        + (hasEmergency ? '<div class="vx-ap-summary-row vx-ap-urgent-emergency"><span class="vx-ap-summary-key">Notfallnummer</span><span class="vx-ap-summary-value vx-ap-urgent-number">' + esc(urgent.emergency_number) + '</span></div>' : '')
        + (hasForwarding
          ? forwarding.map(urgentForwardingRow).join('')
          : '<div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Weiterleitung</span><span class="vx-ap-summary-value">Noch nicht eingerichtet</span></div>')
        + '</div>'
      : (root.VoxeraUI
        ? root.VoxeraUI.emptyState({ icon: 'ph-phone-transfer', title: 'Keine Weiterleitung eingerichtet', text: 'Notfallnummer und Weiterleitungsziele erscheinen hier, sobald sie eingerichtet sind.' })
        : '<div class="vx-ap-empty">Keine Weiterleitung eingerichtet.</div>');
    return '<section class="vx-ap-card" id="vx-assistant-urgent-card">'
      + '<div class="vx-ap-head"><div><div class="vx-ap-title">Wenn es dringend wird</div><div class="vx-ap-meta">Änderungen an Weiterleitung und Notfallnummer bestätigt Voxera vor der Aktivierung.</div></div></div>'
      + body
      + '<div class="vx-ap-actions"><button type="button" class="vx-ap-btn secondary" id="vx-urgent-change-toggle" aria-expanded="false" aria-controls="vx-urgent-change-panel">Änderung melden</button></div>'
      + '<div id="vx-urgent-change-panel" class="vx-ap-change-panel" hidden>'
      + '<div class="vx-ap-change-presets">' + CHANGE_PRESETS.map(([label, prefix]) => '<button type="button" class="vx-ap-btn ghost" data-vx-change-preset="' + esc(prefix) + '">' + esc(label) + '</button>').join('') + '</div>'
      + '<div class="vx-ap-field"><label for="vx-urgent-change-msg">Ihre Änderungsanfrage</label><textarea id="vx-urgent-change-msg" maxlength="6000" placeholder="Beschreiben Sie Ihre Wünsche …"></textarea></div>'
      + '<div class="vx-ap-actions"><button type="button" class="vx-ap-btn" id="vx-urgent-change-submit">Anfrage senden</button></div>'
      + '<div id="vx-urgent-change-feedback" class="vx-ap-urgent-feedback" role="status" aria-live="polite" hidden></div>'
      + '</div>'
      + '</section>';
  }

  function toggleUrgentChangePanel() {
    const panel = document.getElementById('vx-urgent-change-panel');
    const toggle = document.getElementById('vx-urgent-change-toggle');
    if (!panel || !toggle) return;
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) document.getElementById('vx-urgent-change-msg')?.focus();
  }

  function prefillUrgentChange(prefix) {
    const panel = document.getElementById('vx-urgent-change-panel');
    const toggle = document.getElementById('vx-urgent-change-toggle');
    if (panel?.hidden) {
      panel.hidden = false;
      toggle?.setAttribute('aria-expanded', 'true');
    }
    const field = document.getElementById('vx-urgent-change-msg');
    if (!field) return;
    field.value = prefix || '';
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  async function submitUrgentChange() {
    if (typeof root.submitAssistentChange === 'function') await root.submitAssistentChange();
  }

  function selectedVoice() {
    const selectedId = profile?.assistant?.voice_id || '';
    return voices.find((voice) => voice.voice_id === selectedId) || null;
  }

  function formatDay(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', dateStyle: 'long' }).format(date);
  }

  // Einzige Stelle, an der aus den vier Einzelzuständen ein Satz wird. Die
  // Betriebsstatus-Karte rendert bewusst keine eigene Zusammenfassung mehr —
  // ein Screen, eine Statuszeile.
  function statusSummary(technical) {
    const states = [technical?.assistant, technical?.forwarding, technical?.voice_sync, technical?.calendar]
      .map((item) => String(item?.status || '').toLowerCase());
    if (states.includes('error')) return { tone: 'error', text: 'Mindestens eine Verbindung ist aktuell nicht betriebsbereit.' };
    if (states.includes('attention')) return { tone: 'attention', text: 'Mindestens eine Einrichtung benötigt noch Ihre Aufmerksamkeit.' };
    return { tone: 'active', text: 'Die wichtigsten Verbindungen sind betriebsbereit.' };
  }

  // Kopfbereich: der Satz, den Anrufende hören, in der Serifen-Schrift —
  // Serife = Stimme, Sans = Bedienung (Design-System, Etappe 3).
  function heroCard() {
    const greeting = profile?.greeting || { text: null, source: 'none' };
    const current = selectedVoice();
    const technical = profile?.technical_status || {};
    const summary = statusSummary(technical);
    const lastSync = formatDay(technical.last_successful_sync_at);

    const voicePart = current ? 'Stimme ' + esc(current.display_name || 'Standardstimme') : 'Stimme von Voxera eingerichtet';
    const addressPart = String(profile?.assistant?.address_form || '').toLowerCase() === 'du' ? 'Du-Form' : 'Sie-Form';
    const meta = [voicePart, addressPart, esc(toneLabel(profile?.assistant?.tone))].join(' · ');

    const spoken = greeting.text
      ? '<p class="vx-ap-hero-greeting">„' + esc(greeting.text) + '"</p>'
      : '<p class="vx-ap-hero-greeting is-pending">Der Begrüssungssatz entsteht, sobald Ihr Assistent aktiviert ist.</p>';
    const notice = greeting.source === 'custom'
      ? '<div class="vx-ap-hero-note">Noch nicht an den Assistenten übertragen.</div>'
      : '';

    const statusLine = summary.text + (lastSync ? ' · Zuletzt aktualisiert am ' + esc(lastSync) : '');

    return '<section class="vx-ap-card vx-ap-hero">' +
      '<div class="vx-ap-hero-label">So meldet sich Ihr Assistent</div>' +
      spoken + notice +
      '<div class="vx-ap-hero-foot"><div class="vx-ap-hero-meta">' + meta + '</div>' +
      (current ? '<button type="button" class="vx-ap-btn secondary" data-vx-preview="' + esc(current.voice_id) + '"' + (previewLoading ? ' disabled' : '') + '><i class="ph-bold ph-play" aria-hidden="true"></i> Anhören</button>' : '') +
      '</div>' +
      '<div class="vx-ap-hero-status ' + summary.tone + '">' + statusLine + '</div>' +
      '</section>';
  }

  function voiceCard(voice) {
    const selected = voice.voice_id === profile?.assistant?.voice_id;
    return '<div class="vx-ap-voice' + (selected ? ' selected' : '') + '"><div class="vx-ap-voice-top"><div><div class="vx-ap-voice-name">' + esc(voice.display_name || 'Stimme') + '</div><div class="vx-ap-meta">' + esc(genderLabel(voice.gender)) + (voice.language ? ' · ' + esc(voice.language) : '') + '</div></div>' + (selected ? '<span class="vx-ap-pill selected">Aktuell</span>' : '<span class="vx-ap-pill">' + esc(voice.available_from_plan || '') + '</span>') + '</div><div class="vx-ap-meta">' + esc(voice.description || 'Kuratierte Voxera-Stimme') + '</div><div class="vx-ap-actions vx-ap-actions--push"><button type="button" class="vx-ap-btn secondary" data-vx-preview="' + esc(voice.voice_id) + '"' + (busy || previewLoading ? ' disabled' : '') + '><i class="ph-bold ph-play" aria-hidden="true"></i> Anhören</button>' + (selected ? '' : '<button type="button" class="vx-ap-btn" data-vx-select-voice="' + esc(voice.voice_id) + '"' + (!profile?.permissions?.can_change_voice || busy ? ' disabled' : '') + '>Auswählen</button>') + '</div></div>';
  }

  function renderAssistant() {
    const body = document.getElementById('vx-assistant-profile-body');
    if (!body) return;
    if (!profile) {
      body.innerHTML = root.VoxeraUI
        ? root.VoxeraUI.skeleton({ lines: 3, label: 'Assistent', inset: true, block: true })
        : '';
      return;
    }
    const current = selectedVoice();
    const filtered = voices.filter((voice) => voiceFilter === 'all' || genderKey(voice.gender) === voiceFilter);
    const business = profile.business_profile || {};
    const completed = Number(business.completed_fields || 0);
    const total = Number(business.total_fields || 4);
    body.innerHTML = '<div id="vx-assistant-profile-status" class="vx-ap-status" role="status" aria-live="polite"></div><div class="vx-ap-stack">' +
      heroCard() +
      '<section class="vx-ap-card"><div class="vx-ap-head"><div><div class="vx-ap-title">Stimme</div><div class="vx-ap-meta">Wählen Sie aus kuratierten Stimmen. Technische Sprachparameter bleiben geschützt.</div></div></div><div class="vx-ap-current"><div class="vx-ap-avatar"><i class="ph-bold ph-waveform" aria-hidden="true"></i></div><div class="vx-ap-current-copy"><div class="vx-ap-title">' + esc(current?.display_name || 'Standardstimme') + '</div><div class="vx-ap-meta">' + esc(current ? genderLabel(current.gender) : 'Von Voxera eingerichtet') + '</div></div>' + '</div>' +
      (profile.permissions?.can_change_voice ? '<div class="vx-ap-filters"><button type="button" class="vx-ap-filter' + (voiceFilter === 'all' ? ' active' : '') + '" data-vx-filter="all">Alle</button><button type="button" class="vx-ap-filter' + (voiceFilter === 'female' ? ' active' : '') + '" data-vx-filter="female">Weiblich</button><button type="button" class="vx-ap-filter' + (voiceFilter === 'male' ? ' active' : '') + '" data-vx-filter="male">Männlich</button></div><div class="vx-ap-voices">' + (filtered.length ? filtered.map(voiceCard).join('') : '<div class="vx-ap-empty">Für diesen Filter sind keine Stimmen freigeschaltet.</div>') + '</div>' : '<div class="vx-ap-status warning vx-ap-status--inline">Die Stimmenauswahl ist in Ihrem aktuellen Paket nicht freigeschaltet.</div>') + '</section>' +
      '<section class="vx-ap-card"><div class="vx-ap-title">Name und Auftreten</div><div class="vx-ap-meta">Der Name ist die Bezeichnung, mit der sich der Assistent meldet.</div>' +
      (profile.permissions?.can_change_name ? '<div class="vx-ap-field"><label>Name des Assistenten</label><input id="vx-assistant-name" maxlength="40" value="' + esc(profile.assistant?.name || '') + '" placeholder="z. B. Lea"></div><div class="vx-ap-actions"><button type="button" class="vx-ap-btn" id="vx-assistant-name-save"' + (busy ? ' disabled' : '') + '>Name speichern</button></div><div id="vx-assistant-name-status" class="vx-ap-status vx-ap-status--inline" role="status" aria-live="polite"></div>' : '<div class="vx-ap-summary"><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Name</span><span class="vx-ap-summary-value">' + esc(profile.assistant?.name || 'Von Voxera eingerichtet') + '</span></div></div>') +
      '<div class="vx-ap-summary"><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Kommunikationsstil</span><span class="vx-ap-summary-value">' + esc(toneLabel(profile.assistant?.tone)) + '</span></div><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Ansprache</span><span class="vx-ap-summary-value">' + esc(addressLabel(profile.assistant?.address_form)) + '</span></div><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Assistent</span><span class="vx-ap-summary-value">' + (profile.assistant?.has_agent ? 'Bereit' : 'Noch nicht aktiviert') + '</span></div></div></section>' +
      '<section class="vx-ap-card"><div class="vx-ap-head"><div><div class="vx-ap-title">Geschäftswissen</div><div class="vx-ap-meta">Dauerhafte Informationen werden zentral im Geschäftsprofil gepflegt.</div></div><span class="vx-ap-pill' + (completed === total ? ' selected' : '') + '">' + completed + ' von ' + total + ' Bereichen</span></div><div class="vx-ap-summary"><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Unternehmen</span><span class="vx-ap-summary-value">' + esc(business.company_name || 'Nicht angegeben') + '</span></div><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Leistungen</span><span class="vx-ap-summary-value">' + esc(business.services ? 'Hinterlegt' : 'Noch ergänzen') + '</span></div><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Öffnungszeiten / Standort</span><span class="vx-ap-summary-value">' + esc(business.location_hours ? 'Hinterlegt' : 'Noch ergänzen') + '</span></div></div><div class="vx-ap-actions"><button type="button" class="vx-ap-btn secondary" id="vx-open-business-profile">Geschäftsprofil öffnen</button></div></section>' +
      urgentCard() + '</div>';
    bindAssistant();
    restoreStatus('assistant');
  }

  function renderBusiness() {
    const body = document.getElementById('vx-business-profile-body');
    if (!body) return;
    if (!profile) {
      body.innerHTML = root.VoxeraUI
        ? root.VoxeraUI.skeleton({ lines: 3, label: 'Geschäftsprofil', inset: true, block: true })
        : '';
      return;
    }
    const data = profile.business_profile || {};
    body.innerHTML = '<div id="vx-business-profile-status" class="vx-ap-status" role="status" aria-live="polite"></div><div class="vx-ap-card"><div class="vx-ap-head"><div><div class="vx-ap-title">Dauerhaftes Geschäftswissen</div><div class="vx-ap-meta">Diese Informationen verwendet der Assistent im normalen Betrieb. Ferien und kurzfristige Änderungen gehören in „Aktuelle Infos“.</div></div></div><div class="vx-ap-grid"><div class="vx-ap-field"><label>Unternehmensbeschreibung</label><textarea id="vx-business-description" placeholder="Was macht Ihr Unternehmen und für wen?">' + esc(data.description || '') + '</textarea></div><div class="vx-ap-field"><label>Leistungen und Angebote</label><textarea id="vx-business-services" placeholder="Welche Leistungen darf der Assistent erklären?">' + esc(data.services || '') + '</textarea></div><div class="vx-ap-field"><label>Standort und reguläre Öffnungszeiten</label><textarea id="vx-business-location-hours" placeholder="Adresse, Einzugsgebiet und reguläre Öffnungszeiten">' + esc(data.location_hours || '') + '</textarea></div><div class="vx-ap-field"><label>Häufige Fragen und Buchungshinweise</label><textarea id="vx-business-booking-faq" placeholder="Wichtige Antworten, Voraussetzungen oder Hinweise">' + esc(data.booking_faq || '') + '</textarea></div></div><div class="vx-ap-actions"><button type="button" class="vx-ap-btn" id="vx-business-profile-save"' + (busy ? ' disabled' : '') + '>Geschäftsprofil speichern</button></div><div id="vx-business-save-status" class="vx-ap-status vx-ap-status--inline" role="status" aria-live="polite"></div></div>';
    document.getElementById('vx-business-profile-save')?.addEventListener('click', saveBusiness);
    restoreStatus('business');
  }

  function bindAssistant() {
    document.querySelectorAll('[data-vx-filter]').forEach((node) => node.addEventListener('click', () => {
      voiceFilter = node.dataset.vxFilter || 'all';
      renderAssistant();
    }));
    document.querySelectorAll('[data-vx-preview]').forEach((node) => node.addEventListener('click', () => previewVoice(node.dataset.vxPreview, node)));
    document.querySelectorAll('[data-vx-select-voice]').forEach((node) => node.addEventListener('click', () => openVoiceModal(node.dataset.vxSelectVoice)));
    document.getElementById('vx-assistant-name-save')?.addEventListener('click', saveName);
    document.getElementById('vx-open-business-profile')?.addEventListener('click', () => root.vxShowAssistantView?.('business', true));
    document.getElementById('vx-urgent-change-toggle')?.addEventListener('click', toggleUrgentChangePanel);
    document.querySelectorAll('[data-vx-change-preset]').forEach((node) => node.addEventListener('click', () => prefillUrgentChange(node.dataset.vxChangePreset)));
    document.getElementById('vx-urgent-change-submit')?.addEventListener('click', submitUrgentChange);
  }

  async function load() {
    if (loadPromise) return loadPromise;
    const sequence = ++loadSequence;
    activeView === 'business' ? renderBusiness() : renderAssistant();

    loadPromise = (async () => {
      try {
        const [profileResult, voiceResult] = await Promise.all([
          request('customer-assistant-profile'),
          request('get-available-voices')
        ]);
        if (sequence !== loadSequence) return null;
        profile = profileResult;
        voices = Array.isArray(voiceResult.voices) ? voiceResult.voices : [];
        if (!profile.assistant.voice_id && voiceResult.selected_voice_id) profile.assistant.voice_id = voiceResult.selected_voice_id;
        pageStatus.assistant = null;
        pageStatus.business = null;
        renderAssistant();
        renderBusiness();
        return profile;
      } catch (error) {
        if (sequence !== loadSequence) return null;
        const message = error?.message || 'Assistent konnte nicht geladen werden.';
        const assistantBody = document.getElementById('vx-assistant-profile-body');
        const businessBody = document.getElementById('vx-business-profile-body');
        if (assistantBody) assistantBody.innerHTML = '<div class="vx-ap-status error">' + esc(message) + '</div>';
        if (businessBody) businessBody.innerHTML = '<div class="vx-ap-status error">' + esc(message) + '</div>';
        return null;
      } finally {
        if (sequence === loadSequence) loadPromise = null;
      }
    })();

    return loadPromise;
  }

  // Without the full-page re-render that used to run at the start of every
  // save, the `busy` guard on updateAssistant() no longer shows up as
  // `disabled` on the *other* assistant controls (voice select/preview,
  // the sibling save button). Toggle them directly so a voice change or a
  // second save can't be triggered mid-request and get silently dropped by
  // the `busy` check below.
  function setAssistantActionsDisabled(disabled) {
    ['vx-assistant-name-save', 'vx-business-profile-save', 'vx-open-business-profile'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = disabled;
    });
    document.querySelectorAll('[data-vx-select-voice], [data-vx-preview]').forEach((node) => { node.disabled = disabled; });
  }

  // button: the save button to animate (Speichert … → Gespeichert ✓ → its
  // original label). Pass null when the action has no persistent button of
  // its own (e.g. the voice-change confirm dialog, which closes before the
  // request completes) — the section still gets a brief, self-clearing
  // inline note instead.
  async function updateAssistant(payload, page, button, savingLabel) {
    if (busy) return null;
    busy = true;
    setAssistantActionsDisabled(true);
    let result = null;
    let finalMessage = '';
    let finalTone = null;
    try {
      result = await root.vxInlineSaveStatus(button, async () => {
        const response = await request('customer-update-assistant', { method: 'POST', body: payload });
        await reloadProfile();
        return response;
      }, { savingLabel: savingLabel || 'Speichert …', doneLabel: 'Gespeichert ✓' });
      const syncStatus = String(result.sync_status || '');
      if (syncStatus === 'failed') {
        finalMessage = 'Gespeichert, aber noch nicht mit dem Assistenten synchronisiert. Bitte später erneut versuchen.';
        finalTone = 'warning';
      } else if (syncStatus === 'skipped_no_agent') {
        finalMessage = 'Gespeichert. Der Assistent ist noch nicht eingerichtet.';
        finalTone = 'warning';
      }
    } catch (error) {
      finalMessage = error?.message || 'Änderung konnte nicht gespeichert werden.';
      finalTone = 'error';
    } finally {
      busy = false;
      page === 'business' ? renderBusiness() : renderAssistant();
      if (finalTone) {
        setStatus(page, finalMessage, finalTone, true);
      } else if (button) {
        // Clean, button-confirmed success: clear any stale error/warning
        // left over from an earlier attempt so restoreStatus() (called by
        // the render above) doesn't resurrect it.
        setStatus(page, '', null, true);
      } else {
        setStatus(page, '✓ Gespeichert.', 'success', true);
        root.setTimeout(() => {
          if (pageStatus[page] && pageStatus[page].message === '✓ Gespeichert.') setStatus(page, '', null, true);
        }, 2500);
      }
    }
    return result;
  }

  async function reloadProfile() {
    const result = await request('customer-assistant-profile');
    profile = result;
  }

  async function saveName() {
    const value = String(document.getElementById('vx-assistant-name')?.value || '').trim();
    await updateAssistant({ assistant_name: value }, 'assistant', document.getElementById('vx-assistant-name-save'));
  }

  async function saveBusiness() {
    const payload = {
      ai_business_description: document.getElementById('vx-business-description')?.value || '',
      ai_services: document.getElementById('vx-business-services')?.value || '',
      ai_location_hours: document.getElementById('vx-business-location-hours')?.value || '',
      ai_booking_faq: document.getElementById('vx-business-booking-faq')?.value || ''
    };
    await updateAssistant(payload, 'business', document.getElementById('vx-business-profile-save'));
  }

  function openVoiceModal(voiceId) {
    const voice = voices.find((item) => item.voice_id === voiceId);
    if (!voice || !profile?.permissions?.can_change_voice) return;
    pendingVoiceId = voiceId;
    const copy = document.getElementById('vx-ap-modal-copy');
    if (copy) copy.textContent = 'Die Stimme „' + (voice.display_name || 'Ausgewählte Stimme') + '“ wird nach dem Speichern direkt mit Ihrem Assistenten synchronisiert.';
    document.getElementById('vx-assistant-voice-modal')?.classList.add('open');
  }

  function closeVoiceModal() {
    pendingVoiceId = '';
    document.getElementById('vx-assistant-voice-modal')?.classList.remove('open');
  }

  async function confirmVoiceChange() {
    const voiceId = pendingVoiceId;
    closeVoiceModal();
    if (!voiceId) return;
    await updateAssistant({ voice_id: voiceId }, 'assistant', null);
  }

  function stopAudio() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    if (activeAudioUrl) {
      root.URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = '';
    }
  }

  async function previewVoice(voiceId, button) {
    if (!voiceId || busy || previewLoading) return;
    previewLoading = true;
    stopAudio();
    setStatus('assistant', '', '');

    const original = button?.innerHTML;
    const previewButtons = Array.from(document.querySelectorAll('[data-vx-preview]'));
    previewButtons.forEach((node) => { node.disabled = true; });
    if (button) button.textContent = 'Wird vorbereitet …';

    try {
      const result = await loadVoicePreview(voiceId);
      activeAudioUrl = root.URL.createObjectURL(result.blob);
      activeAudio = new Audio(activeAudioUrl);
      activeAudio.addEventListener('ended', stopAudio, { once: true });
      await activeAudio.play();
      if (result.notice === 'custom-preview-pending') {
        setStatus('assistant', 'Vorläufige Standardvorschau. Der individuelle Voxera-Text wird verfügbar, sobald er im Admin erzeugt wurde.', 'warning');
      }
    } catch (error) {
      setStatus('assistant', error?.message || 'Sprachvorschau konnte nicht abgespielt werden.', 'error');
    } finally {
      previewLoading = false;
      previewButtons.forEach((node) => { node.disabled = false; });
      if (button) button.innerHTML = original || 'Anhören';
    }
  }

  function boot() {
    if (!inject()) {
      bootAttempts += 1;
      if (bootAttempts < 80) root.setTimeout(boot, 250);
      return;
    }
    root.addEventListener('beforeunload', stopAudio, { once: true });
  }

  root.vxAssistantProfileOpen = open;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
