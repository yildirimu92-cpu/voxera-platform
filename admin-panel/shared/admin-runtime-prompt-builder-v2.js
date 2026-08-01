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
      <div class="wizard-intro-card">
        Wähle alle Funktionen, die der Assistent für diesen Kunden kombinieren darf. Die Website-Analyse liefert Vorschläge; verbindlich ist die Auswahl in diesem Schritt.
      </div>
      <section class="wizard-section-card">
        <div class="wizard-section-heading"><span>1</span><div><strong>Funktionen auswählen</strong><small>Mehrfachauswahl möglich</small></div></div>
        <div class="wizard-choice-grid">
          ${checkbox('information',data._promptFunctions,'Information & FAQ','Dokumentierte Fragen beantworten.')}
          ${checkbox('consulting',data._promptFunctions,'Beratung','Bedarf verstehen und Leistungen erklären.')}
          ${checkbox('lead',data._promptFunctions,'Lead qualifizieren','Interesse und Voraussetzungen klären.')}
          ${checkbox('appointment',data._promptFunctions,'Termine','Anfragen aufnehmen oder bestätigt buchen.')}
          ${checkbox('quote',data._promptFunctions,'Offertenanfrage','Anforderungen strukturiert erfassen.')}
          ${checkbox('callback',data._promptFunctions,'Rückruf','Kontaktdaten und Anliegen aufnehmen.')}
          ${checkbox('support',data._promptFunctions,'Support-Triage','Anliegen priorisieren und weiterleiten.')}
          ${checkbox('transfer',data._promptFunctions,'Weiterleiten','Gemäss Regeln an Menschen übergeben.')}
        </div>
        <div class="wizard-field wizard-field-spaced"><label>Spezifische Regeln für diese Funktionen</label>
          <textarea class="textarea" id="wz-prompt-function-instructions" style="min-height:100px" placeholder="Beispiel:\nBeratung: Plan anhand von Teamgrösse und Sprachen erklären.\nOfferte: Keine Preise zusagen; Beratungstermin anbieten.">${esc(data._promptFunctionInstructions)}</textarea>
        </div>
      </section>
      <section class="wizard-section-card">
        <div class="wizard-section-heading"><span>2</span><div><strong>Ziel und Pflichtangaben</strong><small>Was der Agent erfassen und erreichen soll</small></div></div>
        <div class="wizard-field"><label>Welche Angaben müssen erfasst werden?</label>
          <textarea class="textarea" id="wz-prompt-required" style="min-height:92px" placeholder="Eine Angabe pro Zeile">${esc(data._promptRequiredInformation)}</textarea>
        </div>
        <div class="wizard-field"><label>Wann gilt das Gespräch als erfolgreich?</label>
          <textarea class="textarea" id="wz-prompt-success" style="min-height:78px">${esc(data._promptSuccessDefinition)}</textarea>
        </div>
      </section>
      <section class="wizard-section-card">
        <div class="wizard-section-heading"><span>3</span><div><strong>Befugnisse festlegen</strong><small>Keine stillschweigenden Zusagen</small></div></div>
        <div class="wizard-decision-grid">
          <div class="wizard-decision-block"><label class="wizard-decision-label">Terminbefugnis</label><div class="wizard-radio-group">
            ${radio('wz-prompt-appointment','none',data._promptAppointmentMode,'Keine Termine','Nur informieren oder Rückruf anbieten.')}
            ${radio('wz-prompt-appointment','request',data._promptAppointmentMode,'Anfrage aufnehmen','Bestätigung durch das Unternehmen.')}
            ${radio('wz-prompt-appointment','direct',data._promptAppointmentMode,'Direkt buchen','Nur nach erfolgreicher Kalenderbestätigung.')}
          </div></div>
          <div class="wizard-decision-block"><label class="wizard-decision-label">Wenn eine Information fehlt</label><div class="wizard-radio-group">
            ${radio('wz-prompt-unknown','transparent',data._promptUnknownHandling,'Transparent bleiben','Offen sagen, dass die Information fehlt.')}
            ${radio('wz-prompt-unknown','callback',data._promptUnknownHandling,'Rückruf aufnehmen','Kontaktdaten und Anliegen erfassen.')}
            ${radio('wz-prompt-unknown','human',data._promptUnknownHandling,'An Menschen übergeben','Weiterleiten, sonst Rückruf aufnehmen.')}
          </div></div>
        </div>
      </section>`;
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

  function renderFinalReview(data) {
    const checks = preflight(data);
    const failed = checks.filter(item => !item[1]);
    const score = Math.round(((checks.length - failed.length) / checks.length) * 100);
    const functionLabels = {
      information:'Information & FAQ', consulting:'Beratung', lead:'Lead qualifizieren',
      appointment:'Termine', quote:'Offertenanfrage', callback:'Rückruf',
      support:'Support-Triage', transfer:'Weiterleiten'
    };
    const languageLabels = { de:'Deutsch', fr:'Französisch', it:'Italienisch', en:'Englisch' };
    const toneLabels = { formal:'Formal', professional:'Professionell', casual:'Locker' };
    const appointmentLabels = { none:'Keine Termine', request:'Terminanfrage', direct:'Direktbuchung mit Kalenderbestätigung' };
    const unknownLabels = { transparent:'Transparent bleiben', callback:'Rückruf aufnehmen', human:'An Menschen übergeben' };
    const functions = (Array.isArray(data._promptFunctions) ? data._promptFunctions : []).map(item => functionLabels[item] || item);
    const defaults = typeof getTemplateDefaults === 'function' ? (getTemplateDefaults(data.templateId || 'generic') || {}) : {};
    const voices = Array.isArray(data._availableVoices) ? data._availableVoices : [];
    const voice = voices.find(item => String(item.voice_id || '') === String(data.voiceId || ''));
    const customerId = typeof state !== 'undefined' ? state.aiWizard?.customerId : '';
    const customer = customerId && typeof customerById === 'function' ? customerById(customerId) : null;
    const syncMessage = customer?.elevenlabs_agent_id
      ? 'Die Konfiguration wird gespeichert und mit dem bestehenden ElevenLabs-Agent synchronisiert.'
      : 'Die Konfiguration wird gespeichert, der ElevenLabs-Agent erstellt und danach automatisch synchronisiert.';

    return `
      <div class="wizard-quality-hero ${failed.length ? 'warning' : 'ready'}">
        <div><span>Konfigurationsqualität</span><strong>${score}%</strong></div>
        <p>${failed.length ? failed.length + ' Pflichtbereich' + (failed.length === 1 ? '' : 'e') + ' benötigen noch Aufmerksamkeit.' : 'Alle erforderlichen Bereiche sind vollständig konfiguriert.'}</p>
      </div>
      ${failed.length ? `<div class="wizard-final-blockers"><strong>Vor dem Go-live prüfen</strong>${failed.map(item => `<div><span>!</span><p><b>${esc(item[0])}</b><small>${esc(item[2])}</small></p></div>`).join('')}</div>` : ''}
      <div class="wizard-review-grid">
        <section class="wizard-review-card">
          <span class="wizard-review-kicker">Assistent</span>
          <strong>${esc(data.assistantName || 'Lara')}</strong>
          <p>${esc(languageLabels[data.language] || data.language || 'Deutsch')} · ${esc(toneLabels[data.tone] || data.tone || 'Professionell')} · ${esc(voice?.display_name || 'Standardstimme')}</p>
        </section>
        <section class="wizard-review-card">
          <span class="wizard-review-kicker">Unternehmen</span>
          <strong>${esc(defaults.name || data.templateId || 'Allgemein')}</strong>
          <p>${data.businessDescription ? 'Geschäftsprofil und Angebot erfasst' : 'Geschäftsprofil noch offen'}</p>
        </section>
        <section class="wizard-review-card wizard-review-card-wide">
          <span class="wizard-review-kicker">Funktionen</span>
          <div class="wizard-review-chips">${functions.map(label => `<span>${esc(label)}</span>`).join('') || '<span>Keine Funktion gewählt</span>'}</div>
        </section>
        <section class="wizard-review-card">
          <span class="wizard-review-kicker">Terminbefugnis</span>
          <strong>${esc(appointmentLabels[data._promptAppointmentMode] || 'Terminanfrage')}</strong>
        </section>
        <section class="wizard-review-card">
          <span class="wizard-review-kicker">Fehlende Information</span>
          <strong>${esc(unknownLabels[data._promptUnknownHandling] || 'Rückruf aufnehmen')}</strong>
        </section>
      </div>
      <div class="wizard-sync-note"><span>↗</span><div><strong>Speichern & synchronisieren</strong><p>${esc(syncMessage)}</p></div></div>`;
  }

  function installWizardSteps() {
    const original = w.getWizardSteps;
    if (typeof original !== 'function' || original.__voxPromptBuilderV2) return;
    const wrapped = function () {
      let steps = original.apply(this, arguments);
      if (!Array.isArray(steps)) return steps;

      const profileIndex = steps.findIndex(step => step.id === 'profil');
      const personalityIndex = steps.findIndex(step => step.id === 'persoenlichkeit');
      if (profileIndex >= 0 && personalityIndex > profileIndex + 1) {
        const branchDetailSteps = steps.slice(profileIndex + 1, personalityIndex);
        const profileStep = steps[profileIndex];
        const profileRender = profileStep.render;
        const profileCollect = profileStep.collect;
        profileStep.render = data => profileRender(data) + branchDetailSteps.map(step =>
          '<section class="wizard-section-card wizard-branch-details"><div class="wizard-section-heading"><div><strong>' +
          esc(step.title || 'Branchenspezifische Angaben') + '</strong><small>' + esc(step.sub || '') +
          '</small></div></div>' + step.render(data) + '</section>'
        ).join('');
        profileStep.collect = data => {
          profileCollect(data);
          branchDetailSteps.forEach(step => step.collect(data));
        };
        steps.splice(profileIndex + 1, branchDetailSteps.length);
      }

      steps = steps.filter(step => step.id !== 'weiterleitungen');
      const names = {
        website:['Website analysieren','Website auslesen und Basisinformationen übernehmen'],
        branche:['Branche & Unternehmen','Passende Vorlage und betriebliche Einordnung'],
        identitaet:['Assistent & Stimme','Name, Kundentyp und Stimme festlegen'],
        profil:['Profil & Angebot','Unternehmen, Leistungen und Erreichbarkeit'],
        persoenlichkeit:['Gesprächsstil & Begrüssung','Anrede, Tonalität, Sprache und Begrüssung'],
        regeln:['Regeln & Grenzen','Gesprächsregeln, Eskalation und Compliance']
      };
      steps.forEach(step => {
        if (!names[step.id]) return;
        step.title = names[step.id][0];
        step.sub = names[step.id][1];
      });

      const currentProfileIndex = steps.findIndex(step => step.id === 'profil');
      const assignment = {
        id:'agent_auftrag',
        title:'Auftrag & Funktionen',
        sub:'Funktionen, Gesprächsziel und Befugnisse festlegen',
        render:renderAssignment,
        collect:collectAssignment
      };
      steps.splice(currentProfileIndex >= 0 ? currentProfileIndex + 1 : 0, 0, assignment);

      const summary = steps.find(step => step.id === 'zusammenfassung');
      if (summary) {
        summary.title = 'Prüfen & Agent erstellen';
        summary.sub = 'Konfiguration prüfen, speichern und synchronisieren';
        summary.render = renderFinalReview;
        summary.collect = persistProfileToConfig;
      }
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
