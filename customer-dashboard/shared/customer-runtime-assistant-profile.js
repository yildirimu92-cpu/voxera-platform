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
  let toneEditorOpen = false;
  let forwardingEditorOpen = false;
  let forwardingSecondSlotOpen = false;
  let voiceDetailsOpen = false;
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
    if (!ensurePage('vx-assistant-view-profile', 'vx-assistant-profile-body', 'Mein Assistent')) return false;
    if (!ensurePage('vx-assistant-view-business', 'vx-business-profile-body', 'Geschäftsprofil')) return false;
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
      // Solange der Identitaets-Editor offen ist, ist er die Stelle, an der
      // gearbeitet wird — die Meldung gehoert dorthin. Ist er zu, gibt es
      // keinen naeheren Anker mehr: das Namensfeld sass frueher in einer
      // eigenen Karte und ist mit der Umgliederung in den Editor gewandert.
      // Ohne Anker schreibt setStatus an den Seitenknoten.
      anchorId: page === 'business'
        ? 'vx-business-save-status'
        : (toneEditorOpen ? 'vx-hero-tune-status' : (forwardingEditorOpen ? 'vx-forwarding-status' : ''))
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

  // Herkunft statt Zustaendigkeitsraten: jede Kategorie sagt, woher ihr Inhalt
  // kommt. Drei Zustaende, mehr gibt es nicht — "von Ihnen", "von Voxera",
  // "aus Ihrer Branche". Damit ist die Layer-Sichtbarkeit (S5/E4) Teil der
  // Gliederung statt eine eigene Karte, und nur Kategorien werden gezeigt,
  // nie der Prompt-Wortlaut.
  function originChip(kind, label) {
    return '<span class="vx-ap-origin vx-ap-origin--' + kind + '"><i aria-hidden="true"></i>' + esc(label) + '</span>';
  }

  function ruleList(items, limit) {
    const list = (Array.isArray(items) ? items : []).slice(0, limit || 6);
    if (!list.length) return '';
    return '<ul class="vx-ap-rules">' + list.map((item) => '<li>' + esc(item) + '</li>').join('') + '</ul>';
  }

  function industryLine() {
    const industry = profile?.industry || {};
    if (industry.assigned && industry.name) return originChip('branch', 'Aus Ihrer Branche: ' + industry.name);
    return originChip('branch', 'Noch keine Branche zugeordnet');
  }

  // N6 — die Weiterleitung ist wieder selbst bearbeitbar. Der Editor ist
  // bewusst ein Satz und kein Telefonanlagen-Formular (Grundsatz 15): drei
  // Felder, die zusammen "Wenn X, dann anrufen: Name unter Nummer" ergeben. Das
  // zweite Ziel erscheint erst, wenn es gebraucht wird — wer nur eine
  // Weiterleitung hat, sieht auch nur eine.
  function forwardingSlotFields(index, slot) {
    const prefix = 'vx-fwd-' + index;
    return '<div class="vx-ap-subsection">'
      + '<div class="vx-ap-subtitle">' + (index === 1 ? 'Weiterleitung' : 'Zweite Weiterleitung') + '</div>'
      + '<div class="vx-ap-fieldlist">'
      // Der Auslöser wird im Prompt zu „(bei: …)" — deshalb fragt das Feld nach
      // dem Fall und nicht nach einem Nebensatz. „Wenn jemand einen
      // Wasserschaden meldet" ergäbe dort „bei: jemand einen Wasserschaden
      // meldet"; der Assistent liest, was hier getippt wird.
      + '<div class="vx-ap-field"><label for="' + prefix + '-trigger">In welchem Fall?</label>'
      + '<input id="' + prefix + '-trigger" maxlength="500" value="' + esc(slot.trigger || '') + '"'
      + ' placeholder="z. B. Wasserschaden oder Rohrbruch"' + (busy ? ' disabled' : '') + '></div>'
      + '<div class="vx-ap-field"><label for="' + prefix + '-name">Dann anrufen</label>'
      + '<input id="' + prefix + '-name" maxlength="120" value="' + esc(slot.name || '') + '"'
      + ' placeholder="Name, z. B. Pikettdienst Meier"' + (busy ? ' disabled' : '') + '></div>'
      + '<div class="vx-ap-field"><label for="' + prefix + '-number">Nummer</label>'
      + '<input id="' + prefix + '-number" type="tel" inputmode="tel" maxlength="40" value="' + esc(slot.number || '') + '"'
      + ' placeholder="z. B. 079 123 45 67"' + (busy ? ' disabled' : '') + '></div>'
      + '</div>'
      + (index === 2
        ? '<div class="vx-ap-meta">Zum Entfernen die drei Felder leeren und speichern.</div>'
        : '')
      + '</div>';
  }

  function forwardingEditor(slots) {
    if (!forwardingEditorOpen) {
      const label = (slots[0].name || slots[0].number) ? 'Weiterleitung ändern' : 'Weiterleitung einrichten';
      return '<div class="vx-ap-actions"><button type="button" class="vx-ap-btn secondary" id="vx-forwarding-edit">' + label + '</button></div>';
    }
    const showSecond = forwardingSecondSlotOpen || Boolean(slots[1].name || slots[1].number || slots[1].trigger);
    return '<div class="vx-ap-subsection">'
      + '<div class="vx-ap-meta">Ihr Assistent verbindet nur weiter, wenn Name und Nummer beide hinterlegt sind. '
      + 'Sonst nimmt er das Anliegen wie gewohnt auf.</div>'
      + forwardingSlotFields(1, slots[0])
      + (showSecond
        ? forwardingSlotFields(2, slots[1])
        : '<div class="vx-ap-actions"><button type="button" class="vx-ap-linkbtn" id="vx-forwarding-add">+ Zweite Weiterleitung hinzufügen</button></div>')
      + '<div class="vx-ap-actions">'
      + '<button type="button" class="vx-ap-btn" id="vx-forwarding-save"' + (busy ? ' disabled' : '') + '>Weiterleitung speichern</button>'
      + '<button type="button" class="vx-ap-btn ghost" id="vx-forwarding-cancel"' + (busy ? ' disabled' : '') + '>Abbrechen</button>'
      + '</div>'
      + '<div id="vx-forwarding-status" class="vx-ap-status vx-ap-status--inline" role="status" aria-live="polite"></div>'
      + '</div>';
  }

  function boundariesCard() {
    const urgent = profile?.urgent || { emergency_number: '', forwarding: [] };
    const boundaries = profile?.boundaries || {};
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

    // Antwortgrenzen und Eskalationsstufen sind Kundendaten, aber nicht vom
    // Kunden bearbeitbar (BLOCKED_CUSTOMER_FIELDS). Lesbar sind sie trotzdem —
    // sonst weiss niemand, was der eigene Assistent nicht beantwortet.
    // Vorher standen drei Aufzählungen ohne Zwischenüberschrift direkt
    // untereinander — beim ersten Testkunden 13 Punkte am Stück, die wie eine
    // einzige lange Liste wirkten. Jetzt trägt jede Liste ihre eigene Frage,
    // und die Voxera-Regeln sind eingeklappt: sie sind für jeden Kunden
    // identisch und im Alltag der uninteressanteste der drei Blöcke.
    const limits = ruleList(boundaries.response_constraints, 5);
    const escalation = ruleList(boundaries.fallback_escalation, 4);
    const limitsBlock = limits
      ? '<div class="vx-ap-subsection"><div class="vx-ap-subtitle">Was Ihr Assistent nicht beantwortet</div>' + limits + '</div>'
      : '';
    const escalationBlock = escalation
      ? '<div class="vx-ap-subsection"><div class="vx-ap-subtitle">Was bei dringenden Fällen gilt</div>' + escalation + '</div>'
      : '';
    const industryBlock = (limits || escalation) ? '<div class="vx-ap-origin-row">' + industryLine() + '</div>' : '';

    const rules = ruleList(profile?.voxera_rules, 6);
    const rulesBlock = rules
      ? '<details class="vx-ap-subsection vx-ap-rules-details"><summary>Immer gültig — von Voxera gesetzt</summary>'
        + rules + originChip('voxera', 'Nicht überschreibbar') + '</details>'
      : '';

    // Die Kartenbeschreibung muss die Schreibregel treffen, die auf der Karte
    // gilt — sonst behauptet sie einen Bestaetigungsweg, den es fuer die
    // Weiterleitung nicht mehr gibt.
    const canEditForwarding = profile?.permissions?.can_change_forwarding === true;
    const slots = Array.isArray(urgent.slots) && urgent.slots.length === 2
      ? urgent.slots
      : [{ name: '', number: '', trigger: '' }, { name: '', number: '', trigger: '' }];
    const cardMeta = canEditForwarding
      ? 'Die Weiterleitung ändern Sie selbst — sie wirkt sofort. Die Notfallnummer bestätigt Voxera.'
      : 'Änderungen an Weiterleitung und Notfallnummer bestätigt Voxera vor der Aktivierung.';

    return '<section class="vx-ap-card" id="vx-assistant-urgent-card">'
      + '<div class="vx-ap-head"><div><div class="vx-ap-title">Grenzen und Eskalation</div><div class="vx-ap-meta">' + esc(cardMeta) + '</div></div></div>'
      + body
      + (canEditForwarding ? forwardingEditor(slots) : '')
      + limitsBlock
      + escalationBlock
      + industryBlock
      + rulesBlock
      + '<div class="vx-ap-actions"><button type="button" class="vx-ap-btn secondary" id="vx-urgent-change-toggle" aria-expanded="false" aria-controls="vx-urgent-change-panel">Änderung melden</button></div>'
      + '<div id="vx-urgent-change-panel" class="vx-ap-change-panel" hidden>'
      // Wer die Weiterleitung selbst bearbeiten kann, braucht dafuer keinen
      // Meldeweg — der Baustein stuende sonst als zweiter, langsamerer Weg
      // direkt neben dem Editor.
      + '<div class="vx-ap-change-presets">' + CHANGE_PRESETS
        .filter(([label]) => !(canEditForwarding && label === 'Weiterleitung einrichten'))
        .map(([label, prefix]) => '<button type="button" class="vx-ap-btn ghost" data-vx-change-preset="' + esc(prefix) + '">' + esc(label) + '</button>').join('') + '</div>'
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
  //
  // Grundsatz 13: Jeder angezeigte Status braucht eine erreichbare Handlung
  // oder eine Erklärung. „Mindestens eine Einrichtung benötigt noch Ihre
  // Aufmerksamkeit" hatte weder das eine noch das andere — es nannte weder die
  // Einrichtung noch sagte es, wer am Zug ist. Die Angaben dafür liegen alle
  // vor: technical_status trägt pro Bereich einen Klartext-Satz.
  const STATUS_AREAS = [
    { key: 'calendar', label: 'Kalender', action: { label: 'Kalender einrichten', open: 'kalender' } },
    { key: 'forwarding', label: 'Telefonie', hint: 'Rufnummer und Weiterleitung bestätigt Voxera — Sie müssen nichts tun.' },
    { key: 'assistant', label: 'Assistent', hint: 'Die Einrichtung übernimmt Voxera.' },
    { key: 'voice_sync', label: 'Stimme & Einstellungen', hint: 'Wird beim nächsten Speichern erneut übertragen.' }
  ];

  function statusSummary(technical) {
    const deviations = STATUS_AREAS
      .map((area) => ({ ...area, state: technical?.[area.key] }))
      .filter((area) => ['error', 'attention'].includes(String(area.state?.status || '').toLowerCase()));

    if (!deviations.length) {
      return { tone: 'active', text: 'Die wichtigsten Verbindungen sind betriebsbereit.', hint: '', action: null };
    }

    const first = deviations[0];
    const others = deviations.length - 1;
    const detail = String(first.state?.detail || first.state?.label || '').trim();
    const tone = deviations.some((area) => String(area.state?.status).toLowerCase() === 'error') ? 'error' : 'attention';
    // Mehrere Detailsaetze beginnen bereits mit dem Bereichsnamen ("Kalender ist
    // aktiviert, aber ..."). Ein Praefix davor ergaebe "Kalender: Kalender ist".
    const named = detail && detail.toLowerCase().startsWith(first.label.toLowerCase());
    return {
      tone,
      text: (named ? detail : first.label + ': ' + (detail || 'Einrichtung noch nicht abgeschlossen.'))
        + (others > 0 ? ' (und ' + others + ' weitere' + (others === 1 ? 'r Bereich' : ' Bereiche') + ')' : ''),
      hint: first.hint || '',
      action: first.action || null
    };
  }

  // Kopfbereich: der Satz, den Anrufende hören, in der Serifen-Schrift —
  // Serife = Stimme, Sans = Bedienung (Design-System, Etappe 3).
  // Wortlaut identisch mit dem Prompt-Builder (toneMap in prompt-builder-v2.js)
  // und mit toneLabel() weiter oben — der Kunde waehlt denselben Begriff, nach
  // dem sein Assistent anschliessend spricht.
  const ADDRESS_OPTIONS = [['sie', 'Sie-Form (formell)'], ['du', 'Du-Form (informell)']];
  const TONE_OPTIONS = [
    ['professional', 'warm-professionell'],
    ['formal', 'konservativ-formell'],
    ['casual', 'locker und direkt']
  ];

  function optionList(options, selected) {
    const active = String(selected || '').trim().toLowerCase();
    return options.map(([value, label]) => (
      '<option value="' + esc(value) + '"' + (active === value ? ' selected' : '') + '>' + esc(label) + '</option>'
    )).join('');
  }

  // Name, Ansprache und Ton werden dort geaendert, wo ihre Wirkung steht:
  // direkt unter dem Satz, den sie erzeugen. Vor der Umgliederung lagen sie auf
  // drei Karten verteilt und Ansprache/Ton standen doppelt auf dem Screen.
  function toneEditor() {
    if (!toneEditorOpen) {
      return '<div class="vx-ap-hero-tune"><button type="button" class="vx-ap-hero-tune-toggle" data-vx-tone-edit>Anpassen</button></div>';
    }
    // Einzige Quelle fuer die Sperre. Kein Plan-Name im Frontend — sonst waere
    // ein Freischalten wieder ein Deploy statt eines DB-Updates.
    const canTone = profile?.permissions?.can_change_tone === true;
    // Gesperrt wird als Wert gezeigt, nicht als deaktiviertes Feld: ein
    // <select disabled> zieht die kanonischen Disabled-Tokens aus
    // customer-ui-components.css und faerbt genau das grau, was hier lesbar
    // bleiben soll. Der Gold-Hinweis markiert die Sperre, die Schrift bleibt.
    const toneField = canTone
      ? '<div class="vx-ap-field"><label for="vx-hero-tone">Ton</label>' +
        '<select id="vx-hero-tone"' + (busy ? ' disabled' : '') + '>' + optionList(TONE_OPTIONS, profile?.assistant?.tone || 'professional') + '</select></div>'
      : '<div class="vx-ap-field"><span class="vx-ap-field-label">Ton <span class="vx-ap-plan-badge">ab Business</span></span>' +
        '<div class="vx-ap-hero-locked-value">' + esc(toneLabel(profile?.assistant?.tone)) + '</div></div>';

    const nameField = profile?.permissions?.can_change_name
      ? '<div class="vx-ap-field"><label for="vx-assistant-name">Name</label>' +
        '<input id="vx-assistant-name" maxlength="40" value="' + esc(profile?.assistant?.name || '') + '" placeholder="z. B. Lea"' + (busy ? ' disabled' : '') + '></div>'
      : '<div class="vx-ap-field"><span class="vx-ap-field-label">Name <span class="vx-ap-plan-badge">ab Business</span></span>' +
        '<div class="vx-ap-hero-locked-value">' + esc(profile?.assistant?.name || 'Von Voxera eingerichtet') + '</div></div>';

    return '<div class="vx-ap-hero-tune is-open">' +
      '<div class="vx-ap-hero-tune-grid">' +
      nameField +
      '<div class="vx-ap-field"><label for="vx-hero-address">Ansprache</label>' +
      '<select id="vx-hero-address"' + (busy ? ' disabled' : '') + '>' + optionList(ADDRESS_OPTIONS, profile?.assistant?.address_form || 'sie') + '</select></div>' +
      toneField +
      '</div>' +
      (canTone ? '' : '<div class="vx-ap-hero-note">Den Ton können Sie ab dem Business-Paket selbst wählen. Die Ansprache bleibt jederzeit änderbar.</div>') +
      '<div class="vx-ap-actions">' +
      '<button type="button" class="vx-ap-btn" id="vx-hero-tune-save"' + (busy ? ' disabled' : '') + '>Übernehmen</button>' +
      '<button type="button" class="vx-ap-btn ghost" id="vx-hero-tune-cancel" data-vx-tone-cancel' + (busy ? ' disabled' : '') + '>Abbrechen</button>' +
      '</div>' +
      // Fehler gehoeren neben die Bedienelemente, die sie ausgeloest haben.
      // Ohne diesen Anker landet die Meldung am Namensfeld zwei Karten weiter
      // unten — ausserhalb des Blickfelds.
      '<div id="vx-hero-tune-status" class="vx-ap-status vx-ap-status--inline" role="status" aria-live="polite"></div>' +
      '</div>';
  }

  // Die Stimmenauswahl sass bis zur Umgliederung in einer eigenen Karte mit
  // einem Aufklapper darin — ein Klick. Die erste Fassung dieser Umgliederung
  // hat sie in den Editor gelegt und damit zwei Ebenen tief vergraben; im
  // Live-Test war sie schlicht nicht auffindbar. Sie steht deshalb wieder
  // direkt auf der Karte, nur eben in der Kernidentitaet statt in einer
  // eigenen Karte daneben.
  function voiceBlock() {
    if (!profile?.permissions?.can_change_voice) {
      return '<div class="vx-ap-status warning vx-ap-status--inline">Die Stimmenauswahl ist in Ihrem aktuellen Paket nicht freigeschaltet.</div>';
    }
    const filtered = voices.filter((voice) => voiceFilter === 'all' || genderKey(voice.gender) === voiceFilter);
    return '<details class="vx-nav-voice-details"' + (voiceDetailsOpen ? ' open' : '') + '>'
      + '<summary>Andere Stimme wählen</summary>'
      + '<div class="vx-ap-meta">Wählen Sie aus kuratierten Stimmen. Technische Sprachparameter bleiben geschützt.</div>'
      + '<div class="vx-ap-filters"><button type="button" class="vx-ap-filter' + (voiceFilter === 'all' ? ' active' : '') + '" data-vx-filter="all">Alle</button>'
      + '<button type="button" class="vx-ap-filter' + (voiceFilter === 'female' ? ' active' : '') + '" data-vx-filter="female">Weiblich</button>'
      + '<button type="button" class="vx-ap-filter' + (voiceFilter === 'male' ? ' active' : '') + '" data-vx-filter="male">Männlich</button></div>'
      + '<div class="vx-ap-voices">' + (filtered.length ? filtered.map(voiceCard).join('') : '<div class="vx-ap-empty">Für diesen Filter sind keine Stimmen freigeschaltet.</div>') + '</div>'
      + '</details>';
  }

  function identityRow(key, value) {
    return '<div class="vx-ap-summary-row"><span class="vx-ap-summary-key">' + key + '</span><span class="vx-ap-summary-value">' + value + '</span></div>';
  }

  function identityCard() {
    const greeting = profile?.greeting || { text: null, source: 'none' };
    const current = selectedVoice();
    const technical = profile?.technical_status || {};
    const summary = statusSummary(technical);
    const lastSync = formatDay(technical.last_successful_sync_at);
    const assistant = profile?.assistant || {};

    const spoken = greeting.text
      ? '<p class="vx-ap-hero-greeting">„' + esc(greeting.text) + '"</p>'
      : '<p class="vx-ap-hero-greeting is-pending">Der Begrüssungssatz entsteht, sobald Ihr Assistent aktiviert ist.</p>';
    // Warum der Satz kein Eingabefeld ist, steht dort, wo die Frage entsteht.
    const explain = greeting.text
      ? '<div class="vx-ap-hero-note">Dieser Satz entsteht automatisch aus Name, Ansprache und Sprache und enthält den gesetzlich nötigen Hinweis auf die Aufzeichnung. Ändern Sie die Felder darunter — der Satz zieht mit.</div>'
      : '';
    // A4/N7: eine gespeicherte Begruessung zieht bei einer Umbenennung nicht mit.
    // Der Screen zeigt die Abweichung, statt sie stillschweigend zu verwenden.
    const stale = greeting.stale_name
      ? '<div class="vx-ap-hero-note vx-ap-hero-note--warn">Diese Begrüssung nennt einen anderen Namen als Ihr Assistent. '
        + '<button type="button" class="vx-ap-linkbtn" id="vx-greeting-reset"' + (busy ? ' disabled' : '') + '>Auf Standard zurücksetzen</button></div>'
      : '';
    const notice = greeting.source === 'custom'
      ? '<div class="vx-ap-hero-note">Noch nicht an den Assistenten übertragen.</div>'
      : '';

    // Das Geschlecht der Stimme steht in der Zeile, statt dass die Software aus
    // dem Namen eines auf eines schliesst. Wer „Lara" mit einer maennlichen
    // Stimme kombiniert, sieht den Widerspruch selbst — eine Namensauswertung
    // waere bei Schweizer KMU-Namen eine Behauptung mit hoher Irrtumsquote.
    const voiceName = current
      ? (current.display_name || 'Standardstimme') + ' · ' + genderLabel(current.gender)
      : 'Von Voxera eingerichtet';

    const rows = identityRow('Name', esc(assistant.name || 'Von Voxera eingerichtet'))
      + identityRow('Stimme', esc(voiceName))
      + identityRow('Ansprache', esc(addressLabel(assistant.address_form)))
      + identityRow('Ton', esc(toneLabel(assistant.tone)))
      // E9: Sprache ist prompt-wirksam, aber nicht selbst bedienbar. Sie steht
      // hier als Wert mit Herkunft, nicht als Feld.
      + identityRow('Sprache', esc(assistant.language_label || 'Deutsch'));

    const statusLine = esc(summary.text) + (lastSync ? ' · Zuletzt aktualisiert am ' + esc(lastSync) : '')
      + (summary.hint ? '<span class="vx-ap-hero-status-hint">' + esc(summary.hint) + '</span>' : '')
      + (summary.action
        ? '<button type="button" class="vx-ap-linkbtn" data-vx-status-open="' + esc(summary.action.open) + '">' + esc(summary.action.label) + '</button>'
        : '');

    return '<section class="vx-ap-card vx-ap-hero">' +
      '<div class="vx-ap-hero-label">So meldet sich Ihr Assistent</div>' +
      spoken + explain + stale + notice +
      '<div class="vx-ap-summary vx-ap-summary--compact">' + rows + '</div>' +
      originChip('self', 'Von Ihnen gesetzt') +
      '<div class="vx-ap-hero-foot">' +
      (current ? '<button type="button" class="vx-ap-btn secondary" data-vx-preview="' + esc(current.voice_id) + '"' + (previewLoading ? ' disabled' : '') + '><i class="ph-bold ph-play" aria-hidden="true"></i> Anhören</button>' : '') +
      '</div>' +
      voiceBlock() +
      toneEditor() +
      '<div class="vx-ap-hero-status ' + summary.tone + '">' + statusLine + '</div>' +
      '</section>';
  }

  // Kategorie 4: temporaer statt dauerhaft. Sichtbar nur, wenn es tatsaechlich
  // eine Abweichung gibt — sonst beginnt der Screen direkt mit dem Satz.
  function bandCard() {
    const current = profile?.operational_updates?.current;
    if (!current) return '';
    const until = formatDay(current.ends_at);
    const label = current.active ? 'Aktuell abweichend vom Normalbetrieb' : 'Geplante Abweichung';
    return '<section class="vx-ap-band' + (current.active ? ' is-active' : '') + '">'
      + '<div class="vx-ap-band-copy"><span class="vx-ap-band-label">' + label + '</span>'
      + '<span class="vx-ap-band-text">' + esc(current.message || current.title) + (until ? ' Gültig bis ' + esc(until) + '.' : '') + '</span></div>'
      + '<button type="button" class="vx-ap-btn secondary" id="vx-open-operational">Bearbeiten</button>'
      + '</section>';
  }

  function knowledgeCard() {
    const business = profile?.business_profile || {};
    const completed = Number(business.completed_fields || 0);
    const total = Number(business.total_fields || 4);
    const branchCount = (profile?.branch_sections || []).reduce((sum, section) => sum + section.fields.length, 0);
    const branchFilled = (profile?.branch_sections || []).reduce(
      (sum, section) => sum + section.fields.filter((field) => field.value).length, 0
    );
    const branchRow = branchCount
      ? identityRow('Angaben für Ihre Branche', esc(branchFilled + ' von ' + branchCount + ' ausgefüllt'))
      : '';

    // E4: Die vier Zeilen lasen bis hierher die Freitextspalten. Seit J5-J7
    // fuehrt die Struktur — ein Kunde mit bestaetigter Leistungsliste und
    // geleertem Freitext bekam "Noch ergänzen" zu lesen, waehrend sein Prompt
    // den Abschnitt LEISTUNGEN vollstaendig enthielt. Der Zustand kommt jetzt
    // vom Server, der die Rangfolge ohnehin kennt; hier wird er nur angezeigt.
    const topics = Array.isArray(business.topics) ? business.topics : [];
    return '<section class="vx-ap-card">'
      + '<div class="vx-ap-head"><div><div class="vx-ap-title">Was Ihr Assistent weiss</div>'
      + '<div class="vx-ap-meta">Dauerhaftes Geschäftswissen. Ferien und kurzfristige Änderungen gehören ins Band oben.</div></div>'
      + '<span class="vx-ap-pill' + (completed === total ? ' selected' : '') + '">' + completed + ' von ' + total + ' Bereichen</span></div>'
      + '<div class="vx-ap-summary">'
      + identityRow('Unternehmen', esc(business.company_name || 'Nicht angegeben'))
      + topics.map((topic) => identityRow(esc(topic.label), topic.filled ? 'Hinterlegt' : 'Noch ergänzen')).join('')
      + branchRow
      + '</div>'
      + industryLine()
      // Klick-Test 09.08.: Die Seite dahinter wirkte verwaist, obwohl sie
      // absichtlich ein Drill-in ist und in ASSISTANT_VIEWS registriert steht.
      // Gefehlt hat nicht ein zweiter Navigationsweg, sondern die Geste: ohne
      // Chevron liest sich der Knopf als Aktion auf dieser Karte, nicht als
      // Weg zu einer eigenen Seite.
      //
      // Bewusst NICHT die Drill-in-Zeile des Einstellungen-Tabs, obwohl sie
      // optisch genau das waere: verify-customer-navigation-unified verbietet
      // dem Assistent-Runtime jeden Baustein von dort, und zwar als
      // Substring-Pruefung — dieser Kommentar darf den Klassennamen also nicht
      // einmal nennen. Die
      // Sperre stammt aus dem Rueckbau der alten Settings-Bridge und ist
      // richtig — der Assistent-Tab soll nicht wieder an den Bausteinen eines
      // anderen Tabs haengen. Der Chevron sitzt deshalb im eigenen Knopf,
      // genau wie ph-play in der Stimmkarte.
      + '<div class="vx-ap-actions"><button type="button" class="vx-ap-btn secondary" id="vx-open-business-profile">'
      + 'Geschäftsprofil bearbeiten<i class="ph-light ph-caret-right" aria-hidden="true"></i></button></div>'
      + '</section>';
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
    // Vier Abschnitte, sortiert nach Beständigkeit: was sich fast nie ändert
    // zuerst, das Temporäre als Band darüber. Die Fähigkeiten-Karte und die
    // Betriebsstatus-Karte hängt customer-runtime-assistant-status.js an den
    // Anker unten an — deshalb steht dort ein leerer Knoten und keine Karte.
    body.innerHTML = '<div id="vx-assistant-profile-status" class="vx-ap-status" role="status" aria-live="polite"></div><div class="vx-ap-stack">' +
      bandCard() +
      identityCard() +
      knowledgeCard() +
      boundariesCard() +
      '<div id="vx-assistant-capabilities-anchor" hidden></div>' +
      '</div>';
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
    // Die Karte "Dauerhaftes Geschaeftswissen" ist hier verschwunden. Sie
    // stellte dieselben vier Fragen wie die Karte darunter, nur unstrukturiert
    // — die J-Reihe hat die strukturierten Felder ergaenzt, ohne dass die alten
    // Textfelder wichen. Der Klick-Test am 09.08. hat das als das eigentliche
    // Problem des Screens benannt: vier Themen, jeweils zweimal, zwei
    // Speicher-Knoepfe, und die Vorrangregel nur als Fliesstext im Feldhinweis.
    //
    // Was aus den vier Feldern geworden ist:
    //   Unternehmensbeschreibung  -> fuehrendes Feld im Abschnitt "Was Sie
    //                                anbieten" (E3), mit Beschriftung und
    //                                Beispiel der frueheren Kurzbeschreibung
    //   Leistungen                -> Listeneditor, Text als Herkunftszeile
    //   Standort/Erreichbarkeit   -> Wochenraster + Adresse, Text als Herkunft
    //   Terminregeln + FAQ        -> Fragenliste + eigenes Regelfeld (E1)
    //
    // vx-ui-brand-rule: der Gold-Streifen auf der fuehrenden Karte des
    // Screens. Genau eine pro Screen, zustandsunabhaengig — siehe
    // customer-ui-components.css, Abschnitt 9. Er wandert mit, weil die Karte
    // "Ihr Betrieb" jetzt die erste ist.
    body.innerHTML = '<div id="vx-business-profile-status" class="vx-ap-status" role="status" aria-live="polite"></div>'
      + '<div class="vx-ap-stack">' + coreCard() + branchCard() + saveBar() + '</div>';
    document.getElementById('vx-business-save')?.addEventListener('click', saveBusinessPage);
    document.getElementById('vx-hours-apply')?.addEventListener('click', applyHoursSuggestion);
    bindHoursMode();
    bindLegacyText();
    // J6: bedingte Felder folgen der Auswahl sofort, nicht erst nach dem
    // Speichern. Ein Feld, das erst nach einem Neuladen verschwindet, wirkt wie
    // ein Fehler und wird trotzdem ausgefüllt.
    document.querySelectorAll('[data-vx-core-key], [data-vx-branch-key]').forEach((node) => {
      node.addEventListener('change', applyFieldVisibility);
    });
    // J7: Zeile hinzufuegen, Zeile entfernen, Vorschlag uebernehmen. Alle drei
    // aendern nur das Formular; gespeichert wird weiterhin erst mit dem Knopf
    // am Seitenende.
    document.querySelectorAll('[data-vx-list-add]').forEach((node) => node.addEventListener('click', () => {
      const container = document.querySelector('[data-vx-list="' + node.dataset.vxListAdd + '"]');
      if (!container) return;
      container.insertAdjacentHTML('beforeend', container.dataset.vxListKind === 'faq' ? faqRow(null) : listRow(''));
      container.lastElementChild?.querySelector('input')?.focus();
    }));
    document.querySelectorAll('[data-vx-list-apply]').forEach((node) => node.addEventListener('click', () => {
      const key = node.dataset.vxListApply;
      const container = document.querySelector('[data-vx-list="' + key + '"]');
      const suggestion = profile?.core_suggestions?.[key];
      if (!container || !Array.isArray(suggestion) || !suggestion.length) return;
      fillList(container, suggestion);
    }));
    // E1: Derselbe Vorschlagsknopf fuer das Regelfeld. Es ist ein Textfeld und
    // keine Liste, deshalb ein eigener Haken statt fillList().
    document.querySelectorAll('[data-vx-text-apply]').forEach((node) => node.addEventListener('click', () => {
      const key = node.dataset.vxTextApply;
      const field = document.querySelector('[data-vx-core-key="' + key + '"]');
      const suggestion = profile?.core_suggestions?.[key];
      if (!field || typeof suggestion !== 'string' || !suggestion) return;
      field.value = suggestion;
      field.focus();
    }));
    document.getElementById('vx-business-profile-body')?.addEventListener('click', (event) => {
      const remove = event.target.closest?.('[data-vx-list-remove]');
      if (!remove) return;
      const row = remove.closest('.vx-ap-list-row');
      const container = row?.parentElement;
      row?.remove();
      // Die letzte Zeile wird nicht entfernt, sondern geleert: ein Behaelter
      // ohne Zeile sieht kaputt aus und liesse sich nur ueber "Zeile
      // hinzufuegen" wiederbeleben.
      if (container && !container.querySelector('.vx-ap-list-row')) {
        container.insertAdjacentHTML('beforeend', container.dataset.vxListKind === 'faq' ? faqRow(null) : listRow(''));
      }
    });
    document.querySelectorAll('[data-vx-suggest]').forEach((node) => node.addEventListener('click', () => {
      const field = document.querySelector('[data-vx-core-key="' + node.dataset.vxSuggest + '"]');
      if (!field || !node.dataset.vxSuggestValue) return;
      field.value = node.dataset.vxSuggestValue;
      field.focus();
    }));
    restoreStatus('business');
  }

  // I8 — die Felder kommen aus der Branchenvorlage (industry_templates.
  // extra_steps), nicht aus dieser Datei. Ohne zugeordnete Branche oder ohne
  // hinterlegte Zusatzfelder sagt die Karte genau das, statt zu verschwinden:
  // die fehlende Zuordnung ist die eigentliche Lücke, nicht der Inhalt.
  // J4: Derselbe Renderer bedient beide Schichten — die generischen Felder aus
  // system_config.core_field_steps und die Branchenfelder aus der Vorlage. Sie
  // unterscheiden sich nur im Speicher (typisierte Spalte gegenüber
  // ai_branch_extra) und deshalb hier nur im Namen des Datenattributs.
  // J5: Wochenraster. Sieben Zeilen, je bis zu zwei Zeitspannen — mehr kommt in
  // den 19 Vorlagentexten nicht vor, und jede weitere Spalte macht die Zeile auf
  // dem Telefon unbedienbar. Leere Felder bedeuten geschlossen; das steht auch
  // so daneben, damit „leer“ nicht als „noch nicht ausgefüllt“ gelesen wird.
  const HOURS_DAYS = [
    ['mon', 'Montag'], ['tue', 'Dienstag'], ['wed', 'Mittwoch'], ['thu', 'Donnerstag'],
    ['fri', 'Freitag'], ['sat', 'Samstag'], ['sun', 'Sonntag']
  ];

  // `options.group` nennt die weiteren Tage, die denselben Wert bekommen. Er
  // haengt am Feld und nicht an einer Tabelle im Sammel-Code, damit
  // collectHours() die Zuordnung aus der Oberflaeche lesen kann statt sie ein
  // zweites Mal zu wissen.
  function hoursRow(day, label, intervals, options) {
    const group = Array.isArray(options?.group) && options.group.length
      ? ' data-vx-hours-group="' + esc(options.group.join(' ')) + '"'
      : '';
    const slot = (index) => {
      const pair = intervals[index] || ['', ''];
      return '<input type="time" data-vx-hours="' + day + '"' + group + ' data-vx-slot="' + index + '" data-vx-edge="from"'
        + ' value="' + esc(pair[0] || '') + '" aria-label="' + esc(label) + ', Zeitspanne ' + (index + 1) + ', von"'
        + (busy ? ' disabled' : '') + '>'
        + '<span class="vx-ap-hours-dash">–</span>'
        + '<input type="time" data-vx-hours="' + day + '"' + group + ' data-vx-slot="' + index + '" data-vx-edge="to"'
        + ' value="' + esc(pair[1] || '') + '" aria-label="' + esc(label) + ', Zeitspanne ' + (index + 1) + ', bis"'
        + (busy ? ' disabled' : '') + '>';
    };
    return '<div class="vx-ap-hours-row">'
      + '<div class="vx-ap-hours-day">' + esc(label) + '</div>'
      + '<div class="vx-ap-hours-slots">' + slot(0) + slot(1) + '</div>'
      + '<div class="vx-ap-hours-state">' + (intervals.length ? '' : 'geschlossen') + '</div>'
      + '</div>';
  }

  // Klick-Test 09.08., zweiter Befund: das Raster ist zu gross geraten. Sieben
  // Tage mit je zwei Zeitspannen sind 28 Zeitfelder, immer alle sichtbar — fuer
  // "Mo–Fr 8–12 und 13–17, Sa geschlossen" bedient der Kunde davon vier und
  // scrollt an 24 vorbei. Der Standardfall gehoert kurz, die Ausnahme
  // aufklappbar.
  //
  // Die kompakte Form ist reine Darstellung: gespeichert wird weiterhin das
  // Wochenraster aus J5 ({"mon":[["08:30","12:00"]], …}). "Montag bis Freitag"
  // schreibt denselben Wert nach mon..fri, und collectHours() liest unveraendert
  // aus denselben Eingaben — es gibt keine zweite Speicherform und damit auch
  // keine Migration.
  const HOURS_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

  // Die Entscheidung, welche Form gezeigt wird, faellt am gespeicherten Wert und
  // nicht an einer Voreinstellung: sind die fuenf Werktage identisch, ist die
  // kompakte Form vollstaendig; weicht einer ab, waere sie eine Luege und das
  // Raster steht offen. Kein gespeicherter Zustand ist damit unerreichbar.
  function hoursAreUniformWeekdays(week) {
    const reference = JSON.stringify(week.mon || []);
    return HOURS_WEEKDAYS.every((day) => JSON.stringify(week[day] || []) === reference);
  }

  function hoursField(field) {
    const week = (field.value && typeof field.value === 'object') ? field.value : {};
    const hint = field.hint ? '<div class="vx-ap-meta">' + esc(field.hint) + '</div>' : '';
    const uniform = hoursAreUniformWeekdays(week);
    // Samstag und Sonntag stehen bewusst NICHT in der Sammelzeile: bei
    // Schweizer KMU weichen sie fast immer ab (meist geschlossen, oft nur
    // vormittags). Mit ihnen zusammen waere der Standardfall wieder die
    // Ausnahme und praktisch jeder Betrieb muesste sofort ins Raster.
    const compact = '<div class="vx-ap-hours vx-ap-hours--compact"' + (uniform ? '' : ' hidden') + '>'
      + hoursRow('mon', 'Montag bis Freitag', Array.isArray(week.mon) ? week.mon : [], { group: HOURS_WEEKDAYS })
      + hoursRow('sat', 'Samstag', Array.isArray(week.sat) ? week.sat : [])
      + hoursRow('sun', 'Sonntag', Array.isArray(week.sun) ? week.sun : [])
      + '</div>';
    const full = '<div class="vx-ap-hours vx-ap-hours--full"' + (uniform ? ' hidden' : '') + '>'
      + HOURS_DAYS.map(([day, label]) => hoursRow(day, label, Array.isArray(week[day]) ? week[day] : [])).join('')
      + '</div>';
    return '<div class="vx-ap-field vx-ap-field--hours" data-vx-hours-field>'
      + '<label>' + esc(field.label) + '</label>'
      + hint
      + compact
      + full
      + '<button type="button" class="vx-ap-btn ghost" data-vx-hours-toggle'
      + ' aria-expanded="' + (uniform ? 'false' : 'true') + '"' + (busy ? ' disabled' : '') + '>'
      + (uniform ? 'Einzelne Wochentage weichen ab' : 'Wieder für Montag bis Freitag gemeinsam eintragen')
      + '</button>'
      + '<div class="vx-ap-meta">Ein leeres Feldpaar bedeutet geschlossen.</div>'
      + '</div>';
  }

  // Beim Wechsel zwischen den beiden Formen wird der gerade sichtbare Stand
  // uebernommen und nicht der zuletzt gespeicherte: sonst verloere der Kunde,
  // was er unmittelbar davor eingetippt hat. Aufklappen faechert die
  // Sammelzeile auf alle fuenf Werktage auf, Zuklappen nimmt den Montag als
  // gemeinsamen Wert — und sagt vorher, dass die uebrigen Werktage ihm folgen.
  function bindHoursMode() {
    const toggle = document.querySelector('[data-vx-hours-toggle]');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      const field = toggle.closest('[data-vx-hours-field]');
      const compact = field?.querySelector('.vx-ap-hours--compact');
      const full = field?.querySelector('.vx-ap-hours--full');
      if (!compact || !full) return;
      const openingFull = !compact.hidden;
      const current = collectHours();
      if (openingFull) {
        HOURS_WEEKDAYS.forEach((day) => { current[day] = current.mon || []; });
      } else {
        const differs = HOURS_WEEKDAYS.some((day) => JSON.stringify(current[day] || []) !== JSON.stringify(current.mon || []));
        if (differs && !root.confirm('Die gemeinsame Zeile gilt für Montag bis Freitag. Abweichende Zeiten an einzelnen Werktagen gehen dabei verloren. Fortfahren?')) return;
        HOURS_WEEKDAYS.forEach((day) => { current[day] = current.mon || []; });
      }
      compact.hidden = openingFull;
      full.hidden = !openingFull;
      toggle.setAttribute('aria-expanded', openingFull ? 'true' : 'false');
      toggle.textContent = openingFull
        ? 'Wieder für Montag bis Freitag gemeinsam eintragen'
        : 'Einzelne Wochentage weichen ab';
      writeHours(current);
    });
  }

  // Schreibt ein Wochenraster in die gerade sichtbaren Eingaben zurueck.
  function writeHours(week) {
    visibleHoursInputs().forEach((node) => {
      const intervals = Array.isArray(week[node.dataset.vxHours]) ? week[node.dataset.vxHours] : [];
      const pair = intervals[Number(node.dataset.vxSlot)] || ['', ''];
      node.value = node.dataset.vxEdge === 'from' ? (pair[0] || '') : (pair[1] || '');
    });
  }

  // Nur die sichtbare Form zaehlt. Stuende die verborgene mit in der Auswertung,
  // gewaenne je nach Reihenfolge mal die eine, mal die andere — und der Kunde
  // saehe etwas anderes gespeichert, als er eingetippt hat.
  function visibleHoursInputs() {
    return Array.from(document.querySelectorAll('[data-vx-hours]'))
      .filter((node) => !node.closest('.vx-ap-hours')?.hidden);
  }

  // Liest das Raster aus der Oberflaeche. Unvollstaendige Paare (nur von oder
  // nur bis) werden verworfen statt halb gespeichert — der Server wiese sie
  // ohnehin ab, und eine halbe Zeitspanne ist keine Aussage.
  function collectHours() {
    const week = {};
    HOURS_DAYS.forEach(([day]) => { week[day] = []; });
    visibleHoursInputs().forEach((node) => {
      const slot = Number(node.dataset.vxSlot);
      const edge = node.dataset.vxEdge === 'from' ? 0 : 1;
      // In der kompakten Form traegt eine Zeile fuenf Tage. Welche das sind,
      // steht am Feld selbst — so bleibt "Montag bis Freitag" eine Aussage der
      // Oberflaeche und nicht eine zweite, hier wiederholte Annahme.
      const days = [node.dataset.vxHours, ...String(node.dataset.vxHoursGroup || '').split(/\s+/)]
        .filter(Boolean);
      days.forEach((day) => {
        if (!week[day]) return;
        week[day][slot] = week[day][slot] || ['', ''];
        week[day][slot][edge] = String(node.value || '').trim();
      });
    });
    HOURS_DAYS.forEach(([day]) => {
      week[day] = (week[day] || []).filter((pair) => pair && pair[0] && pair[1]);
    });
    return week;
  }

  // J7: Leistungen als Zeilen, häufige Fragen als Paare. Beide Editoren sind
  // dieselbe Bauform — Zeilen in einem Behälter, eine Zeile lässt sich
  // entfernen, unten kommt eine dazu. Gespeichert wird erst beim Speichern;
  // Hinzufügen und Entfernen berühren nur das Formular.
  //
  // Drei leere Zeilen zum Start: eine einzelne leere Zeile liest sich wie ein
  // Fehler, und wer eine Liste anlegt, hat selten genau einen Eintrag.
  const LIST_BLANK_ROWS = 3;

  function listRow(value) {
    return '<div class="vx-ap-list-row">'
      + '<input data-vx-list-entry maxlength="200" value="' + esc(value || '') + '"'
      + ' aria-label="Leistung"' + (busy ? ' disabled' : '') + '>'
      + '<button type="button" class="vx-ap-list-remove" data-vx-list-remove aria-label="Zeile entfernen"'
      + (busy ? ' disabled' : '') + '>&times;</button>'
      + '</div>';
  }

  function faqRow(entry) {
    return '<div class="vx-ap-list-row vx-ap-list-row--faq">'
      + '<input data-vx-faq-question maxlength="200" value="' + esc(entry?.q || '') + '"'
      + ' placeholder="Frage" aria-label="Frage"' + (busy ? ' disabled' : '') + '>'
      + '<input data-vx-faq-answer maxlength="600" value="' + esc(entry?.a || '') + '"'
      + ' placeholder="Antwort" aria-label="Antwort"' + (busy ? ' disabled' : '') + '>'
      + '<button type="button" class="vx-ap-list-remove" data-vx-list-remove aria-label="Zeile entfernen"'
      + (busy ? ' disabled' : '') + '>&times;</button>'
      + '</div>';
  }

  function listField(field) {
    const entries = Array.isArray(field.value) ? field.value : [];
    const isFaq = field.type === 'faq';
    const rows = entries.length ? entries : new Array(LIST_BLANK_ROWS).fill(null);
    const hint = field.hint ? '<div class="vx-ap-meta">' + esc(field.hint) + '</div>' : '';
    return '<div class="vx-ap-field vx-ap-field--list">'
      + '<label>' + esc(field.label) + '</label>'
      + hint
      + '<div class="vx-ap-list" data-vx-list="' + esc(field.key) + '" data-vx-list-kind="' + (isFaq ? 'faq' : 'list') + '">'
      + rows.map((entry) => (isFaq ? faqRow(entry) : listRow(entry))).join('')
      + '</div>'
      + '<button type="button" class="vx-ap-btn ghost" data-vx-list-add="' + esc(field.key) + '"'
      + (busy ? ' disabled' : '') + '>Zeile hinzufügen</button>'
      + listSuggestionBanner(field)
      + '</div>';
  }

  // Der Vorschlag füllt das Formular, er speichert nicht. Und er sagt daneben,
  // was er aus dem Text NICHT lesen konnte.
  //
  // Die Regelzeilen stehen hier nicht mehr. Bis E1 nannte dieser Kasten sie mit
  // dem Satz "Sie bleiben im Text stehen" — ein Versprechen, das der
  // Prompt-Builder gebrochen hat, weil die bestätigte Liste den ganzen Text
  // verdrängte. Sie haben jetzt ein eigenes Feld direkt darunter und dort ihren
  // eigenen Vorschlag; sie hier zusätzlich zu nennen wäre die Doppelung, die
  // dieser Auftrag gerade aufgelöst hat, nur eine Ebene kleiner.
  function listSuggestionBanner(field) {
    const suggestion = profile?.core_suggestions?.[field.key];
    const info = profile?.list_suggestions || {};
    const unparsed = field.type === 'faq' ? info.faq_unparsed_lines : info.service_unparsed_lines;
    if (!Array.isArray(suggestion) || !suggestion.length) return '';
    return '<div class="vx-ap-suggestion">'
      + '<div class="vx-ap-suggestion-title">Vorschlag aus Ihrem bisherigen Text</div>'
      + '<div class="vx-ap-meta">Wir haben ' + suggestion.length + ' '
      + (field.type === 'faq' ? 'Frage-Antwort-Paare' : 'Einträge') + ' gelesen. '
      + 'Sie gelten erst, wenn Sie sie prüfen und speichern — bis dahin verwendet Ihr Assistent weiterhin den Text.</div>'
      + (Array.isArray(unparsed) && unparsed.length
        ? '<div class="vx-ap-meta">Diese Zeilen konnten wir nicht zuordnen, bitte selbst eintragen: '
          + unparsed.map((line) => esc(line)).join(' · ') + '</div>'
        : '')
      + '<button type="button" class="vx-ap-btn ghost" data-vx-list-apply="' + esc(field.key) + '"'
      + (busy ? ' disabled' : '') + '>Vorschlag übernehmen</button>'
      + '</div>';
  }

  // replacedByListNote() ist hier entfallen. Der Hinweis "Dieser Text wird nicht
  // mehr verwendet" hing an einem Textfeld, das direkt darueber weiterhin zur
  // Eingabe einlud — er war die richtige Aussage an der falschen Stelle. Den
  // Zustand traegt jetzt die eingeklappte Herkunftszeile (legacyTextRow), und
  // zwar mit der Rangfolge, die der Server auswertet, statt mit einer zweiten
  // Fassung derselben Regel im Browser.

  function collectList(container) {
    if (container.dataset.vxListKind === 'faq') {
      return Array.from(container.querySelectorAll('.vx-ap-list-row')).map((row) => ({
        q: String(row.querySelector('[data-vx-faq-question]')?.value || '').trim(),
        a: String(row.querySelector('[data-vx-faq-answer]')?.value || '').trim()
      })).filter((entry) => entry.q || entry.a);
    }
    return Array.from(container.querySelectorAll('[data-vx-list-entry]'))
      .map((node) => String(node.value || '').trim())
      .filter(Boolean);
  }

  function fillList(container, entries) {
    const isFaq = container.dataset.vxListKind === 'faq';
    container.innerHTML = entries.map((entry) => (isFaq ? faqRow(entry) : listRow(entry))).join('');
  }

  // J6: Ein Feld kann an der Antwort eines anderen haengen — der Buchungslink an
  // der Terminbefugnis, Betrag und Einheit an der Preisart. Ausgewertet wird die
  // Bedingung hier und nur fuer die Darstellung. Was gespeichert werden darf,
  // entscheidet weiterhin allein der Schreibpfad; ein ausgeblendetes Feld
  // behaelt seinen gespeicherten Wert, statt ihn stillschweigend zu verlieren.
  // Beim Aufbau der Zeichenkette steht das steuernde Feld noch nicht im
  // Dokument — hier zaehlt deshalb der gespeicherte Wert. Was der Kunde
  // waehrend der Bearbeitung umstellt, faengt applyFieldVisibility() ab.
  function fieldVisible(field, scope) {
    if (!field.show_if) return true;
    return field.show_if.in.indexOf(String(storedValue(field.show_if.key, scope) || '')) >= 0;
  }

  function storedValue(key, scope) {
    const sections = (scope === 'core' ? profile?.core_sections : profile?.branch_sections) || [];
    for (const section of sections) {
      const match = (section.fields || []).find((item) => item.key === key);
      if (match) return match.value;
    }
    return '';
  }

  function applyFieldVisibility() {
    document.querySelectorAll('[data-vx-showif-key]').forEach((node) => {
      const control = document.querySelector('[data-vx-' + node.dataset.vxShowifScope + '-key="' + node.dataset.vxShowifKey + '"]');
      const current = control ? String(control.value || '') : '';
      node.hidden = String(node.dataset.vxShowifIn || '').split('|').indexOf(current) < 0;
    });
  }

  // Der Vorschlag fuellt das Feld, speichert aber nicht. Gleiche Regel wie beim
  // Oeffnungszeiten-Vorschlag aus J5: uebernommen ist noch nicht bestaetigt.
  function suggestionRow(field) {
    const value = profile?.core_suggestions?.[field.suggestion];
    if (!field.suggestion || !value || field.value) return '';
    return '<div class="vx-ap-field-suggest">'
      + '<span>Aus Ihren Stammdaten: ' + esc(value) + '</span>'
      + '<button type="button" class="vx-ap-btn ghost" data-vx-suggest="' + esc(field.key) + '"'
      + ' data-vx-suggest-value="' + esc(value) + '"' + (busy ? ' disabled' : '') + '>Übernehmen</button>'
      + '</div>';
  }

  function schemaField(field, scope) {
    if (field.type === 'hours') return hoursField(field);
    if (field.type === 'list' || field.type === 'faq') return listField(field);
    const id = 'vx-' + scope + '-' + field.key;
    const attr = scope === 'core' ? 'data-vx-core-key' : 'data-vx-branch-key';
    const hint = field.hint ? '<div class="vx-ap-meta">' + esc(field.hint) + '</div>' : '';
    let control;
    if (field.type === 'radio' && field.options.length) {
      control = '<select id="' + esc(id) + '" ' + attr + '="' + esc(field.key) + '"' + (busy ? ' disabled' : '') + '>'
        + '<option value="">Noch nicht gewählt</option>'
        + field.options.map((option) => (
          '<option value="' + esc(option.value) + '"' + (field.value === option.value ? ' selected' : '') + '>' + esc(option.label) + '</option>'
        )).join('')
        + '</select>';
    } else if (field.type === 'textarea') {
      control = '<textarea id="' + esc(id) + '" ' + attr + '="' + esc(field.key) + '" maxlength="400" placeholder="' + esc(field.placeholder) + '"'
        + (busy ? ' disabled' : '') + '>' + esc(field.value) + '</textarea>';
    } else {
      control = '<input id="' + esc(id) + '" ' + attr + '="' + esc(field.key) + '" maxlength="400" value="' + esc(field.value) + '" placeholder="' + esc(field.placeholder) + '"'
        + (busy ? ' disabled' : '') + '>';
    }
    const gate = field.show_if
      ? ' data-vx-showif-key="' + esc(field.show_if.key) + '" data-vx-showif-in="' + esc(field.show_if.in.join('|')) + '"'
        + ' data-vx-showif-scope="' + esc(scope) + '"' + (fieldVisible(field, scope) ? '' : ' hidden')
      : '';
    return '<div class="vx-ap-field"' + gate + '><label for="' + esc(id) + '">' + esc(field.label) + '</label>'
      + control + hint + suggestionRow(field) + textSuggestionBanner(field, scope) + '</div>';
  }

  // E1: Der Vorschlag fuer ein Textfeld. Gleiche Bauform und gleiche Regel wie
  // bei den Listen und beim Wochenraster — er fuellt das Feld, er speichert
  // nicht. Bei den Terminregeln ist das besonders wichtig: der Parser hat sie
  // aus einem gewachsenen Text herausgetrennt, und was eine Regel ist, ist
  // Auslegung. Deshalb liest der Kunde sie, bevor sie gelten.
  function textSuggestionBanner(field, scope) {
    if (scope !== 'core' || field.type !== 'textarea') return '';
    const suggestion = profile?.core_suggestions?.[field.key];
    if (typeof suggestion !== 'string' || !suggestion || field.value) return '';
    return '<div class="vx-ap-suggestion">'
      + '<div class="vx-ap-suggestion-title">Vorschlag aus Ihrem bisherigen Text</div>'
      + '<div class="vx-ap-meta">Diese Zeilen standen bei den häufigen Fragen, sind aber keine Fragen '
      + 'sondern Regeln. Sie gelten erst, wenn Sie sie prüfen und speichern.</div>'
      + '<div class="vx-ap-suggestion-body">' + esc(suggestion) + '</div>'
      + '<button type="button" class="vx-ap-btn ghost" data-vx-text-apply="' + esc(field.key) + '"'
      + (busy ? ' disabled' : '') + '>Vorschlag übernehmen</button>'
      + '</div>';
  }

  function branchField(field) { return schemaField(field, 'branch'); }

  // Schicht A. Diese Karte steht vor der Branchenkarte, weil ihre Angaben für
  // jeden Betrieb gelten — auch für die drei von vier Kunden ohne zugeordnete
  // Branche, die die Branchenkarte gar nicht ausfüllen können.
  // F3: Der Parser schlaegt vor, der Kunde bestaetigt. Der Vorschlag wird erst
  // beim Speichern zu Daten — vorher fuellt er nur das Raster aus. Deshalb ein
  // Knopf und keine automatische Uebernahme, und deshalb steht daneben, was der
  // Parser aus dem Text NICHT lesen konnte.
  function hoursSuggestionBanner() {
    const info = profile?.opening_hours || {};
    if (info.confirmed || !info.suggestion) return '';
    const unparsed = Array.isArray(info.unparsed_lines) ? info.unparsed_lines : [];
    return '<div class="vx-ap-suggestion">'
      + '<div class="vx-ap-suggestion-title">Vorschlag aus Ihrem Standort-Text</div>'
      + '<div class="vx-ap-meta">Wir haben aus „Standort und Erreichbarkeit“ ein Wochenraster gelesen. '
      + 'Es gilt erst, wenn Sie es prüfen und speichern — bis dahin verwendet Ihr Assistent weiterhin den Text.</div>'
      + (unparsed.length
        ? '<div class="vx-ap-meta">Diese Zeilen konnten wir nicht zuordnen, bitte selbst eintragen: '
          + unparsed.map((line) => esc(line)).join(' · ') + '</div>'
        : '')
      + '<button type="button" class="vx-ap-btn ghost" id="vx-hours-apply"'
      + (busy ? ' disabled' : '') + '>Vorschlag ins Raster übernehmen</button>'
      + '</div>';
  }

  // Der eingeklappte Herkunftstext. Er steht direkt unter dem Feld, das ihn
  // abgeloest hat, und nicht mehr als eigenes Formular weiter oben — Naehe ist
  // das, was die Vorrangregel erklaert. Ob er noch wirkt, entscheidet der
  // Server (business_profile.legacy_texts): dieselbe Rangfolge wie im
  // Prompt-Builder, einmal ausgewertet statt hier ein zweites Mal.
  //
  // Bewusst als Text und nicht als Textarea: dies ist kein Eingabefeld mehr.
  // Bearbeiten geht nur noch ueber den ausdruecklichen Knopf, und das ist der
  // Punkt — der Kunde soll oben eintragen, nicht hier.
  function legacyTextRow(anchorKey) {
    const entry = (profile?.business_profile?.legacy_texts || []).find((item) => item.anchor === anchorKey);
    if (!entry) return '';
    const state = entry.retired
      ? 'Wird nicht mehr verwendet — es gilt, was Sie oben eingetragen haben.'
      : 'Wird noch verwendet, solange ' + esc(entry.replaced_by) + ' nicht vollständig ist.';
    return '<details class="vx-ap-legacy" data-vx-legacy="' + esc(entry.key) + '"'
      + ' data-vx-legacy-column="' + esc(entry.column) + '">'
      + '<summary><span class="vx-ap-legacy-label">Ihr ursprünglicher Text: ' + esc(entry.label) + '</span>'
      + '<span class="vx-ap-legacy-state' + (entry.retired ? ' is-retired' : '') + '">'
      + (entry.retired ? 'nicht mehr in Verwendung' : 'noch in Verwendung') + '</span></summary>'
      + '<div class="vx-ap-meta">' + state + '</div>'
      + '<div class="vx-ap-legacy-body">' + esc(entry.value) + '</div>'
      + '<div class="vx-ap-actions">'
      + (entry.retired
        ? '<button type="button" class="vx-ap-btn ghost" data-vx-legacy-delete="' + esc(entry.key) + '"'
          + (busy ? ' disabled' : '') + '>Text löschen</button>'
        : '<button type="button" class="vx-ap-btn ghost" data-vx-legacy-edit="' + esc(entry.key) + '"'
          + (busy ? ' disabled' : '') + '>Text bearbeiten</button>')
      + '</div>'
      + '</details>';
  }

  // Bearbeiten tauscht die Anzeige gegen ein Textfeld — nur fuer den Text, der
  // noch wirkt. Loeschen fragt nach, weil es die letzte Fassung eines
  // gewachsenen Textes entfernt: er kommt aus der Branchenvorlage oder aus der
  // Website-Analyse und laesst sich hier nicht wiederherstellen.
  function bindLegacyText() {
    document.querySelectorAll('[data-vx-legacy-edit]').forEach((node) => node.addEventListener('click', () => {
      const box = node.closest('[data-vx-legacy]');
      const bodyNode = box?.querySelector('.vx-ap-legacy-body');
      if (!box || !bodyNode || box.querySelector('[data-vx-legacy-input]')) return;
      const value = bodyNode.textContent || '';
      bodyNode.innerHTML = '<textarea data-vx-legacy-input rows="6">' + esc(value) + '</textarea>';
      bodyNode.querySelector('textarea')?.focus();
      node.remove();
    }));
    document.querySelectorAll('[data-vx-legacy-delete]').forEach((node) => node.addEventListener('click', () => {
      const box = node.closest('[data-vx-legacy]');
      if (!box) return;
      if (!root.confirm('Diesen Text endgültig löschen? Ihr Assistent verwendet ihn nicht mehr — er bleibt sonst nur als Notiz erhalten.')) return;
      const column = box.dataset.vxLegacyColumn;
      if (!column) return;
      updateAssistant({ [column]: '' }, 'business', document.getElementById('vx-business-save'));
    }));
  }

  function applyHoursSuggestion() {
    const week = profile?.opening_hours?.suggestion;
    if (!week) return;
    // Weicht der Vorschlag an einzelnen Werktagen ab, passt er nicht in die
    // kompakte Zeile — dann wird das Raster aufgeklappt, statt den Vorschlag
    // beim Uebernehmen stillschweigend auf den Montag einzuebnen.
    const field = document.querySelector('[data-vx-hours-field]');
    const compact = field?.querySelector('.vx-ap-hours--compact');
    const full = field?.querySelector('.vx-ap-hours--full');
    const toggle = field?.querySelector('[data-vx-hours-toggle]');
    if (compact && full && !hoursAreUniformWeekdays(week) && !compact.hidden) {
      compact.hidden = true;
      full.hidden = false;
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'true');
        toggle.textContent = 'Wieder für Montag bis Freitag gemeinsam eintragen';
      }
    }
    writeHours(week);
  }

  // E3: Die Beschreibung des Betriebs ist das einzige der vier alten
  // Textfelder, das ein Eingabefeld bleibt. Sie liegt weiterhin in
  // `ai_business_description` und wird deshalb nicht ueber `core_fields`
  // geschrieben — zwei Schreibwege auf dieselbe Spalte waeren genau die
  // Doppelung, die dieser Auftrag aufloest, nur eine Ebene tiefer. Wo sie
  // steht, sagt der Server (`description_field.section`).
  function descriptionField() {
    const field = profile?.business_profile?.description_field;
    if (!field) return '';
    return '<div class="vx-ap-field"><label for="vx-business-description">' + esc(field.label) + '</label>'
      + '<textarea id="vx-business-description" maxlength="6000" placeholder="' + esc(field.placeholder || '') + '"'
      + (busy ? ' disabled' : '') + '>' + esc(field.value || '') + '</textarea>'
      + (field.hint ? '<div class="vx-ap-meta">' + esc(field.hint) + '</div>' : '')
      + '</div>';
  }

  function coreCard() {
    const sections = profile?.core_sections || [];
    if (!sections.length) return '';
    const descriptionSection = profile?.business_profile?.description_field?.section || '';
    // vx-ui-brand-rule wandert mit: seit die Freitext-Karte weg ist, ist dies
    // die fuehrende Karte des Screens. Genau eine pro Screen — siehe
    // customer-ui-components.css, Abschnitt 9.
    return '<div class="vx-ap-card vx-ui-brand-rule"><div class="vx-ap-head"><div><div class="vx-ap-title">Ihr Betrieb</div>'
      + '<div class="vx-ap-meta">Was Ihr Assistent im normalen Betrieb über Ihren Betrieb weiss. '
      + 'Was leer bleibt, erwähnt er nicht. Ferien und kurzfristige Änderungen gehören in „Aktuelle Infos“.</div></div></div>'
      + sections.map((section) => (
        '<div class="vx-ap-subsection">'
        + '<div class="vx-ap-subtitle">' + esc(section.title) + '</div>'
        + (section.hint ? '<div class="vx-ap-meta">' + esc(section.hint) + '</div>' : '')
        + '<div class="vx-ap-fieldlist">'
        + (section.id === descriptionSection ? descriptionField() : '')
        + section.fields.map((field) => (
          schemaField(field, 'core')
          // Der Herkunftstext steht hinter dem Feld, das ihn abgeloest hat.
          + (field.key === 'opening_hours' ? hoursSuggestionBanner() : '')
          + legacyTextRow(field.key)
        )).join('')
        + '</div>'
        + '</div>'
      )).join('')
      + originChip('voxera', 'Gilt für alle Betriebe')
      + '</div>';
  }

  // Alle drei Knoepfe der Seite riefen denselben Endpoint mit demselben
  // Rumpf-Format auf — die Trennung war kein Implementierungsdetail, sondern
  // gar keins. `customer-update-assistant` verarbeitet die drei Schluessel in
  // einem Aufruf, baut ein einziges patch-Objekt, prueft vollstaendig und
  // schreibt dann einmal. Ein Knopf ist damit auch technisch besser als drei:
  // ein Schreibvorgang, ein ElevenLabs-Sync, ein Fingerprint statt je drei.
  function saveBar() {
    return '<div class="vx-ap-savebar">'
      + '<button type="button" class="vx-ap-btn" id="vx-business-save"' + (busy ? ' disabled' : '') + '>Angaben speichern</button>'
      + '<div id="vx-business-save-status" class="vx-ap-status vx-ap-status--inline" role="status" aria-live="polite"></div>'
      + '</div>';
  }

  async function saveBusinessPage() {
    const payload = {};

    // Schicht A.
    const core = {};
    document.querySelectorAll('[data-vx-core-key]').forEach((node) => {
      core[node.dataset.vxCoreKey] = String(node.value || '').trim();
    });
    if (document.querySelector('[data-vx-hours]')) core.opening_hours = collectHours();
    document.querySelectorAll('[data-vx-list]').forEach((node) => {
      core[node.dataset.vxList] = collectList(node);
    });
    if (Object.keys(core).length) payload.core_fields = core;

    // Branchenfelder. Nur mitschicken, wenn es welche gibt: ohne zugeordnete
    // Vorlage antwortet der Endpoint mit 409 no_industry_template, und weil er
    // vollstaendig prueft, bevor er schreibt, scheiterte damit auch alles
    // andere. Bis hierher war der Fall dadurch verdeckt, dass die Karte ohne
    // Felder gar keinen Knopf gerendert hat.
    const branch = {};
    document.querySelectorAll('[data-vx-branch-key]').forEach((node) => {
      branch[node.dataset.vxBranchKey] = String(node.value || '').trim();
    });
    if (Object.keys(branch).length) payload.ai_branch_extra = branch;

    // Die Beschreibung und ein eventuell geoeffneter Herkunftstext.
    const description = document.getElementById('vx-business-description');
    if (description) payload.ai_business_description = String(description.value || '');
    document.querySelectorAll('[data-vx-legacy]').forEach((box) => {
      const input = box.querySelector('[data-vx-legacy-input]');
      if (input && box.dataset.vxLegacyColumn) payload[box.dataset.vxLegacyColumn] = String(input.value || '');
    });

    if (!Object.keys(payload).length) return;
    await updateAssistant(payload, 'business', document.getElementById('vx-business-save'));
  }

  function branchCard() {
    const industry = profile?.industry || {};
    const sections = profile?.branch_sections || [];
    if (!industry.assigned) {
      return '<div class="vx-ap-card"><div class="vx-ap-title">Für Ihre Branche</div>'
        + '<div class="vx-ap-meta">Ihrem Konto ist noch keine Branche zugeordnet. Ihr Assistent arbeitet deshalb ohne branchenspezifische Regeln.</div>'
        + originChip('branch', 'Noch keine Branche zugeordnet') + '</div>';
    }
    if (!sections.length) {
      return '<div class="vx-ap-card"><div class="vx-ap-title">Für Ihre Branche</div>'
        + '<div class="vx-ap-meta">Für ' + esc(industry.name) + ' sind aktuell keine Zusatzangaben vorgesehen.</div>'
        + originChip('branch', 'Aus Ihrer Branche: ' + industry.name) + '</div>';
    }
    // Der Zwecksatz sagt, was die Angaben bewirken, nicht woher sie kommen —
    // „Ihre Branchenvorlage sieht das vor" beantwortete im Test die falsche
    // Frage. Und die Felder stehen einspaltig: zweispaltig standen Beschriftung,
    // Feld und Hinweistext so eng, dass die Karte als Block wirkte.
    return '<div class="vx-ap-card"><div class="vx-ap-head"><div><div class="vx-ap-title">Für Ihre Branche</div>'
      + '<div class="vx-ap-meta">Antworten auf Fragen, die in ' + esc(industry.name) + ' häufig vorkommen. '
      + 'Was Sie hier ausfüllen, kann Ihr Assistent im Gespräch verwenden; was leer bleibt, erwähnt er nicht.</div></div></div>'
      + sections.map((section) => (
        '<div class="vx-ap-subsection">'
        + '<div class="vx-ap-subtitle">' + esc(section.title) + '</div>'
        + (section.hint ? '<div class="vx-ap-meta">' + esc(section.hint) + '</div>' : '')
        + '<div class="vx-ap-fieldlist">' + section.fields.map(branchField).join('') + '</div>'
        + '</div>'
      )).join('')
      + originChip('branch', 'Aus Ihrer Branche: ' + industry.name)
      + '</div>';
  }

  function bindAssistant() {
    document.querySelectorAll('[data-vx-filter]').forEach((node) => node.addEventListener('click', () => {
      voiceFilter = node.dataset.vxFilter || 'all';
      renderAssistant();
    }));
    document.querySelectorAll('[data-vx-preview]').forEach((node) => node.addEventListener('click', () => previewVoice(node.dataset.vxPreview, node)));
    document.querySelectorAll('[data-vx-select-voice]').forEach((node) => node.addEventListener('click', () => openVoiceModal(node.dataset.vxSelectVoice)));
    // Der Aufklapper wird bei jedem Rendern neu erzeugt; ohne gemerkten Zustand
    // klappt er beim Filterwechsel wieder zu.
    const voiceDetails = document.querySelector('.vx-nav-voice-details');
    voiceDetails?.addEventListener('toggle', () => { voiceDetailsOpen = voiceDetails.open; });
    document.getElementById('vx-greeting-reset')?.addEventListener('click', resetGreeting);
    // Die Statuszeile fuehrt dorthin, wo sich der gemeldete Zustand aendern
    // laesst — ohne Ziel bliebe sie eine Feststellung ohne Ausweg.
    document.querySelector('[data-vx-status-open]')?.addEventListener('click', (event) => {
      const target = event.currentTarget.dataset.vxStatusOpen;
      if (target && typeof root.vxMehrShow === 'function') {
        root.showTab?.('mehr');
        root.vxMehrShow(target);
      }
    });
    document.getElementById('vx-open-operational')?.addEventListener('click', () => root.vxShowAssistantView?.('updates', true));
    document.querySelector('[data-vx-tone-edit]')?.addEventListener('click', () => { toneEditorOpen = true; renderAssistant(); });
    // Zweiter Riegel neben dem disabled-Attribut: ein Klick, der waehrend des
    // Speicherns doch durchkommt, darf den Editor nicht schliessen.
    document.querySelector('[data-vx-tone-cancel]')?.addEventListener('click', () => {
      if (busy) return;
      toneEditorOpen = false;
      renderAssistant();
    });
    document.getElementById('vx-hero-tune-save')?.addEventListener('click', saveTune);
    document.getElementById('vx-open-business-profile')?.addEventListener('click', () => root.vxShowAssistantView?.('business', true));
    document.getElementById('vx-forwarding-edit')?.addEventListener('click', () => {
      forwardingEditorOpen = true;
      renderAssistant();
    });
    // Gleicher zweiter Riegel wie beim Ton-Editor: ein Klick, der waehrend des
    // Speicherns durchkommt, darf den Editor nicht schliessen.
    document.getElementById('vx-forwarding-cancel')?.addEventListener('click', () => {
      if (busy) return;
      forwardingEditorOpen = false;
      forwardingSecondSlotOpen = false;
      renderAssistant();
    });
    document.getElementById('vx-forwarding-add')?.addEventListener('click', () => {
      forwardingSecondSlotOpen = true;
      renderAssistant();
    });
    document.getElementById('vx-forwarding-save')?.addEventListener('click', saveForwarding);
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
    // vx-hero-tune-cancel gehoert dazu: sonst laesst sich der Editor waehrend
    // eines laufenden Speicherns wegklicken und der Zustand ist weg, obwohl der
    // Request noch fehlschlagen kann.
    ['vx-business-save', 'vx-open-business-profile', 'vx-hero-tune-cancel', 'vx-greeting-reset',
      'vx-forwarding-edit', 'vx-forwarding-cancel', 'vx-forwarding-add'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = disabled;
    });
    // Die Nebenaktionen der Geschäftsprofil-Seite gehoeren dazu: Vorschlag
    // uebernehmen, Zeile hinzufuegen, Herkunftstext loeschen. Waehrend eines
    // laufenden Speicherns duerfen sie das Formular nicht mehr veraendern —
    // sonst schickt der naechste Klick einen Stand, den der Kunde nie gesehen
    // hat.
    document.querySelectorAll('[data-vx-list-add], [data-vx-list-apply], [data-vx-list-remove],'
      + ' [data-vx-text-apply], [data-vx-suggest], [data-vx-hours-toggle],'
      + ' [data-vx-legacy-edit], [data-vx-legacy-delete], #vx-hours-apply').forEach((node) => {
      node.disabled = disabled;
    });
    document.querySelectorAll('[data-vx-select-voice], [data-vx-preview]').forEach((node) => { node.disabled = disabled; });
  }

  // request() wirft mit dem Fehlercode des Endpoints im Text. Solange niemand
  // ihn uebersetzt, liest der Kunde "forwarding_number_invalid" — fuer die
  // Zielgruppe (Grundsatz 15) unbrauchbar.
  const SAVE_ERROR_TEXT = {
    forwarding_number_invalid: 'Diese Telefonnummer können wir nicht wählen. Bitte mit Vorwahl eingeben, z. B. 079 123 45 67.',
    forwarding_not_allowed_on_plan: 'Die Weiterleitung gehört zum Professional-Paket. Melden Sie uns die gewünschte Änderung, wir richten sie ein.',
    tone_not_allowed_on_plan: 'Den Ton können Sie ab dem Business-Paket selbst wählen.',
    assistant_name_not_allowed_on_plan: 'Den Namen können Sie ab dem Business-Paket selbst wählen.',
    voice_not_allowed_on_plan: 'Die Stimmenauswahl ist in Ihrem Paket nicht freigeschaltet.',
    voice_not_available_on_plan: 'Diese Stimme ist in Ihrem Paket nicht verfügbar.'
  };

  function saveErrorMessage(error) {
    const raw = String(error?.message || '').trim();
    return SAVE_ERROR_TEXT[raw] || raw || 'Änderung konnte nicht gespeichert werden.';
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
      // Das Neuladen des Profils steckte bis hierher mit im Wartefenster des
      // Knopfs. Es ist eine vollständige zusätzliche Runde — der Knopf blieb
      // dadurch auch dann noch auf „Speichert …", wenn längst gespeichert war.
      // Jetzt quittiert er, sobald der Endpoint geantwortet hat; der frische
      // Stand kommt danach und löst das erneute Rendern aus. Ein Fehler beim
      // Nachladen darf eine erfolgreiche Speicherung nicht als solchen
      // ausgeben, deshalb der eigene Fang.
      result = await root.vxInlineSaveStatus(
        button,
        () => request('customer-update-assistant', { method: 'POST', body: payload }),
        { savingLabel: savingLabel || 'Speichert …', doneLabel: 'Gespeichert ✓' }
      );
      try { await reloadProfile(); } catch (_error) { /* gespeicherte Werte bleiben gültig */ }
      const syncStatus = String(result.sync_status || '');
      if (syncStatus === 'failed') {
        finalMessage = 'Gespeichert, aber noch nicht mit dem Assistenten synchronisiert. Bitte später erneut versuchen.';
        finalTone = 'warning';
      } else if (syncStatus === 'skipped_no_agent') {
        finalMessage = 'Gespeichert. Der Assistent ist noch nicht eingerichtet.';
        finalTone = 'warning';
      }
    } catch (error) {
      finalMessage = saveErrorMessage(error);
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

  // A4/E11: Der Kunde setzt die eingefrorene Begruessung zurueck, statt sie zu
  // bearbeiten. Der naechste Sync erzeugt den Satz neu — die Erzeugung bleibt
  // damit an genau einer Stelle (buildGreeting im Prompt-Builder).
  async function resetGreeting() {
    await updateAssistant({ ai_greeting: '' }, 'assistant', document.getElementById('vx-greeting-reset'), 'Setzt zurück …');
  }

  async function saveTune() {
    const payload = { ai_address_form: document.getElementById('vx-hero-address')?.value || 'sie' };
    // Gesperrte Felder werden gar nicht erst gesendet — der Endpoint weist sie
    // seit A1 mit 403 ab, und ein Fehler waere hier reine Selbstverletzung.
    if (profile?.permissions?.can_change_tone === true) {
      payload.ai_tone = document.getElementById('vx-hero-tone')?.value || 'professional';
    }
    if (profile?.permissions?.can_change_name === true) {
      payload.assistant_name = String(document.getElementById('vx-assistant-name')?.value || '').trim();
    }
    const saved = await updateAssistant(payload, 'assistant', document.getElementById('vx-hero-tune-save'), 'Übernimmt …');
    // Bestaetigungsschleife: erst schliessen, wenn es wirklich gespeichert ist.
    // Der Kopfbereich zeigt danach den neuen Stand — die Aenderung ist sichtbar,
    // nicht nur quittiert.
    if (saved) {
      toneEditorOpen = false;
      renderAssistant();
    }
  }

  // Nur die tatsaechlich gerenderten Felder werden gesendet. Ist das zweite
  // Ziel gar nicht aufgeklappt, ist es auch nicht Teil der Aenderung — sonst
  // stuenden bei jedem Speichern drei leere Spalten in prev_values und im
  // Sync-Log.
  function collectForwardingPayload() {
    const payload = {};
    [1, 2].forEach((index) => {
      ['name', 'number', 'trigger'].forEach((part) => {
        const node = document.getElementById('vx-fwd-' + index + '-' + part);
        if (node) payload['ai_forwarding_' + index + '_' + part] = String(node.value || '').trim();
      });
    });
    return payload;
  }

  async function saveForwarding() {
    const payload = collectForwardingPayload();
    // Name ohne Nummer (oder umgekehrt) speichert der Server klaglos, der
    // Assistent nutzt das Ziel aber nicht — genau die Sorte stille Wirkungslosigkeit,
    // um die es bei N6 ging. Deshalb hier gesagt statt hingenommen.
    for (const index of [1, 2]) {
      const name = payload['ai_forwarding_' + index + '_name'];
      const number = payload['ai_forwarding_' + index + '_number'];
      if (name === undefined) continue;
      if (Boolean(name) !== Boolean(number)) {
        setStatus('assistant', 'Name und Telefonnummer gehören zusammen — Ihr Assistent verbindet sonst nicht weiter.', 'warning', true);
        document.getElementById('vx-fwd-' + index + '-' + (name ? 'number' : 'name'))?.focus();
        return;
      }
    }
    const saved = await updateAssistant(payload, 'assistant', document.getElementById('vx-forwarding-save'));
    // Erst schliessen, wenn es wirklich gespeichert ist — die Karte darueber
    // zeigt danach den neuen Stand.
    if (saved) {
      forwardingEditorOpen = false;
      forwardingSecondSlotOpen = false;
      renderAssistant();
    }
  }

  // saveBusiness() ist in saveBusinessPage() aufgegangen — die Seite schickt
  // ihre drei frueheren Formulare jetzt in einem Request.

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
