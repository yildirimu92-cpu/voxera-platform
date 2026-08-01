(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once:true });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const readinessCache = new Map();
  let readinessRequest = 0;

  function installFunctionRouting() {
    const original = w.callAdminFunction;
    if (typeof original !== 'function' || original.__voxLaunchP0Routing) return;
    const routed = function (name, payload) {
      const mapped = name === 'trigger-elevenlabs-sync'
        ? 'trigger-elevenlabs-sync-v2'
        : (name === 'scrape-website' ? 'scrape-website-v2' : name);
      return original.call(this, mapped, payload);
    };
    routed.__voxLaunchP0Routing = true;
    routed.__voxOriginal = original;
    w.callAdminFunction = routed;
  }

  function addScrapedField(data, key) {
    data._scrapedFields = Array.isArray(data._scrapedFields) ? data._scrapedFields : [];
    if (!data._scrapedFields.includes(key)) data._scrapedFields.push(key);
  }

  function setWebsiteFeedback(message, ok) {
    const feedback = document.getElementById('wz-scrape-feedback');
    const button = document.getElementById('wz-scrape-btn');
    if (feedback) {
      feedback.textContent = message;
      feedback.style.color = ok ? 'var(--green-dark,#059669)' : 'var(--red,#DC2626)';
      feedback.style.display = 'inline';
    }
    if (button) button.disabled = false;
  }

  const WEBSITE_TEMPLATE_FIELDS = Object.freeze([
    'businessDescription', 'services', 'locationHours', 'bookingFaq',
    'instructions', 'fallbackEscalation', 'responseConstraints'
  ]);

  const wizardText = value => String(value ?? '').trim();
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

  function canReplaceWizardValue(data, field, defaults, persistedValue) {
    if (wizardText(persistedValue)) return false;
    const current = wizardText(data[field]);
    if (hasOwn(data._scrapedValues, field)) {
      return current === wizardText(data._scrapedValues[field]);
    }
    const defaultValue = wizardText(defaults?.[field]);
    return !current || current === defaultValue;
  }

  function rememberScrapedValue(data, field, value) {
    data._scrapedFields = Array.isArray(data._scrapedFields) ? data._scrapedFields : [];
    data._scrapedValues = data._scrapedValues && typeof data._scrapedValues === 'object' ? data._scrapedValues : {};
    if (!data._scrapedFields.includes(field)) data._scrapedFields.push(field);
    data._scrapedValues[field] = value;
  }

  function rebaseWizardTemplate(data, previousDefaults, nextDefaults, config) {
    WEBSITE_TEMPLATE_FIELDS.forEach(field => {
      if (wizardText(config?.[field])) return;
      const current = wizardText(data[field]);
      if (hasOwn(data._scrapedValues, field) && current === wizardText(data._scrapedValues[field])) return;
      const previousValue = wizardText(previousDefaults?.[field]);
      if (!current || current === previousValue) data[field] = wizardText(nextDefaults?.[field]);
    });
  }

  function seedDynamicDefaults(data, defaults) {
    (defaults?.extraSteps || []).forEach(stepDef => {
      (stepDef.fields || []).forEach(field => {
        if (field.type === 'radio' && !data[field.key] && Array.isArray(field.options) && field.options[0]) {
          data[field.key] = field.options[0].val;
        } else if (field.type !== 'radio' && data[field.key] === undefined) {
          data[field.key] = '';
        }
      });
    });
  }

  function mergeWebsiteAnalysis(data, scraped, options) {
    const config = options?.config || {};
    const customer = options?.customer || {};
    const templateResolver = options?.templateResolver;
    const previousTemplateId = String(data.templateId || 'generic');
    const previousDefaults = typeof templateResolver === 'function' ? (templateResolver(previousTemplateId) || {}) : {};
    const applied = [];
    const preserved = [];

    const apply = (field, rawValue, persistedValue, defaults = previousDefaults) => {
      const value = wizardText(rawValue);
      if (!value) return;
      if (canReplaceWizardValue(data, field, defaults, persistedValue)) {
        data[field] = value;
        rememberScrapedValue(data, field, value);
        applied.push(field);
      } else {
        preserved.push(field);
      }
    };

    apply('businessDescription', scraped.short_description, config.businessDescription);
    apply('shortDescription', scraped.short_description, customer.ai_short_description, { shortDescription:'' });
    apply('services', scraped.services, config.services);
    if ((data.customerType || 'company') === 'company') {
      apply('locationHours', scraped.location_hours, config.locationHours);
    }

    const detectedTemplate = String(scraped.industry_guess || '').trim().toLowerCase();
    if (detectedTemplate && detectedTemplate !== 'generic' && detectedTemplate !== previousTemplateId) {
      const nextDefaults = typeof templateResolver === 'function' ? (templateResolver(detectedTemplate) || {}) : {};
      rebaseWizardTemplate(data, previousDefaults, nextDefaults, config);
      seedDynamicDefaults(data, nextDefaults);
      data.templateId = detectedTemplate;
      applied.push('templateId');
    }

    if (scraped.language && !wizardText(data.language)) {
      data.language = wizardText(scraped.language);
      applied.push('language');
    }
    if (scraped.company_name && !wizardText(data._customerDisplayName)) {
      data._customerDisplayName = wizardText(scraped.company_name);
      applied.push('_customerDisplayName');
    }

    return { applied:[...new Set(applied)], preserved:[...new Set(preserved)] };
  }

  function installWizardTemplateTransition() {
    const original = w.wizardNext;
    if (typeof original !== 'function' || original.__voxLaunchP0Template) return;

    const wrapped = async function () {
      const wizard = typeof state !== 'undefined' ? state.aiWizard : null;
      const step = wizard?.steps?.[wizard.step];
      if (wizard && step?.id === 'branche') {
        const previousTemplateId = String(wizard.data.templateId || 'generic');
        step.collect(wizard.data);
        const nextTemplateId = String(wizard.data.templateId || 'generic');
        if (nextTemplateId !== previousTemplateId) {
          const config = state.aiConfigs?.[wizard.customerId] || {};
          const previousDefaults = typeof getTemplateDefaults === 'function' ? (getTemplateDefaults(previousTemplateId) || {}) : {};
          const nextDefaults = typeof getTemplateDefaults === 'function' ? (getTemplateDefaults(nextTemplateId) || {}) : {};
          rebaseWizardTemplate(wizard.data, previousDefaults, nextDefaults, config);
          seedDynamicDefaults(wizard.data, nextDefaults);
          if (typeof getWizardSteps === 'function') {
            wizard.steps = getWizardSteps(nextTemplateId);
            const branchIndex = wizard.steps.findIndex(item => item.id === 'branche');
            if (branchIndex >= 0) wizard.step = branchIndex;
          }
        }
      }
      return original.apply(this, arguments);
    };
    wrapped.__voxLaunchP0Template = true;
    wrapped.__voxOriginal = original;
    w.wizardNext = wrapped;
  }

  function installWebsiteExtraction() {
    if (typeof w.wizardScrapeWebsite !== 'function' || w.wizardScrapeWebsite.__voxLaunchP0Website) return;

    const enhanced = async function () {
      installFunctionRouting();
      const input = document.getElementById('wz-website-url');
      const button = document.getElementById('wz-scrape-btn');
      const feedback = document.getElementById('wz-scrape-feedback');
      const rawUrl = String(input?.value || '').trim();

      if (!rawUrl) {
        setWebsiteFeedback('Bitte eine Website-Adresse eingeben.', false);
        return;
      }
      if (button) button.disabled = true;
      if (feedback) {
        feedback.style.color = 'var(--slate2)';
        feedback.textContent = 'Website wird gelesen und ausgewertet…';
      }

      try {
        const json = await w.callAdminFunction('scrape-website', { url:rawUrl });
        if (!json?.success || !json?.data) throw new Error(json?.error || 'Website-Auslesung fehlgeschlagen.');
        if (typeof state === 'undefined' || !state.aiWizard?.data) throw new Error('Wizard-Daten sind nicht verfügbar.');

        const wizard = state.aiWizard;
        const data = wizard.data;
        const scraped = json.data || {};
        const customer = typeof customerById === 'function' ? customerById(wizard.customerId) : null;
        const config = state.aiConfigs?.[wizard.customerId] || {};
        const merged = mergeWebsiteAnalysis(data, scraped, {
          customer,
          config,
          templateResolver: typeof getTemplateDefaults === 'function' ? getTemplateDefaults : null
        });

        data.websiteUrl = json.source_url || rawUrl;
        if (typeof getWizardSteps === 'function') wizard.steps = getWizardSteps(data.templateId || 'generic');
        if (typeof renderWizardModal === 'function') renderWizardModal();

        const preservedText = merged.preserved.length
          ? ' · ' + merged.preserved.length + ' manuelle/bestehende Angaben beibehalten'
          : '';
        const message = merged.applied.length > 0
          ? '✓ ' + merged.applied.length + ' Angaben übernommen' + preservedText + ' – bitte in den nächsten Schritten prüfen.'
          : '✓ Website gelesen. Bestehende Angaben wurden nicht überschrieben.';
        setWebsiteFeedback(message, true);
        const freshInput = document.getElementById('wz-website-url');
        if (freshInput) freshInput.value = data.websiteUrl;
      } catch (error) {
        const message = String(error?.message || 'Website konnte nicht ausgewertet werden.');
        setWebsiteFeedback(`${message} Manuelles Ausfüllen bleibt möglich.`, false);
      } finally {
        const currentButton = document.getElementById('wz-scrape-btn');
        if (currentButton) currentButton.disabled = false;
      }
    };

    enhanced.__voxLaunchP0Website = true;
    w.wizardScrapeWebsite = enhanced;
  }

  function currentGoLiveCustomerId() {
    if (typeof state === 'undefined') return '';
    return String(state.goLiveModal?.customerId || '');
  }

  function evidenceRows(readiness) {
    const evidence = readiness?.technical_gate?.evidence || {};
    const sync = evidence.sync || {};
    return [
      ['Stammdaten', evidence.master_data_complete],
      ['Offerte akzeptiert', evidence.accepted_offer_present],
      ['Vertrag startbereit', evidence.active_contract_present],
      ['Offerte mit Vertrag verknüpft', evidence.offer_contract_linked],
      ['Onboarding vorhanden', evidence.onboarding_present],
      ['Voxera-Rufnummer zugewiesen', evidence.voxera_number_assigned],
      ['ElevenLabs-Agent zugewiesen', evidence.elevenlabs_agent_assigned],
      ['ElevenLabs-Sync bestätigt', evidence.elevenlabs_sync_confirmed],
      ['AI-Konfiguration vollständig', evidence.ai_configuration_complete]
    ].map(([label, ok]) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--line2)"><span style="font-size:12px;color:var(--ink)">${esc(label)}</span><span class="badge ${ok?'badge-green':'badge-red'}">${ok?'Erfüllt':'Offen'}</span></div>`).join('') +
      `<div style="margin-top:9px;font-size:11px;color:var(--slate2)">Letzter Sync: ${esc(sync.latest_log_at ? new Date(sync.latest_log_at).toLocaleString('de-CH') : 'nicht dokumentiert')} · Agent-Abgleich: ${sync.agent_matches ? 'korrekt' : 'nicht bestätigt'}</div>`;
  }

  function enforceServerSubmitGate() {
    const button = document.getElementById('go-live-submit-btn');
    if (!button) return;
    if (button.dataset.voxServerBlocked === '1') {
      button.disabled = true;
      button.title = 'Serverseitige Launch-Voraussetzungen sind noch nicht erfüllt.';
    } else if (button.title === 'Serverseitige Launch-Voraussetzungen sind noch nicht erfüllt.') {
      button.title = '';
    }
  }

  function renderReadiness(readiness) {
    const summary = document.getElementById('go-live-gate-summary');
    const button = document.getElementById('go-live-submit-btn');
    if (!summary || !readiness) return;

    const gate = readiness.technical_gate || {};
    const blockers = Array.isArray(gate.hard_blockers) ? gate.hard_blockers : [];
    const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
    const blocked = !gate.allow;

    if (button) button.dataset.voxServerBlocked = blocked ? '1' : '0';
    summary.dataset.voxServerReadiness = '1';
    summary.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
        <div><div style="font-weight:800;color:${blocked?'var(--red)':'var(--green)'}">${blocked?'Launch noch blockiert':'Technische Launch-Voraussetzungen erfüllt'}</div><div style="font-size:11px;color:var(--slate2);margin-top:2px">Serverseitig aus den aktuellen Kunden-, Vertrags- und Sync-Daten geprüft.</div></div>
        <button type="button" class="btn btn-quiet btn-sm" id="vox-go-live-refresh">Neu prüfen</button>
      </div>
      <div style="display:grid;gap:0">${evidenceRows(readiness)}</div>
      ${blockers.length ? `<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:var(--red-light);border:1px solid var(--red-mid)"><strong style="font-size:12px;color:var(--red)">Blocker</strong><ul style="margin:6px 0 0 18px;padding:0">${blockers.map(item=>`<li style="font-size:12px;color:var(--red);margin:3px 0">${esc(item)}</li>`).join('')}</ul></div>` : ''}
      ${warnings.length ? `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--amber-light);border:1px solid var(--amber-mid)">${warnings.map(item=>`<div style="font-size:12px;color:var(--amber)">${esc(item)}</div>`).join('')}</div>` : ''}
      <div style="margin-top:10px;font-size:11px;color:var(--slate2)">Telefonie, Pflichtszenarien und Portal-Verantwortung bleiben bewusste manuelle Freigabeprüfungen. Ein Häkchen ersetzt keinen realen Testanruf.</div>`;

    document.getElementById('vox-go-live-refresh')?.addEventListener('click', () => loadReadiness(currentGoLiveCustomerId(), true));
    if (typeof w.updateGoLiveSubmitAvailability === 'function') w.updateGoLiveSubmitAvailability();
    enforceServerSubmitGate();
  }

  async function loadReadiness(customerId, force) {
    const id = String(customerId || '');
    const summary = document.getElementById('go-live-gate-summary');
    if (!id || !summary || !document.getElementById('go-live-modal')?.classList.contains('open')) return;

    const cached = readinessCache.get(id);
    if (!force && cached && Date.now() - cached.at < 15000) {
      renderReadiness(cached.value);
      return;
    }

    const requestId = ++readinessRequest;
    summary.innerHTML = '<div style="font-size:12px;color:var(--slate2)">Launch-Voraussetzungen werden serverseitig geprüft…</div>';
    try {
      installFunctionRouting();
      const result = await w.callAdminFunction('customer-go-live', { action:'check', customer_id:id });
      if (requestId !== readinessRequest || currentGoLiveCustomerId() !== id) return;
      if (!result?.success || !result?.technical_gate) throw new Error(result?.error || 'Launch-Prüfung fehlgeschlagen.');
      readinessCache.set(id, { at:Date.now(), value:result });
      renderReadiness(result);
    } catch (error) {
      if (requestId !== readinessRequest) return;
      const button = document.getElementById('go-live-submit-btn');
      if (button) button.dataset.voxServerBlocked = '1';
      summary.innerHTML = `<div style="color:var(--red);font-weight:700">Launch-Prüfung konnte nicht geladen werden.</div><div style="font-size:11px;color:var(--slate);margin-top:5px">${esc(error?.message || error)}</div><button type="button" class="btn btn-secondary btn-sm" id="vox-go-live-refresh" style="margin-top:10px">Erneut prüfen</button>`;
      document.getElementById('vox-go-live-refresh')?.addEventListener('click', () => loadReadiness(id, true));
      enforceServerSubmitGate();
    }
  }

  function installGoLiveReadiness() {
    const originalOpen = w.openCustomerGoLiveModal;
    if (typeof originalOpen === 'function' && !originalOpen.__voxServerReadiness) {
      const wrappedOpen = function () {
        const result = originalOpen.apply(this, arguments);
        const id = String(arguments[0] || currentGoLiveCustomerId());
        setTimeout(() => loadReadiness(id, true), 0);
        return result;
      };
      wrappedOpen.__voxServerReadiness = true;
      w.openCustomerGoLiveModal = wrappedOpen;
    }

    const originalRender = w.renderCustomerGoLiveModal;
    if (typeof originalRender === 'function' && !originalRender.__voxServerReadiness) {
      const wrappedRender = function () {
        const result = originalRender.apply(this, arguments);
        const id = currentGoLiveCustomerId();
        const cached = readinessCache.get(id);
        if (cached) setTimeout(() => renderReadiness(cached.value), 0);
        return result;
      };
      wrappedRender.__voxServerReadiness = true;
      w.renderCustomerGoLiveModal = wrappedRender;
    }

    const originalAvailability = w.updateGoLiveSubmitAvailability;
    if (typeof originalAvailability === 'function' && !originalAvailability.__voxServerReadiness) {
      const wrappedAvailability = function () {
        const result = originalAvailability.apply(this, arguments);
        enforceServerSubmitGate();
        return result;
      };
      wrappedAvailability.__voxServerReadiness = true;
      w.updateGoLiveSubmitAvailability = wrappedAvailability;
    }

    const originalSubmit = w.submitCustomerGoLive;
    if (typeof originalSubmit === 'function' && !originalSubmit.__voxServerReadiness) {
      const wrappedSubmit = async function () {
        const id = currentGoLiveCustomerId();
        const result = await originalSubmit.apply(this, arguments);
        readinessCache.delete(id);
        if (document.getElementById('go-live-modal')?.classList.contains('open')) {
          setTimeout(() => loadReadiness(id, true), 0);
        }
        return result;
      };
      wrappedSubmit.__voxServerReadiness = true;
      w.submitCustomerGoLive = wrappedSubmit;
    }
  }

  function install() {
    installFunctionRouting();
    installWizardTemplateTransition();
    installWebsiteExtraction();
    installGoLiveReadiness();
  }

  ready(() => {
    install();
    setTimeout(install, 250);
    setTimeout(install, 1200);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
