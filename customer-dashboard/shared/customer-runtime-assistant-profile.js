(function initVoxeraAssistantProfile(root) {
  'use strict';
  if (!root || !root.document || root.__vxAssistantProfileInstalled) return;
  root.__vxAssistantProfileInstalled = true;

  let profile = null;
  let voices = [];
  let voiceFilter = 'all';
  let busy = false;
  let pendingVoiceId = '';
  let activeAudio = null;
  let activeAudioUrl = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function addStyles() {
    if (document.getElementById('vx-assistant-profile-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-assistant-profile-style';
    style.textContent = [
      '.vx-ap-stack{display:grid;gap:12px}.vx-ap-card{background:#fff;border:.5px solid var(--line,#e4e8f0);border-radius:14px;padding:16px}.vx-ap-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.vx-ap-title{font-size:14px;font-weight:700;color:var(--ink,#0d1f3c)}.vx-ap-meta{font-size:12px;color:var(--slate2,#7a8599);line-height:1.5;margin-top:4px}.vx-ap-status{display:none;padding:10px 12px;border-radius:10px;font-size:12px;margin-bottom:12px}.vx-ap-status.loading{display:block;background:#eff6ff;color:#1d4ed8}.vx-ap-status.success{display:block;background:#ecfdf5;color:#047857}.vx-ap-status.warning{display:block;background:#fff7ed;color:#9a3412}.vx-ap-status.error{display:block;background:#fef2f2;color:#b91c1c}.vx-ap-current{display:flex;align-items:center;gap:12px;margin-top:14px;padding:13px;border-radius:12px;background:#f8fafc}.vx-ap-avatar{width:42px;height:42px;border-radius:12px;background:#eef4ff;color:#1a6fe8;display:flex;align-items:center;justify-content:center;font-size:19px;flex:0 0 auto}.vx-ap-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.vx-ap-btn{border:0;border-radius:9px;padding:9px 12px;font:600 12px inherit;cursor:pointer;background:#0d1f3c;color:#fff}.vx-ap-btn.secondary{background:#eef4ff;color:#1a6fe8}.vx-ap-btn.ghost{background:#f1f5f9;color:#475569}.vx-ap-btn:disabled{opacity:.45;cursor:not-allowed}.vx-ap-filters{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0 10px}.vx-ap-filter{border:.5px solid var(--line,#e4e8f0);background:#fff;color:#64748b;border-radius:999px;padding:7px 11px;font:600 11px inherit;cursor:pointer}.vx-ap-filter.active{background:#0d1f3c;color:#fff;border-color:#0d1f3c}.vx-ap-voices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.vx-ap-voice{border:.5px solid var(--line,#e4e8f0);border-radius:12px;padding:13px;background:#fff;display:flex;flex-direction:column;gap:9px}.vx-ap-voice.selected{border-color:#1a6fe8;box-shadow:0 0 0 1px #1a6fe8}.vx-ap-voice-top{display:flex;justify-content:space-between;gap:8px}.vx-ap-voice-name{font-size:13px;font-weight:700;color:var(--ink,#0d1f3c)}.vx-ap-pill{display:inline-flex;align-items:center;padding:4px 7px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:10px;font-weight:650}.vx-ap-pill.selected{background:#ecfdf5;color:#047857}.vx-ap-field{margin-top:13px}.vx-ap-field label{display:block;font-size:11px;font-weight:650;color:var(--slate2,#7a8599);margin-bottom:5px}.vx-ap-field input,.vx-ap-field textarea{width:100%;box-sizing:border-box;border:.5px solid var(--line,#e4e8f0);border-radius:9px;padding:10px 11px;background:#fff;color:var(--ink,#0d1f3c);font:500 13px inherit}.vx-ap-field textarea{min-height:108px;resize:vertical;line-height:1.5}.vx-ap-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.vx-ap-summary{display:grid;gap:9px;margin-top:13px}.vx-ap-summary-row{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:.5px solid var(--line,#e4e8f0);font-size:12px}.vx-ap-summary-row:last-child{border-bottom:0}.vx-ap-summary-key{color:var(--slate2,#7a8599)}.vx-ap-summary-value{color:var(--ink,#0d1f3c);font-weight:600;text-align:right}.vx-ap-modal{position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,.48);display:none;align-items:center;justify-content:center;padding:18px}.vx-ap-modal.open{display:flex}.vx-ap-dialog{width:min(440px,100%);background:#fff;border-radius:16px;padding:20px;box-shadow:0 24px 70px rgba(15,23,42,.25)}.vx-ap-empty{padding:18px;border:.5px dashed var(--line,#e4e8f0);border-radius:12px;color:var(--slate2,#7a8599);font-size:12px;text-align:center}@media(max-width:720px){.vx-ap-voices,.vx-ap-grid{grid-template-columns:1fr}.vx-ap-head{align-items:flex-start}.vx-ap-current{align-items:flex-start}}'
    ].join('');
    document.head.appendChild(style);
  }

  function listContainer() {
    const main = document.getElementById('mehr-main');
    return main?.querySelector('.vx-page-header')?.nextElementSibling || null;
  }

  function createEntry(id, icon, title, subtitle, handler) {
    if (document.getElementById(id)) return;
    const list = listContainer();
    if (!list) return;
    const entry = document.createElement('div');
    entry.id = id;
    entry.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;border-bottom:.5px solid var(--line)';
    entry.innerHTML = '<div style="width:36px;height:36px;background:#eef4ff;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ph-bold ' + icon + '" style="color:#1a6fe8;font-size:17px" aria-hidden="true"></i></div><div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--ink)">' + esc(title) + '</div><div style="font-size:11px;color:var(--slate2)">' + esc(subtitle) + '</div></div><i class="ph-bold ph-caret-right" style="color:var(--slate2);font-size:15px" aria-hidden="true"></i>';
    entry.addEventListener('click', handler);
    const calendar = document.getElementById('vx-calendar-settings-entry');
    const help = Array.from(list.children).find((child) => /Hilfe/.test(child.textContent || ''));
    list.insertBefore(entry, calendar || help || null);
  }

  function createPage(id, title, subtitle, bodyId, backHandler) {
    if (document.getElementById(id)) return;
    const tab = document.getElementById('tab-mehr');
    if (!tab) return;
    const page = document.createElement('div');
    page.id = id;
    page.style.display = 'none';
    page.innerHTML = '<div class="vx-page-header" style="align-items:center;gap:12px"><button type="button" class="vx-back-btn" data-vx-ap-back><i class="ph-bold ph-arrow-left" style="font-size:18px" aria-hidden="true"></i></button><div style="flex:1"><div class="vx-page-header-title">' + esc(title) + '</div><div style="font-size:12px;color:var(--slate2);margin-top:3px">' + esc(subtitle) + '</div></div></div><div id="' + bodyId + '"></div>';
    tab.appendChild(page);
    page.querySelector('[data-vx-ap-back]').addEventListener('click', backHandler);
  }

  function inject() {
    addStyles();
    const main = document.getElementById('mehr-main');
    const tab = document.getElementById('tab-mehr');
    if (!main || !tab || !listContainer()) return false;
    createEntry('vx-assistant-profile-entry', 'ph-user-sound', 'Mein Assistent', 'Stimme, Name und Auftreten', openAssistant);
    createEntry('vx-business-profile-entry', 'ph-buildings', 'Geschäftsprofil', 'Dauerhaftes Wissen des Assistenten', openBusiness);
    createPage('mehr-sub-assistant-profile', 'Mein Assistent', 'Nur die wichtigsten und sicheren Anpassungen.', 'vx-assistant-profile-body', back);
    createPage('mehr-sub-business-profile', 'Geschäftsprofil', 'Dauerhafte Angaben zu Ihrem Unternehmen.', 'vx-business-profile-body', back);
    if (!document.getElementById('vx-assistant-voice-modal')) {
      const modal = document.createElement('div');
      modal.id = 'vx-assistant-voice-modal';
      modal.className = 'vx-ap-modal';
      modal.innerHTML = '<div class="vx-ap-dialog" role="dialog" aria-modal="true" aria-labelledby="vx-ap-modal-title"><div class="vx-ap-title" id="vx-ap-modal-title">Stimme übernehmen?</div><div class="vx-ap-meta" id="vx-ap-modal-copy" style="margin-top:8px"></div><div class="vx-ap-actions" style="justify-content:flex-end"><button type="button" class="vx-ap-btn ghost" data-vx-voice-cancel>Abbrechen</button><button type="button" class="vx-ap-btn" data-vx-voice-confirm>Stimme übernehmen</button></div></div>';
      document.body.appendChild(modal);
      modal.querySelector('[data-vx-voice-cancel]').addEventListener('click', closeVoiceModal);
      modal.querySelector('[data-vx-voice-confirm]').addEventListener('click', confirmVoiceChange);
      modal.addEventListener('click', (event) => { if (event.target === modal) closeVoiceModal(); });
    }
    return true;
  }

  function showPage(id) {
    const tab = document.getElementById('tab-mehr');
    const main = document.getElementById('mehr-main');
    if (!tab || !main) return;
    main.style.display = 'none';
    tab.querySelectorAll('[id^="mehr-sub-"]').forEach((node) => { node.style.display = 'none'; });
    const target = document.getElementById(id);
    if (target) target.style.display = 'block';
  }

  function openAssistant() {
    showPage('mehr-sub-assistant-profile');
    renderAssistant();
    if (!profile) load();
  }

  function openBusiness() {
    showPage('mehr-sub-business-profile');
    renderBusiness();
    if (!profile) load();
  }

  function back() {
    stopAudio();
    const tab = document.getElementById('tab-mehr');
    tab?.querySelectorAll('[id^="mehr-sub-"]').forEach((node) => { node.style.display = 'none'; });
    const main = document.getElementById('mehr-main');
    if (main) main.style.display = '';
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
    if (options.blob) {
      if (!response.ok) throw new Error('Sprachvorschau konnte nicht geladen werden.');
      return response.blob();
    }
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Aktion fehlgeschlagen.');
    return payload;
  }

  function setStatus(page, message, tone) {
    const node = document.getElementById(page === 'business' ? 'vx-business-profile-status' : 'vx-assistant-profile-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'vx-ap-status' + (message ? ' ' + (tone || 'loading') : '');
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

  function selectedVoice() {
    const selectedId = profile?.assistant?.voice_id || '';
    return voices.find((voice) => voice.voice_id === selectedId) || null;
  }

  function voiceCard(voice) {
    const selected = voice.voice_id === profile?.assistant?.voice_id;
    return '<div class="vx-ap-voice' + (selected ? ' selected' : '') + '"><div class="vx-ap-voice-top"><div><div class="vx-ap-voice-name">' + esc(voice.display_name || 'Stimme') + '</div><div class="vx-ap-meta">' + esc(genderLabel(voice.gender)) + (voice.language ? ' · ' + esc(voice.language) : '') + '</div></div>' + (selected ? '<span class="vx-ap-pill selected">Aktuell</span>' : '<span class="vx-ap-pill">' + esc(voice.available_from_plan || '') + '</span>') + '</div><div class="vx-ap-meta">' + esc(voice.description || 'Kuratierte Voxera-Stimme') + '</div><div class="vx-ap-actions" style="margin-top:auto"><button type="button" class="vx-ap-btn secondary" data-vx-preview="' + esc(voice.voice_id) + '"' + (busy ? ' disabled' : '') + '><i class="ph-bold ph-play" aria-hidden="true"></i> Anhören</button>' + (selected ? '' : '<button type="button" class="vx-ap-btn" data-vx-select-voice="' + esc(voice.voice_id) + '"' + (!profile?.permissions?.can_change_voice || busy ? ' disabled' : '') + '>Auswählen</button>') + '</div></div>';
  }

  function renderAssistant() {
    const body = document.getElementById('vx-assistant-profile-body');
    if (!body) return;
    if (!profile) {
      body.innerHTML = '<div class="vx-ap-status loading" style="display:block">Assistent wird geladen …</div>';
      return;
    }
    const current = selectedVoice();
    const filtered = voices.filter((voice) => voiceFilter === 'all' || genderKey(voice.gender) === voiceFilter);
    const business = profile.business_profile || {};
    const completed = Number(business.completed_fields || 0);
    const total = Number(business.total_fields || 4);
    body.innerHTML = '<div id="vx-assistant-profile-status" class="vx-ap-status" role="status" aria-live="polite"></div><div class="vx-ap-stack">' +
      '<section class="vx-ap-card"><div class="vx-ap-head"><div><div class="vx-ap-title">Stimme</div><div class="vx-ap-meta">Wählen Sie aus kuratierten Stimmen. Technische Sprachparameter bleiben geschützt.</div></div></div><div class="vx-ap-current"><div class="vx-ap-avatar"><i class="ph-bold ph-waveform" aria-hidden="true"></i></div><div style="flex:1"><div class="vx-ap-title">' + esc(current?.display_name || 'Standardstimme') + '</div><div class="vx-ap-meta">' + esc(current ? genderLabel(current.gender) : 'Von Voxera eingerichtet') + '</div></div>' + (current ? '<button type="button" class="vx-ap-btn secondary" data-vx-preview="' + esc(current.voice_id) + '">Anhören</button>' : '') + '</div>' +
      (profile.permissions?.can_change_voice ? '<div class="vx-ap-filters"><button type="button" class="vx-ap-filter' + (voiceFilter === 'all' ? ' active' : '') + '" data-vx-filter="all">Alle</button><button type="button" class="vx-ap-filter' + (voiceFilter === 'female' ? ' active' : '') + '" data-vx-filter="female">Weiblich</button><button type="button" class="vx-ap-filter' + (voiceFilter === 'male' ? ' active' : '') + '" data-vx-filter="male">Männlich</button></div><div class="vx-ap-voices">' + (filtered.length ? filtered.map(voiceCard).join('') : '<div class="vx-ap-empty">Für diesen Filter sind keine Stimmen freigeschaltet.</div>') + '</div>' : '<div class="vx-ap-status warning" style="display:block;margin-top:13px;margin-bottom:0">Die Stimmenauswahl ist in Ihrem aktuellen Paket nicht freigeschaltet.</div>') + '</section>' +
      '<section class="vx-ap-card"><div class="vx-ap-title">Name und Auftreten</div><div class="vx-ap-meta">Der Name ist die Bezeichnung, mit der sich der Assistent meldet.</div>' +
      (profile.permissions?.can_change_name ? '<div class="vx-ap-field"><label>Name des Assistenten</label><input id="vx-assistant-name" maxlength="40" value="' + esc(profile.assistant?.name || '') + '" placeholder="z. B. Lea"></div><div class="vx-ap-actions"><button type="button" class="vx-ap-btn" id="vx-assistant-name-save"' + (busy ? ' disabled' : '') + '>Name speichern</button></div>' : '<div class="vx-ap-summary"><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Name</span><span class="vx-ap-summary-value">' + esc(profile.assistant?.name || 'Von Voxera eingerichtet') + '</span></div></div>') +
      '<div class="vx-ap-summary"><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Kommunikationsstil</span><span class="vx-ap-summary-value">' + esc(profile.assistant?.tone || 'Professionell und freundlich') + '</span></div><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Ansprache</span><span class="vx-ap-summary-value">' + esc(profile.assistant?.address_form || 'Sie') + '</span></div><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Technischer Agent</span><span class="vx-ap-summary-value">' + (profile.assistant?.has_agent ? 'Eingerichtet' : 'Noch nicht eingerichtet') + '</span></div></div></section>' +
      '<section class="vx-ap-card"><div class="vx-ap-head"><div><div class="vx-ap-title">Geschäftswissen</div><div class="vx-ap-meta">Dauerhafte Informationen werden zentral im Geschäftsprofil gepflegt.</div></div><span class="vx-ap-pill' + (completed === total ? ' selected' : '') + '">' + completed + ' von ' + total + ' Bereichen</span></div><div class="vx-ap-summary"><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Unternehmen</span><span class="vx-ap-summary-value">' + esc(business.company_name || 'Nicht angegeben') + '</span></div><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Leistungen</span><span class="vx-ap-summary-value">' + esc(business.services ? 'Hinterlegt' : 'Noch ergänzen') + '</span></div><div class="vx-ap-summary-row"><span class="vx-ap-summary-key">Öffnungszeiten / Standort</span><span class="vx-ap-summary-value">' + esc(business.location_hours ? 'Hinterlegt' : 'Noch ergänzen') + '</span></div></div><div class="vx-ap-actions"><button type="button" class="vx-ap-btn secondary" id="vx-open-business-profile">Geschäftsprofil öffnen</button></div></section></div>';
    bindAssistant();
  }

  function renderBusiness() {
    const body = document.getElementById('vx-business-profile-body');
    if (!body) return;
    if (!profile) {
      body.innerHTML = '<div class="vx-ap-status loading" style="display:block">Geschäftsprofil wird geladen …</div>';
      return;
    }
    const data = profile.business_profile || {};
    body.innerHTML = '<div id="vx-business-profile-status" class="vx-ap-status" role="status" aria-live="polite"></div><div class="vx-ap-card"><div class="vx-ap-head"><div><div class="vx-ap-title">Dauerhaftes Geschäftswissen</div><div class="vx-ap-meta">Diese Informationen verwendet der Assistent im normalen Betrieb. Ferien und kurzfristige Änderungen gehören weiterhin in „Aktuelle Betriebsinfos“.</div></div><span class="vx-ap-pill">' + esc(profile.plan_code || '') + '</span></div><div class="vx-ap-grid"><div class="vx-ap-field"><label>Unternehmensbeschreibung</label><textarea id="vx-business-description" placeholder="Was macht Ihr Unternehmen und für wen?">' + esc(data.description || '') + '</textarea></div><div class="vx-ap-field"><label>Leistungen und Angebote</label><textarea id="vx-business-services" placeholder="Welche Leistungen darf der Assistent erklären?">' + esc(data.services || '') + '</textarea></div><div class="vx-ap-field"><label>Standort und reguläre Öffnungszeiten</label><textarea id="vx-business-location-hours" placeholder="Adresse, Einzugsgebiet und reguläre Öffnungszeiten">' + esc(data.location_hours || '') + '</textarea></div><div class="vx-ap-field"><label>Häufige Fragen und Buchungshinweise</label><textarea id="vx-business-booking-faq" placeholder="Wichtige Antworten, Voraussetzungen oder Hinweise">' + esc(data.booking_faq || '') + '</textarea></div></div><div class="vx-ap-actions"><button type="button" class="vx-ap-btn" id="vx-business-profile-save"' + (busy ? ' disabled' : '') + '>Geschäftsprofil speichern</button></div></div>';
    document.getElementById('vx-business-profile-save')?.addEventListener('click', saveBusiness);
  }

  function bindAssistant() {
    document.querySelectorAll('[data-vx-filter]').forEach((node) => node.addEventListener('click', () => {
      voiceFilter = node.dataset.vxFilter || 'all';
      renderAssistant();
    }));
    document.querySelectorAll('[data-vx-preview]').forEach((node) => node.addEventListener('click', () => previewVoice(node.dataset.vxPreview, node)));
    document.querySelectorAll('[data-vx-select-voice]').forEach((node) => node.addEventListener('click', () => openVoiceModal(node.dataset.vxSelectVoice)));
    document.getElementById('vx-assistant-name-save')?.addEventListener('click', saveName);
    document.getElementById('vx-open-business-profile')?.addEventListener('click', openBusiness);
  }

  async function load() {
    setStatus('assistant', 'Assistent wird geladen …', 'loading');
    try {
      const [profileResult, voiceResult] = await Promise.all([
        request('customer-assistant-profile'),
        request('get-available-voices')
      ]);
      profile = profileResult;
      voices = Array.isArray(voiceResult.voices) ? voiceResult.voices : [];
      if (!profile.assistant.voice_id && voiceResult.selected_voice_id) profile.assistant.voice_id = voiceResult.selected_voice_id;
      renderAssistant();
      renderBusiness();
    } catch (error) {
      const message = error?.message || 'Assistent konnte nicht geladen werden.';
      const assistantBody = document.getElementById('vx-assistant-profile-body');
      const businessBody = document.getElementById('vx-business-profile-body');
      if (assistantBody) assistantBody.innerHTML = '<div class="vx-ap-status error" style="display:block">' + esc(message) + '</div>';
      if (businessBody) businessBody.innerHTML = '<div class="vx-ap-status error" style="display:block">' + esc(message) + '</div>';
    }
  }

  async function updateAssistant(payload, page, loadingMessage) {
    if (busy) return null;
    busy = true;
    page === 'business' ? renderBusiness() : renderAssistant();
    setStatus(page, loadingMessage, 'loading');
    try {
      const result = await request('customer-update-assistant', { method: 'POST', body: payload });
      await reloadProfile();
      const syncStatus = String(result.sync_status || '');
      if (syncStatus === 'failed') {
        setStatus(page, 'Gespeichert, aber noch nicht mit dem Assistenten synchronisiert. Bitte später erneut versuchen.', 'warning');
      } else if (syncStatus === 'skipped_no_agent') {
        setStatus(page, 'Gespeichert. Der technische Assistent ist noch nicht eingerichtet.', 'warning');
      } else {
        setStatus(page, '✓ Änderung gespeichert und verarbeitet.', 'success');
      }
      return result;
    } catch (error) {
      setStatus(page, error?.message || 'Änderung konnte nicht gespeichert werden.', 'error');
      return null;
    } finally {
      busy = false;
      page === 'business' ? renderBusiness() : renderAssistant();
    }
  }

  async function reloadProfile() {
    const result = await request('customer-assistant-profile');
    profile = result;
  }

  async function saveName() {
    const value = String(document.getElementById('vx-assistant-name')?.value || '').trim();
    await updateAssistant({ assistant_name: value }, 'assistant', 'Name wird gespeichert …');
  }

  async function saveBusiness() {
    const payload = {
      ai_business_description: document.getElementById('vx-business-description')?.value || '',
      ai_services: document.getElementById('vx-business-services')?.value || '',
      ai_location_hours: document.getElementById('vx-business-location-hours')?.value || '',
      ai_booking_faq: document.getElementById('vx-business-booking-faq')?.value || ''
    };
    await updateAssistant(payload, 'business', 'Geschäftsprofil wird gespeichert …');
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
    await updateAssistant({ voice_id: voiceId }, 'assistant', 'Stimme wird übernommen …');
  }

  function stopAudio() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    if (activeAudioUrl) {
      URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = '';
    }
  }

  async function previewVoice(voiceId, button) {
    if (!voiceId || busy) return;
    stopAudio();
    const original = button?.innerHTML;
    if (button) {
      button.disabled = true;
      button.textContent = 'Wird geladen …';
    }
    try {
      const blob = await request('preview-voice', { method: 'POST', body: { voice_id: voiceId }, blob: true });
      activeAudioUrl = URL.createObjectURL(blob);
      activeAudio = new Audio(activeAudioUrl);
      activeAudio.addEventListener('ended', stopAudio, { once: true });
      await activeAudio.play();
    } catch (error) {
      setStatus('assistant', error?.message || 'Sprachvorschau konnte nicht abgespielt werden.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original || 'Anhören';
      }
    }
  }

  function boot() {
    if (!inject()) {
      window.setTimeout(boot, 250);
      return;
    }
    window.addEventListener('beforeunload', stopAudio, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
