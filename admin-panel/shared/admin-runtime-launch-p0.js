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

        const data = state.aiWizard.data;
        const scraped = json.data || {};
        let count = 0;

        if (scraped.short_description && !data.businessDescription) {
          data.shortDescription = scraped.short_description;
          data.businessDescription = scraped.short_description;
          addScrapedField(data, 'businessDescription');
          count += 1;
        }
        if (scraped.services && !data.services) {
          data.services = scraped.services;
          addScrapedField(data, 'services');
          count += 1;
        }
        if (scraped.location_hours && !data.locationHours && (data.customerType || 'company') === 'company') {
          data.locationHours = scraped.location_hours;
          addScrapedField(data, 'locationHours');
          count += 1;
        }
        if (scraped.language && !data.language) {
          data.language = scraped.language;
          count += 1;
        }
        if (scraped.industry_guess && scraped.industry_guess !== 'generic') {
          data.templateId = scraped.industry_guess;
          count += 1;
        }
        if (scraped.company_name && !data._customerDisplayName) {
          data._customerDisplayName = scraped.company_name;
          count += 1;
        }

        data.websiteUrl = json.source_url || rawUrl;
        if (typeof getWizardSteps === 'function') state.aiWizard.steps = getWizardSteps(data.templateId || 'generic');
        if (typeof renderWizardModal === 'function') renderWizardModal();

        const message = count > 0
          ? `✓ ${count} Angaben übernommen – bitte in den nächsten Schritten prüfen.`
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
    installWebsiteExtraction();
    installGoLiveReadiness();
  }

  ready(() => {
    install();
    setTimeout(install, 250);
    setTimeout(install, 1200);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
