(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once:true });

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

  function install() {
    installFunctionRouting();
    installWebsiteExtraction();
  }

  ready(() => {
    install();
    setTimeout(install, 250);
    setTimeout(install, 1200);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
