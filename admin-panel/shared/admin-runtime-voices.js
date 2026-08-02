(function initAdminVoiceCatalog(root) {
  'use strict';
  if (!root || !root.document || root.__voxeraAdminVoiceCatalogInstalled) return;
  root.__voxeraAdminVoiceCatalogInstalled = true;

  const DEFAULT_TEXT = 'Grüezi, ich bin Ihre digitale Telefonassistenz von Voxera. Ich nehme Ihre Anrufe freundlich und zuverlässig entgegen. Wie kann ich Ihnen helfen?';
  const state = {
    voices: [],
    selectedId: '',
    loading: false,
    loaded: false,
    saving: false,
    generating: false,
    testing: false,
    defaultText: DEFAULT_TEXT,
    feedbackMessage: '',
    feedbackTone: '',
    testAudioUrl: '',
    testVoiceId: ''
  };

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  function api(payload) {
    if (typeof root.callAdminFunction !== 'function') throw new Error('Admin API ist nicht verfügbar.');
    return root.callAdminFunction('admin-voices', payload);
  }

  function addStyles() {
    if (document.getElementById('vx-admin-voices-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-admin-voices-style';
    style.textContent = `
      #ai-panel-voices{display:none}
      .vx-voice-layout{display:grid;grid-template-columns:minmax(270px,.75fr) minmax(0,1.45fr);gap:16px;align-items:start}
      .vx-voice-list{display:grid;gap:8px;max-height:620px;overflow:auto;padding-right:2px}
      .vx-voice-row{width:100%;display:flex;align-items:center;gap:11px;text-align:left;border:1px solid var(--line);background:#fff;border-radius:12px;padding:11px 12px;cursor:pointer;font:inherit;color:var(--ink);transition:.15s ease}
      .vx-voice-row:hover{border-color:#B9D4FF;background:#F8FBFF}.vx-voice-row.active{border-color:#1A6FE8;box-shadow:0 0 0 1px #1A6FE8;background:#F7FAFF}
      .vx-voice-icon{width:38px;height:38px;border-radius:11px;background:#EEF4FF;color:#1A6FE8;display:flex;align-items:center;justify-content:center;flex:0 0 auto;font-size:17px}
      .vx-voice-row-main{min-width:0;flex:1}.vx-voice-row-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vx-voice-row-meta{font-size:11px;color:var(--slate2);margin-top:2px}
      .vx-voice-badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.vx-voice-badge{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;background:#F1F5F9;color:#64748B;font-size:10px;font-weight:700}.vx-voice-badge.green{background:#ECFDF5;color:#047857}.vx-voice-badge.amber{background:#FFF7ED;color:#9A3412}
      .vx-voice-editor{border:1px solid var(--line);border-radius:14px;background:#fff;padding:16px}.vx-voice-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.vx-voice-field{display:grid;gap:6px}.vx-voice-field.full{grid-column:1/-1}.vx-voice-field label{font-size:11px;font-weight:700;color:var(--slate2)}
      .vx-voice-field input,.vx-voice-field select,.vx-voice-field textarea{width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 10px;font:500 13px inherit;color:var(--ink);background:#fff}.vx-voice-field textarea{min-height:92px;resize:vertical;line-height:1.5}.vx-voice-field input[readonly]{background:#F8FAFC;color:#64748B}
      .vx-voice-checks{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0}.vx-voice-checks label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--ink)}
      .vx-voice-preview-box{margin-top:14px;padding:13px;border-radius:12px;background:#F8FAFC;border:1px solid var(--line)}.vx-voice-preview-box audio{width:100%;margin-top:10px;height:36px}
      .vx-voice-preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.vx-voice-preview-panel{padding:11px;border:1px solid var(--line);border-radius:10px;background:#fff}.vx-voice-preview-panel strong{font-size:11px;display:block}.vx-voice-preview-panel .muted{font-size:10.5px;margin-top:2px}
      .vx-voice-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}.vx-voice-feedback{display:none;margin:0 0 12px;padding:10px 12px;border-radius:9px;font-size:12px}.vx-voice-feedback.show{display:block}.vx-voice-feedback.success{background:#ECFDF5;color:#047857}.vx-voice-feedback.error{background:#FEF2F2;color:#B91C1C}.vx-voice-feedback.loading{background:#EFF6FF;color:#1D4ED8}.vx-voice-warning{padding:10px 12px;border-radius:10px;background:#FFF7ED;color:#9A3412;font-size:12px;margin-top:12px}
      @media(max-width:900px){.vx-voice-layout{grid-template-columns:1fr}.vx-voice-list{max-height:330px}}@media(max-width:720px){.vx-voice-preview-grid{grid-template-columns:1fr}}@media(max-width:640px){.vx-voice-grid{grid-template-columns:1fr}.vx-voice-field.full{grid-column:auto}.vx-voice-actions .btn{flex:1 1 100%}}
    `;
    document.head.appendChild(style);
  }

  function shell() {
    return document.getElementById('vx-admin-voices-settings');
  }

  function voicePanel() {
    return document.getElementById('ai-panel-voices');
  }

  function hideVoiceTab() {
    const panel = voicePanel();
    const tab = document.getElementById('ai-tab-voices');
    if (panel) panel.style.display = 'none';
    if (tab) {
      tab.classList.remove('active');
      tab.setAttribute('aria-selected', 'false');
    }
  }

  function showVoiceTab() {
    ['requests', 'config', 'sync'].forEach((name) => {
      const panel = document.getElementById(`ai-panel-${name}`);
      const tab = document.getElementById(`ai-tab-${name}`);
      if (panel) panel.style.display = 'none';
      if (tab) {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      }
    });
    const panel = voicePanel();
    const tab = document.getElementById('ai-tab-voices');
    if (panel) panel.style.display = 'block';
    if (tab) {
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
    }
    if (!state.loaded && !state.loading) load();
  }

  function ensureAssistantTab() {
    const assistantSection = document.getElementById('section-ai-setup');
    const tabBar = assistantSection?.querySelector('.module-tabs');
    if (!assistantSection || !tabBar) return null;

    let tab = document.getElementById('ai-tab-voices');
    if (!tab) {
      tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'module-tab';
      tab.id = 'ai-tab-voices';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.textContent = 'Stimmen';
      tab.addEventListener('click', showVoiceTab);
      tabBar.appendChild(tab);
    }

    let panel = voicePanel();
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'ai-panel-voices';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'ai-tab-voices');
      assistantSection.appendChild(panel);
    }

    if (typeof root.aiShowTab === 'function' && !root.aiShowTab.__voxeraVoicesWrapped) {
      const original = root.aiShowTab;
      const wrapped = function (tabName) {
        if (tabName === 'voices') return showVoiceTab();
        hideVoiceTab();
        return original.apply(this, arguments);
      };
      wrapped.__voxeraVoicesWrapped = true;
      root.aiShowTab = wrapped;
    }

    return panel;
  }

  function ensureShell() {
    const panel = ensureAssistantTab();
    if (!panel) return null;
    if (shell()) return shell();

    const section = document.createElement('section');
    section.id = 'vx-admin-voices-settings';
    section.className = 'card';
    section.innerHTML = `
      <div class="vx-unified-head">
        <div>
          <h3>Stimmenkatalog</h3>
          <p>Kuratierte Stimmen, Tarifzuordnung, Testwiedergabe und eigener Vorschautext.</p>
        </div>
        <button class="btn btn-secondary" type="button" id="vx-admin-voices-refresh">Neu laden</button>
      </div>
      <div id="vx-admin-voices-body" style="padding:16px">
        <div class="vx-empty-state">Stimmen werden geladen …</div>
      </div>`;
    panel.appendChild(section);
    section.querySelector('#vx-admin-voices-refresh')?.addEventListener('click', load);
    return section;
  }

  function selectedVoice() {
    return state.voices.find((voice) => String(voice.voice_id) === String(state.selectedId)) || state.voices[0] || null;
  }

  function genderLabel(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'female') return 'Weiblich';
    if (normalized === 'male') return 'Männlich';
    return 'Neutral';
  }

  function planLabel(value) {
    const normalized = String(value || '').toLowerCase();
    return normalized === 'professional' ? 'Professional' : normalized === 'business' ? 'Business' : 'Starter';
  }

  function setFeedback(message, tone = '') {
    state.feedbackMessage = message || '';
    state.feedbackTone = tone || '';
    const node = document.getElementById('vx-admin-voices-feedback');
    if (!node) return;
    node.textContent = state.feedbackMessage;
    node.className = `vx-voice-feedback${state.feedbackMessage ? ` show ${state.feedbackTone || 'loading'}` : ''}`;
  }

  function feedbackHtml() {
    return `<div id="vx-admin-voices-feedback" class="vx-voice-feedback${state.feedbackMessage ? ` show ${esc(state.feedbackTone || 'loading')}` : ''}" role="status" aria-live="polite">${esc(state.feedbackMessage)}</div>`;
  }

  function clearTestAudio() {
    if (state.testAudioUrl) URL.revokeObjectURL(state.testAudioUrl);
    state.testAudioUrl = '';
    state.testVoiceId = '';
  }

  function listHtml() {
    if (!state.voices.length) return '<div class="vx-empty-state"><strong>Keine Stimmen vorhanden</strong><span>Der Katalog enthält noch keine Einträge.</span></div>';
    return state.voices.map((voice) => {
      const active = String(voice.voice_id) === String(state.selectedId);
      const assigned = Number(voice.assigned_customers || 0);
      return `
        <button type="button" class="vx-voice-row${active ? ' active' : ''}" data-vx-voice-id="${esc(voice.voice_id)}">
          <span class="vx-voice-icon">◖</span>
          <span class="vx-voice-row-main">
            <span class="vx-voice-row-name">${esc(voice.display_name || 'Stimme')}</span>
            <span class="vx-voice-row-meta">${esc(genderLabel(voice.gender))} · ${esc(voice.language || 'Sprache offen')}</span>
            <span class="vx-voice-badges">
              <span class="vx-voice-badge">${esc(planLabel(voice.available_from_plan))}</span>
              ${voice.is_default ? '<span class="vx-voice-badge green">Standard</span>' : ''}
              ${voice.is_active ? '' : '<span class="vx-voice-badge amber">Inaktiv</span>'}
              ${assigned ? `<span class="vx-voice-badge">${assigned} Kunden</span>` : ''}
            </span>
          </span>
        </button>`;
    }).join('');
  }

  function editorHtml(voice) {
    if (!voice) return '<div class="vx-empty-state"><strong>Keine Stimme gewählt</strong><span>Wählen Sie links eine Stimme aus.</span></div>';
    const previewText = voice.preview_text || state.defaultText || DEFAULT_TEXT;
    const assigned = Number(voice.assigned_customers || 0);
    const testUrl = state.testVoiceId === String(voice.voice_id) ? state.testAudioUrl : '';
    return `
      <div class="vx-voice-editor">
        ${feedbackHtml()}
        <form id="vx-admin-voice-form">
          <div class="vx-voice-grid">
            <div class="vx-voice-field full"><label>ElevenLabs Voice-ID</label><input name="voice_id" value="${esc(voice.voice_id)}" readonly></div>
            <div class="vx-voice-field"><label>Anzeigename</label><input name="display_name" maxlength="80" required value="${esc(voice.display_name || '')}"></div>
            <div class="vx-voice-field"><label>Sprache / Akzent</label><input name="language" maxlength="80" value="${esc(voice.language || '')}" placeholder="Deutsch · Schweiz"></div>
            <div class="vx-voice-field"><label>Geschlecht</label><select name="gender"><option value="female" ${voice.gender === 'female' ? 'selected' : ''}>Weiblich</option><option value="male" ${voice.gender === 'male' ? 'selected' : ''}>Männlich</option><option value="neutral" ${voice.gender === 'neutral' ? 'selected' : ''}>Neutral</option></select></div>
            <div class="vx-voice-field"><label>Verfügbar ab Tarif</label><select name="available_from_plan"><option value="starter" ${voice.available_from_plan === 'starter' ? 'selected' : ''}>Starter</option><option value="business" ${voice.available_from_plan === 'business' ? 'selected' : ''}>Business</option><option value="professional" ${voice.available_from_plan === 'professional' ? 'selected' : ''}>Professional</option></select></div>
            <div class="vx-voice-field"><label>Sortierreihenfolge</label><input name="sort_order" type="number" min="0" max="9999" value="${Number(voice.sort_order || 0)}"></div>
            <div class="vx-voice-field full"><label>Beschreibung</label><textarea name="description" maxlength="300" placeholder="Kurze Beschreibung für Kunden">${esc(voice.description || '')}</textarea></div>
            <div class="vx-voice-field full"><label>Vorschautext</label><textarea name="preview_text" maxlength="500" minlength="20" required>${esc(previewText)}</textarea><small class="muted">„Test anhören“ verwendet den aktuellen Text, speichert ihn aber noch nicht. „Vorschau erzeugen und speichern“ veröffentlicht die feste Kundenvorschau.</small></div>
          </div>
          <div class="vx-voice-checks">
            <label><input type="checkbox" name="is_active" ${voice.is_active ? 'checked' : ''}> Im Kundenportal aktiv</label>
            <label><input type="checkbox" name="is_default" ${voice.is_default ? 'checked' : ''}> Standardstimme</label>
          </div>
          ${assigned ? `<div class="vx-voice-warning">Diese Stimme ist aktuell ${assigned} ${assigned === 1 ? 'Kundenkonto' : 'Kundenkonten'} zugewiesen. Eine Deaktivierung ändert bestehende Assistenten nicht automatisch, blendet die Stimme aber aus der neuen Auswahl aus.</div>` : ''}
          <div class="vx-voice-preview-box">
            <strong style="font-size:12px">Stimme und Kundenvorschau</strong>
            <div class="muted" style="font-size:11px;margin-top:3px">Der Test verbraucht einmalig TTS-Zeichen. Die gespeicherte Vorschau wird danach ohne neue Generierung abgespielt.</div>
            <div class="vx-voice-preview-grid">
              <div class="vx-voice-preview-panel">
                <strong>Aktueller Test</strong>
                <div class="muted">Mit dem Text aus dem Formular.</div>
                ${testUrl ? `<audio id="vx-admin-voice-test-audio" controls preload="auto" src="${esc(testUrl)}"></audio>` : '<div class="muted" style="margin-top:10px">Noch kein Test erzeugt.</div>'}
              </div>
              <div class="vx-voice-preview-panel">
                <strong>Gespeicherte Kundenvorschau</strong>
                <div class="muted">Diese Datei hört der Kunde.</div>
                ${voice.preview_url ? `<audio controls preload="none" src="${esc(voice.preview_url)}"></audio>` : '<div class="muted" style="margin-top:10px">Noch keine eigene Vorschau gespeichert.</div>'}
              </div>
            </div>
          </div>
          <div class="vx-voice-actions">
            <button class="btn btn-secondary" type="button" id="vx-admin-voice-test" ${state.testing || state.generating || state.saving ? 'disabled' : ''}>${state.testing ? 'Test wird erzeugt …' : 'Test anhören'}</button>
            <button class="btn btn-secondary" type="button" id="vx-admin-voice-generate" ${state.generating || state.testing || state.saving ? 'disabled' : ''}>${state.generating ? 'Vorschau wird erzeugt …' : 'Vorschau erzeugen und speichern'}</button>
            <button class="btn btn-primary" type="submit" ${state.saving || state.generating || state.testing ? 'disabled' : ''}>${state.saving ? 'Speichern …' : 'Stammdaten speichern'}</button>
          </div>
        </form>
      </div>`;
  }

  function render() {
    const rootNode = ensureShell();
    const body = rootNode?.querySelector('#vx-admin-voices-body');
    if (!body) return;
    if (state.loading) {
      body.innerHTML = '<div class="vx-empty-state">Stimmen werden geladen …</div>';
      return;
    }
    if (!state.selectedId && state.voices[0]) state.selectedId = state.voices[0].voice_id;
    body.innerHTML = `<div class="vx-voice-layout"><div class="vx-voice-list">${listHtml()}</div><div>${editorHtml(selectedVoice())}</div></div>`;
    bind();
  }

  function formPayload() {
    const form = document.getElementById('vx-admin-voice-form');
    if (!form) return null;
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.action = 'update';
    payload.sort_order = Number(payload.sort_order || 0);
    payload.is_active = fd.has('is_active');
    payload.is_default = fd.has('is_default');
    return payload;
  }

  function replaceVoice(updated) {
    const current = state.voices.find((voice) => voice.voice_id === updated.voice_id) || {};
    state.voices = state.voices.map((voice) => voice.voice_id === updated.voice_id ? { ...current, ...updated } : voice);
    state.voices.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.display_name || '').localeCompare(String(b.display_name || ''), 'de'));
  }

  function decodeAudio(base64, contentType) {
    const binary = root.atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: contentType || 'audio/mpeg' }));
  }

  async function save(event) {
    event.preventDefault();
    if (state.saving || state.generating || state.testing) return;
    const payload = formPayload();
    if (!payload) return;
    const existing = selectedVoice();
    if (existing && Number(existing.assigned_customers || 0) > 0 && existing.is_active && !payload.is_active) {
      const ok = root.confirm('Diese Stimme ist bestehenden Kunden zugewiesen. Trotzdem für neue Auswahlen deaktivieren?');
      if (!ok) return;
    }
    state.saving = true;
    setFeedback('Stammdaten werden gespeichert …', 'loading');
    try {
      const result = await api(payload);
      if (!result?.success || !result.voice) throw new Error(result?.error || 'Speichern fehlgeschlagen.');
      replaceVoice(result.voice);
      setFeedback('Stammdaten wurden gespeichert.', 'success');
    } catch (error) {
      setFeedback(error?.payload?.error || error?.message || 'Speichern fehlgeschlagen.', 'error');
    } finally {
      state.saving = false;
      render();
    }
  }

  async function testPreview() {
    if (state.saving || state.generating || state.testing) return;
    const payload = formPayload();
    if (!payload) return;
    const previewText = String(payload.preview_text || '').trim();
    if (previewText.length < 20) {
      setFeedback('Der Vorschautext muss mindestens 20 Zeichen enthalten.', 'error');
      return;
    }
    state.testing = true;
    setFeedback('Sprachtest wird erzeugt …', 'loading');
    try {
      const result = await api({ action: 'test_preview', voice_id: payload.voice_id, preview_text: previewText });
      if (!result?.success || !result.audio_base64) throw new Error(result?.error || 'Sprachtest konnte nicht erzeugt werden.');
      clearTestAudio();
      state.testAudioUrl = decodeAudio(result.audio_base64, result.content_type);
      state.testVoiceId = String(payload.voice_id || '');
      setFeedback('Sprachtest ist bereit. Er wurde nicht gespeichert.', 'success');
    } catch (error) {
      const detail = error?.payload?.provider_code ? ` (${error.payload.provider_code})` : '';
      setFeedback((error?.payload?.error || error?.message || 'Sprachtest konnte nicht erzeugt werden.') + detail, 'error');
    } finally {
      state.testing = false;
      render();
      const audio = document.getElementById('vx-admin-voice-test-audio');
      if (audio) audio.play().catch(() => {});
    }
  }

  async function generatePreview() {
    if (state.saving || state.generating || state.testing) return;
    const payload = formPayload();
    if (!payload) return;
    const previewText = String(payload.preview_text || '').trim();
    if (previewText.length < 20) {
      setFeedback('Der Vorschautext muss mindestens 20 Zeichen enthalten.', 'error');
      return;
    }
    state.generating = true;
    setFeedback('Vorschau wird mit ElevenLabs erzeugt und als neue Datei gespeichert …', 'loading');
    try {
      const result = await api({ action: 'generate_preview', voice_id: payload.voice_id, preview_text: previewText });
      if (!result?.success || !result.voice) throw new Error(result?.error || 'Vorschau konnte nicht erzeugt werden.');
      replaceVoice(result.voice);
      setFeedback('Neue Kundenvorschau wurde gespeichert. Das Kundenportal verwendet nun diesen Text.', 'success');
    } catch (error) {
      const detail = error?.payload?.provider_code ? ` (${error.payload.provider_code})` : '';
      setFeedback((error?.payload?.error || error?.message || 'Vorschau konnte nicht erzeugt werden.') + detail, 'error');
    } finally {
      state.generating = false;
      render();
    }
  }

  function bind() {
    document.querySelectorAll('[data-vx-voice-id]').forEach((button) => button.addEventListener('click', () => {
      const nextId = button.dataset.vxVoiceId || '';
      if (nextId !== state.selectedId) clearTestAudio();
      state.selectedId = nextId;
      state.feedbackMessage = '';
      state.feedbackTone = '';
      render();
    }));
    document.getElementById('vx-admin-voice-form')?.addEventListener('submit', save);
    document.getElementById('vx-admin-voice-test')?.addEventListener('click', testPreview);
    document.getElementById('vx-admin-voice-generate')?.addEventListener('click', generatePreview);
  }

  async function load() {
    if (state.loading) return;
    ensureShell();
    state.loading = true;
    render();
    try {
      const result = await api({ action: 'list' });
      if (!result?.success) throw new Error(result?.error || 'Stimmen konnten nicht geladen werden.');
      state.voices = Array.isArray(result.voices) ? result.voices : [];
      state.defaultText = result.default_preview_text || DEFAULT_TEXT;
      state.loaded = true;
      if (!state.voices.some((voice) => voice.voice_id === state.selectedId)) state.selectedId = state.voices[0]?.voice_id || '';
    } catch (error) {
      const body = shell()?.querySelector('#vx-admin-voices-body');
      if (body) body.innerHTML = `<div class="vx-empty-state"><strong>Stimmen konnten nicht geladen werden</strong><span>${esc(error?.payload?.error || error?.message || '')}</span><button class="btn btn-secondary" id="vx-admin-voices-retry" type="button">Erneut versuchen</button></div>`;
      body?.querySelector('#vx-admin-voices-retry')?.addEventListener('click', load);
      state.loading = false;
      return;
    }
    state.loading = false;
    render();
  }

  function install() {
    addStyles();
    ensureAssistantTab();
    const observer = new MutationObserver(() => ensureAssistantTab());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  root.addEventListener?.('beforeunload', clearTestAudio, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);
