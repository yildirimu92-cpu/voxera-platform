(function initVoxeraAssistantBusinessMenu(root) {
  'use strict';
  if (!root || !root.document || root.__vxAssistantBusinessMenuInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxAssistantBusinessMenuInstalled = true;

  let attempts = 0;

  function listContainer() {
    const main = document.getElementById('mehr-main');
    return main?.querySelector('.vx-page-header')?.nextElementSibling || null;
  }

  function normalizeVisibleCopy(container) {
    if (!container || typeof document.createTreeWalker !== 'function') return;
    const replacements = [
      ['Aktuelle Betriebsinfos', 'Aktuelle Änderungen'],
      ['Betriebsinfos werden geladen', 'Aktuelle Änderungen werden geladen'],
      ['Betriebsinfos konnten nicht geladen werden', 'Aktuelle Änderungen konnten nicht geladen werden'],
      ['Noch keine Betriebsinfo erfasst', 'Noch keine aktuelle Änderung erfasst'],
      ['Betriebsinfo bearbeiten', 'Aktuelle Änderung bearbeiten'],
      ['Neue Betriebsinfo', 'Neue aktuelle Änderung'],
      ['Betriebsinfo zuerst erwähnen', 'Aktuelle Änderung zuerst erwähnen'],
      ['auf die Betriebsinfo hinweisen', 'auf die aktuelle Änderung hinweisen']
    ];
    const walker = document.createTreeWalker(container, 4);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      let value = String(node.nodeValue || '');
      replacements.forEach(([before, after]) => { value = value.replaceAll(before, after); });
      if (value !== node.nodeValue) node.nodeValue = value;
    });
  }

  function observeVisibleCopy(container) {
    if (!container || container.dataset.vxAssistantCopyObserved || typeof MutationObserver !== 'function') return;
    container.dataset.vxAssistantCopyObserved = '1';
    const observer = new MutationObserver(() => normalizeVisibleCopy(container));
    observer.observe(container, { childList: true, characterData: true, subtree: true });
  }

  function normalizeOperationalLabels() {
    const entry = document.getElementById('vx-operational-entry');
    if (entry) {
      const title = Array.from(entry.querySelectorAll('div')).find((node) => (
        node.children.length === 0 && String(node.textContent || '').trim() === 'Aktuelle Betriebsinfos'
      ));
      if (title) title.textContent = 'Aktuelle Änderungen';

      const subtitle = document.getElementById('vx-operational-entry-sub');
      if (subtitle) {
        const applySubtitle = () => {
          const value = String(subtitle.textContent || '').trim();
          if (value === 'Ferien, Abwesenheiten und Sonderzeiten') {
            subtitle.textContent = 'Ferien, Sonderzeiten und vorübergehende Hinweise';
          }
        };
        applySubtitle();
        if (!subtitle.dataset.vxAssistantMenuObserved && typeof MutationObserver === 'function') {
          subtitle.dataset.vxAssistantMenuObserved = '1';
          const observer = new MutationObserver(applySubtitle);
          observer.observe(subtitle, { childList: true, characterData: true, subtree: true });
        }
      }
    }

    const page = document.getElementById('mehr-sub-betriebsinfos');
    if (page) {
      const title = page.querySelector('.vx-page-header-title');
      const subtitle = page.querySelector('.vx-page-header-title + div');
      if (title) title.textContent = 'Aktuelle Änderungen';
      if (subtitle) subtitle.textContent = 'Zeitlich begrenzte Abweichungen vom Geschäftsprofil.';
      normalizeVisibleCopy(page);
      observeVisibleCopy(page);
    }

    const businessBody = document.getElementById('vx-business-profile-body');
    if (businessBody) {
      normalizeVisibleCopy(businessBody);
      observeVisibleCopy(businessBody);
    }
  }

  function ensureSectionHeading(list) {
    let heading = document.getElementById('vx-assistant-business-section');
    if (heading) return heading;

    heading = document.createElement('div');
    heading.id = 'vx-assistant-business-section';
    heading.textContent = 'Assistent & Geschäft';
    heading.setAttribute('role', 'heading');
    heading.setAttribute('aria-level', '2');
    heading.style.cssText = [
      'padding:18px 16px 8px',
      'font-size:10px',
      'font-weight:750',
      'letter-spacing:.08em',
      'text-transform:uppercase',
      'color:var(--slate2,#7a8599)',
      'background:var(--surface,#fff)'
    ].join(';');
    list.appendChild(heading);
    return heading;
  }

  function arrangeMenu() {
    const list = listContainer();
    if (!list) return false;

    const assistant = document.getElementById('vx-assistant-profile-entry');
    const business = document.getElementById('vx-business-profile-entry');
    const operational = document.getElementById('vx-operational-entry');
    if (!assistant || !business) return false;

    normalizeOperationalLabels();
    const heading = ensureSectionHeading(list);
    const calendar = document.getElementById('vx-calendar-settings-entry');
    const help = Array.from(list.children).find((child) => /Hilfe/.test(child.textContent || ''));
    const anchor = calendar || help || null;

    list.insertBefore(heading, anchor);
    [assistant, business, operational].filter(Boolean).forEach((menuEntry) => {
      list.insertBefore(menuEntry, anchor);
    });

    return Boolean(operational);
  }

  function boot() {
    const complete = arrangeMenu();
    attempts += 1;
    if (!complete && attempts < 80) root.setTimeout(boot, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function loadVoxeraAssistantStatus(root) {
  'use strict';
  if (!root || !root.document || root.__vxAssistantStatusLoaderInstalled) return;
  root.__vxAssistantStatusLoaderInstalled = true;
  const script = root.document.createElement('script');
  script.src = '/shared/customer-runtime-assistant-status.js?v=20260802-1';
  script.async = false;
  root.document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function loadVoxeraVoicePreviewFallback(root) {
  'use strict';
  if (!root || !root.document || root.__vxVoicePreviewFallbackLoaderInstalled) return;
  root.__vxVoicePreviewFallbackLoaderInstalled = true;
  const script = root.document.createElement('script');
  script.src = '/shared/customer-runtime-voice-preview-fallback.js?v=20260802-1';
  script.async = false;
  root.document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function loadVoxeraCustomerHelpRoute(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerHelpRouteLoaderInstalled) return;
  root.__vxCustomerHelpRouteLoaderInstalled = true;
  const script = root.document.createElement('script');
  script.src = '/shared/customer-runtime-help-route.js?v=20260802-1';
  script.async = false;
  root.document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);
