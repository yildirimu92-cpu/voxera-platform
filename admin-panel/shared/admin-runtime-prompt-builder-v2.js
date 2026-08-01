(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const MARKER = '[PROMPT_V2]';
  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once:true });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const text = value => String(value ?? '').trim();

  function parseProfile(notes) {
    const line = String(notes || '').split(/\r?\n/).find(item => item.trim().startsWith(MARKER));
    if (!line) return {};
    try {
      const value = JSON.parse(line.trim().slice(MARKER.length).trim());
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function upsertProfile(notes, profile) {
    const kept = String(notes || '').split(/\r?\n/).filter(line => !line.trim().startsWith(MARKER));
    return [`${MARKER} ${JSON.stringify(profile)}`, ...kept].filter(Boolean).join('\n').trim();
  }

  function profileFromData(data) {
    return {
      version: 2,
      functions: Array.isArray(data._promptFunctions) ? [...new Set(data._promptFunctions.filter(Boolean))] : [],
      functionInstructions: text(data._promptFunctionInstructions),
      requiredInformation: text(data._promptRequiredInformation),
      successDefinition: text(data._promptSuccessDefinition),
      appointmentMode: text(data._promptAppointmentMode) || 'request',
      unknownHandling: text(data._promptUnknownHandling) || 'callback'
    };
  }

  function persistProfileToConfig(data) {
    if (typeof state === 'undefined' || !state.aiWizard?.customerId) return;
    const id = state.aiWizard.customerId;
    const cfg = state.aiConfigs?.[id] || {};
    const customerNotes = typeof customerById === 'function' ? customerById(id)?.ai_internal_notes : '';
    cfg.internalNotes = upsertProfile(cfg.internalNotes || customerNotes, profileFromData(data));
    state.aiConfigs[id] = cfg;
  }

  function hydrateData(data, profile) {
    const profileKeys = profile && typeof profile === 'object' ? Object.keys(profile) : [];
    const hasPersistedProfile = profileKeys.some(key => key !== 'version' && (
      (Array.isArray(profile[key]) && profile[key].length > 0) ||
      (!Array.isArray(profile[key]) && text(profile[key]))
    ));
    if (hasPersistedProfile) data._promptProfilePersisted = true;
    else if (typeof data._promptProfilePersisted !== 'boolean') data._promptProfilePersisted = false;
    const legacyFunction = {service:'information',lead:'lead',appointment:'appointment',callback:'callback',support:'support'}[profile.goal];
    data._promptFunctions = Array.isArray(profile.functions) && profile.functions.length
      ? [...profile.functions]
      : (Array.isArray(data._promptFunctions) && data._promptFunctions.length ? data._promptFunctions : [legacyFunction || 'information']);
    data._promptFunctionInstructions = profile.functionInstructions || data._promptFunctionInstructions || '';
    data._promptRequiredInformation = profile.requiredInformation || data._promptRequiredInformation || 'Name und Rückrufnummer\nKonkretes Anliegen\nGewünschter nächster Schritt';
    data._promptSuccessDefinition = profile.successDefinition || data._promptSuccessDefinition || 'Das Anliegen ist verstanden, alle nötigen Angaben sind erfasst und der nächste Schritt wurde eindeutig zusammengefasst.';
    data._promptAppointmentMode = profile.appointmentMode || data._promptAppointmentMode || 'request';
    data._promptUnknownHandling = profile.unknownHandling || data._promptUnknownHandling || 'callback';
  }

  function radio(name, value, current, label, hint) {
    return `<label class="wizard-radio-opt${current === value ? ' selected' : ''}">
      <input type="radio" name="${esc(name)}" value="${esc(value)}" ${current === value ? 'checked' : ''}>
      <div><div class="wizard-radio-label">${esc(label)}</div>${hint ? `<div class="wizard-radio-sub">${esc(hint)}</div>` : ''}</div>
    </label>`;
  }

  function checkbox(value, selected, label, hint) {
    const checked = selected.includes(value);
    return `<label class="wizard-radio-opt${checked ? ' selected' : ''}">
      <input type="checkbox" name="wz-prompt-functions" value="${esc(value)}" ${checked ? 'checked' : ''}>
      <div><div class="wizard-radio-label">${esc(label)}</div>${hint ? `<div class="wizard-radio-sub">${esc(hint)}</div>` : ''}</div>
    </label>`;
  }

  function renderAssignment(data) {
    hydrateData(data, {});
    return `
      <div style="padding:12px 14px;margin-bottom:14px;border:1px solid #BFDBFE;background:var(--blue-soft,#EEF5FF);border-radius:10px;font-size:12px;line-height:1.55;color:var(--ink)">
        Wähle alle Funktionen, die dieser Kunde benötigt. Der Agent kombiniert sie abhängig vom Anliegen des Anrufers. Formuliere betriebliche Regeln – keine technischen Prompt-Befehle.
      </div>
      <div class="wizard-field"><label>Funktionen des Agenten <span style="font-weight:500;color:var(--slate2)">(Mehrfachauswahl)</span></label><div class="wizard-radio-group">
        ${checkbox('information',data._promptFunctions,'Information & FAQ','Fragen anhand der hinterlegten Unternehmensdaten beantworten.')}
        ${checkbox('consulting',data._promptFunctions,'Beratung','Bedarf verstehen und passende dokumentierte Leistungen erklären.')}
        ${checkbox('lead',data._promptFunctions,'Lead qualifizieren','Interesse, Bedarf und Voraussetzungen für die Beratung klären.')}
        ${checkbox('appointment',data._promptFunctions,'Termine','Terminanfrage aufnehmen oder mit angebundenem Kalender buchen.')}
        ${checkbox('quote',data._promptFunctions,'Offertenanfrage','Anforderungen für ein Angebot strukturiert erfassen.')}
        ${checkbox('callback',data._promptFunctions,'Rückruf aufnehmen','Eine vollständige und priorisierte Rückrufanfrage erfassen.')}
        ${checkbox('support',data._promptFunctions,'Support-Triage','Supportanliegen aufnehmen, priorisieren und weiterleiten.')}
        ${checkbox('transfer',data._promptFunctions,'Weiterleiten','Gemäss konfigurierten Regeln an die richtige Person übergeben.')}
      </div></div>
      <div class="wizard-field"><label>Spezifische Regeln für die gewählten Funktionen</label>
        <textarea class="textarea" id="wz-prompt-function-instructions" style="min-height:110px" placeholder="Beispiel:\nBeratung: Starter für kleine Teams, Business bei mehreren Sprachen erklären.\nLead: Branche, Teamgrösse und Anrufvolumen erfragen.\nOfferte: Keine Preise zusagen; Beratungstermin anbieten.">${esc(data._promptFunctionInstructions)}</textarea>
        <div class="wizard-hint">Hier kann jeder Kunde bestimmen, wie die gewählten Funktionen konkret ausgeführt werden.</div>
      </div>
      <div class="wizard-field"><label>Welche Angaben müssen erfasst werden?</label>
        <textarea class="textarea" id="wz-prompt-required" style="min-height:105px" placeholder="Eine Angabe pro Zeile">${esc(data._promptRequiredInformation)}</textarea>
        <div class="wizard-hint">Nur Informationen eintragen, die für den nächsten Prozessschritt wirklich benötigt werden.</div>
      </div>
      <div class="wizard-field"><label>Wann gilt das Gespräch als erfolgreich?</label>
        <textarea class="textarea" id="wz-prompt-success" style="min-height:88px">${esc(data._promptSuccessDefinition)}</textarea>
      </div>
      <div class="wizard-field"><label>Terminbefugnis</label><div class="wizard-radio-group">
        ${radio('wz-prompt-appointment','none',data._promptAppointmentMode,'Keine Termine','Nur informieren oder Rückruf anbieten.')}
        ${radio('wz-prompt-appointment','request',data._promptAppointmentMode,'Terminanfrage aufnehmen','Keine Zusage; Bestätigung erfolgt durch das Unternehmen.')}
        ${radio('wz-prompt-appointment','direct',data._promptAppointmentMode,'Direkt buchen','Nur mit erfolgreicher Bestätigung des angebundenen Kalenders.')}
      </div></div>
      <div class="wizard-field"><label>Wenn eine Information fehlt</label><div class="wizard-radio-group">
        ${radio('wz-prompt-unknown','transparent',data._promptUnknownHandling,'Transparent bleiben','Offen sagen, dass die Information nicht vorliegt.')}
        ${radio('wz-prompt-unknown','callback',data._promptUnknownHandling,'Rückruf aufnehmen','Kontaktdaten und Anliegen vollständig erfassen.')}
        ${radio('wz-prompt-unknown','human',data._promptUnknownHandling,'An Menschen übergeben','Weiterleiten, sonst Rückruf aufnehmen.')}
      </div></div>`;
  }

  function collectAssignment(data) {
    data._promptProfileUserEdited = true;
    data._promptFunctions = Array.from(document.querySelectorAll('input[name="wz-prompt-functions"]:checked')).map(input => input.value);
    data._promptFunctionInstructions = document.getElementById('wz-prompt-function-instructions')?.value.trim() || '';
    data._promptRequiredInformation = document.getElementById('wz-prompt-required')?.value.trim() || '';
    data._promptSuccessDefinition = document.getElementById('wz-prompt-success')?.value.trim() || '';
    data._promptAppointmentMode = document.querySelector('input[name="wz-prompt-appointment"]:checked')?.value || data._promptAppointmentMode || 'request';
    data._promptUnknownHandling = document.querySelector('input[name="wz-prompt-unknown"]:checked')?.value || data._promptUnknownHandling || 'callback';
  }

  function preflight(data) {
    return [
      ['Geschäftsprofil', Boolean(text(data.businessDescription)), 'Der Agent kennt das Unternehmen.'],
      ['Leistungen', Boolean(text(data.services)), 'Der Agent kennt das tatsächliche Angebot.'],
      ['Agent-Funktionen', Array.isArray(data._promptFunctions) && data._promptFunctions.length > 0, 'Mindestens eine kombinierbare Funktion ist ausgewählt.'],
      ['Pflichtinformationen', Boolean(text(data._promptRequiredInformation)), 'Notwendige Angaben sind festgelegt.'],
      ['Terminbefugnis', Boolean(text(data._promptAppointmentMode)), 'Buchungszusagen sind klar begrenzt.'],
      ['Fallback', Boolean(text(data._promptUnknownHandling) && text(data.fallbackEscalation)), 'Unsicherheit und Eskalation sind geregelt.'],
      ['Antwortgrenzen', Boolean(text(data.responseConstraints)), 'Verbotene oder sensible Aussagen sind definiert.']
    ];
  }

  function renderPreflight(data) {
    const checks = preflight(data);
    const passed = checks.filter(item => item[1]).length;
    const score = Math.round((passed / checks.length) * 100);
    const color = score === 100 ? 'var(--green,#059669)' : score >= 70 ? 'var(--amber,#D97706)' : 'var(--red,#DC2626)';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;margin-bottom:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)">
        <div><div style="font-weight:800">Prompt-Qualitätscheck</div><div style="font-size:11px;color:var(--slate2);margin-top:3px">Vollständigkeit und klare Entscheidungsgrenzen</div></div>
        <div style="font-size:25px;font-weight:850;color:${color}">${score}%</div>
      </div>
      <div style="border:1px solid var(--line);border-radius:12px;padding:4px 14px;background:var(--surface)">
        ${checks.map(([label, ok, detail]) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line2)"><span style="color:${ok ? 'var(--green,#059669)' : 'var(--red,#DC2626)'};font-weight:900">${ok ? '✓' : '!'}</span><div><div style="font-size:12px;font-weight:750">${esc(label)}</div><div style="font-size:11px;color:var(--slate2);margin-top:2px">${esc(detail)}</div></div></div>`).join('')}
      </div>
      <div style="margin-top:12px;padding:12px 14px;border-radius:10px;background:var(--amber-light,#FFFBEB);border:1px solid var(--amber-mid,#FDE68A);font-size:12px;line-height:1.55">
        Dieser Check validiert die Konfiguration. Vor dem Go-live bleiben reale Testanrufe für Preisfrage, unbekannte Information, Terminwunsch und Eskalation obligatorisch.
      </div>`;
  }

  function installWizardSteps() {
    const original = w.getWizardSteps;
    if (typeof original !== 'function' || original.__voxPromptBuilderV2) return;
    const wrapped = function () {
      const steps = original.apply(this, arguments);
      if (!Array.isArray(steps) || steps.some(step => step.id === 'agent_auftrag')) return steps;
      const assignment = { id:'agent_auftrag', title:'Auftrag & Befugnisse', sub:'Was der Agent erreichen, erfassen und verbindlich tun darf', render:renderAssignment, collect:collectAssignment };
      const check = { id:'prompt_check', title:'Prompt-Qualitätscheck', sub:'Vollständigkeit und Entscheidungsgrenzen vor dem Speichern', render:renderPreflight, collect:persistProfileToConfig };
      const profileIndex = steps.findIndex(step => step.id === 'profil');
      steps.splice(profileIndex >= 0 ? profileIndex + 1 : 0, 0, assignment);
      const summaryIndex = steps.findIndex(step => step.id === 'zusammenfassung');
      steps.splice(summaryIndex >= 0 ? summaryIndex : steps.length, 0, check);
      return steps;
    };
    wrapped.__voxPromptBuilderV2 = true;
    wrapped.__voxOriginal = original;
    w.getWizardSteps = wrapped;
  }

  function installWizardHydration() {
    const original = w.openAiWizard;
    if (typeof original !== 'function' || original.__voxPromptBuilderV2) return;
    const wrapped = async function () {
      const requestedId = String(arguments[0] || '');
      const result = await original.apply(this, arguments);
      if (typeof state === 'undefined' || !state.aiWizard?.data) return result;
      if (!document.getElementById('ai-wizard-modal')?.classList.contains('open')) return result;
      if (requestedId && String(state.aiWizard.customerId || '') !== requestedId) return result;
      const id = state.aiWizard.customerId;
      const configNotes = state.aiConfigs?.[id]?.internalNotes;
      const customerNotes = typeof customerById === 'function' ? customerById(id)?.ai_internal_notes : '';
      hydrateData(state.aiWizard.data, parseProfile(configNotes || customerNotes));
      state.aiWizard.steps = w.getWizardSteps(state.aiWizard.data.templateId || 'generic');
      if (typeof renderWizardModal === 'function') renderWizardModal();
      return result;
    };
    wrapped.__voxPromptBuilderV2 = true;
    wrapped.__voxOriginal = original;
    w.openAiWizard = wrapped;
  }

  function renderPreviewQuality(quality, version) {
    const content = document.getElementById('ai-preview-content');
    const parent = content?.parentElement;
    if (!parent) return;
    let panel = document.getElementById('vox-prompt-quality-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'vox-prompt-quality-panel';
      parent.insertBefore(panel, content);
    }
    const checks = Array.isArray(quality?.checks) ? quality.checks : [];
    panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)"><div><strong style="font-size:12px">Prompt Builder V${esc(version || '2')}</strong><div style="font-size:10px;color:var(--slate2);margin-top:2px">${esc(quality?.note || '')}</div></div><span class="badge ${quality?.ready ? 'badge-green' : 'badge-amber'}">${Number(quality?.score || 0)}%</span></div>${checks.length ? `<div style="font-size:10px;color:var(--slate2);margin:-2px 0 10px">${checks.filter(item => item.passed).length}/${checks.length} Qualitätskriterien erfüllt</div>` : ''}`;
  }

  function installExactPreview() {
    const original = w.openAiPreview;
    if (typeof original !== 'function' || original.__voxPromptBuilderV2) return;
    const wrapped = async function () {
      const id = typeof state !== 'undefined' ? state.aiSelectedCustomerId : null;
      if (!id || typeof w.callAdminFunction !== 'function') return original.apply(this, arguments);
      const promptEl = document.getElementById('ai-preview-content');
      const greetingEl = document.getElementById('ai-preview-greeting');
      if (promptEl) promptEl.textContent = 'Der produktive Prompt wird serverseitig erstellt…';
      if (greetingEl) greetingEl.textContent = 'Wird geladen…';
      document.getElementById('ai-preview-modal')?.classList.add('open');
      try {
        const result = await w.callAdminFunction('prompt-preview', { customer_id:id });
        if (!result?.success || !result?.prompt) throw new Error(result?.error || 'Prompt-Vorschau fehlgeschlagen.');
        if (promptEl) promptEl.textContent = result.prompt;
        if (greetingEl) greetingEl.textContent = result.first_message || '';
        renderPreviewQuality(result.quality, result.prompt_version);
      } catch (error) {
        original.apply(this, arguments);
        if (typeof w.showToast === 'function') w.showToast('Server-Vorschau nicht verfügbar – lokale Vorschau angezeigt.');
      }
    };
    wrapped.__voxPromptBuilderV2 = true;
    wrapped.__voxOriginal = original;
    w.openAiPreview = wrapped;
  }

  function install() {
    installWizardSteps();
    installWizardHydration();
    installExactPreview();
  }

  ready(function () {
    install();
    setTimeout(install, 250);
    setTimeout(install, 1200);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
