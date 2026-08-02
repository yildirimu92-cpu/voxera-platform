(function initVoxeraUnifiedCustomerNavigation(root) {
  'use strict';
  if (!root || !root.document || root.__vxUnifiedCustomerNavigationInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxUnifiedCustomerNavigationInstalled = true;

  const ROOT_NAV = [
    { key: 'dashboard', desktop: 'nav-dashboard', mobile: 'mnav-dashboard', label: 'Heute' },
    { key: 'anrufe', desktop: 'nav-anrufe', mobile: 'mnav-anrufe', label: 'Anfragen' },
    { key: 'assistent', desktop: 'nav-assistent', mobile: 'mnav-assistent', label: 'Assistent', icon: 'ph-robot' },
    { key: 'auswertung', desktop: 'nav-auswertung', mobile: 'mnav-auswertung', label: 'Bericht' },
    { key: 'mehr', desktop: 'nav-mehr', mobile: 'mnav-mehr', label: 'Einstellungen', icon: 'ph-gear' }
  ];

  const ASSISTANT_VIEWS = [
    { key: 'profile', pageId: 'mehr-sub-assistant-profile', entryId: 'vx-assistant-profile-entry', label: 'Assistent' },
    { key: 'business', pageId: 'mehr-sub-business-profile', entryId: 'vx-business-profile-entry', label: 'Geschäftsprofil' },
    { key: 'updates', pageId: 'mehr-sub-betriebsinfos', entryId: 'vx-operational-entry', label: 'Aktuelle Infos' }
  ];

  let bootAttempts = 0;
  let managedObserver = null;
  let settingsObserver = null;
  let stableRootKey = '';
  let initialAssistantLoadDone = false;

  function addStyles() {
    if (document.getElementById('vx-unified-customer-navigation-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-unified-customer-navigation-style';
    style.textContent = `
      #nav-assistent.nav-item,#mnav-assistent.mobile-nav-btn{display:flex!important}
      #nav-archiv,#mnav-archiv,[data-vx-hidden-root-nav="archive"]{display:none!important}
      .vx-unified-hidden-entry{display:none!important}
      #tab-assistent.vx-unified-assistant-root>:not(#vx-assistant-root-switch):not(#vx-assistant-root-host){display:none!important}
      #vx-assistant-root-host{display:block;min-width:0}
      #vx-assistant-root-host>[data-vx-assistant-managed-page]{display:none!important}
      #tab-assistent[data-vx-assistant-view="profile"] #mehr-sub-assistant-profile,
      #tab-assistent[data-vx-assistant-view="business"] #mehr-sub-business-profile,
      #tab-assistent[data-vx-assistant-view="updates"] #mehr-sub-betriebsinfos{display:block!important}
      #vx-assistant-root-host>[data-vx-assistant-managed-page]>.vx-page-header{display:none!important}
      #tab-assistent [data-vx-ap-back],#tab-assistent [data-ops-back]{display:none!important}
      .vx-assistant-root-switch{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:0 0 14px;margin-bottom:14px;border-bottom:.5px solid var(--line,#e4e8f0)}
      .vx-assistant-root-switch::-webkit-scrollbar{display:none}
      .vx-assistant-root-switch button{flex:0 0 auto;border:0;border-radius:10px;background:#f1f5f9;color:#64748b;padding:10px 14px;min-height:40px;font:650 12px inherit;cursor:pointer;white-space:nowrap}
      .vx-assistant-root-switch button.active{background:#0d1f3c;color:#fff}
      .nav-item.vx-root-nav-active{background:#3478ed!important;color:#fff!important}
      .nav-item.vx-root-nav-active i,.nav-item.vx-root-nav-active .nav-icon{color:#fff!important}
      .mobile-nav-btn.vx-root-nav-active{color:#1a6fe8!important}
      .mobile-nav-btn.vx-root-nav-active .mobile-nav-icon-wrap{color:#1a6fe8!important;background:#eef4ff!important}
      .vx-nav-voice-details,.vx-nav-status-details{margin-top:12px;border-top:.5px solid var(--line,#e4e8f0);padding-top:10px}
      .vx-nav-voice-details>summary,.vx-nav-status-details>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;color:#1a6fe8;font-size:12px;font-weight:700;padding:4px 0}
      .vx-nav-voice-details>summary::-webkit-details-marker,.vx-nav-status-details>summary::-webkit-details-marker{display:none}
      .vx-nav-voice-details>summary:after,.vx-nav-status-details>summary:after{content:'+';font-size:17px;font-weight:500;color:#64748b}
      .vx-nav-voice-details[open]>summary:after,.vx-nav-status-details[open]>summary:after{content:'–'}
      .vx-nav-status-summary{margin-top:12px;padding:11px 12px;border-radius:11px;background:#ecfdf5;color:#047857;font-size:12px;line-height:1.45}
      .vx-nav-status-summary.attention{background:#fff7ed;color:#9a3412}.vx-nav-status-summary.error{background:#fef2f2;color:#b91c1c}
      .vx-as-capabilities-simple:not(.is-expanded) .vx-as-extra-capability{display:none!important}
      .vx-as-capability-toggle{margin-top:10px;border:0;background:#f1f5f9;color:#475569;border-radius:9px;padding:8px 11px;font:650 11px inherit;cursor:pointer}
      @media(max-width:720px){
        #vx-assistant-root-host>[data-vx-assistant-managed-page]{padding-bottom:calc(86px + env(safe-area-inset-bottom,0px))}
        .vx-assistant-root-switch{position:sticky;top:0;z-index:8;background:var(--surface,#fff);padding-top:4px;margin-bottom:12px}
        .vx-assistant-root-switch button{min-height:42px}
      }
    `;
    document.head.appendChild(style);
  }

  function textLabel(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function setLabel(node, label) {
    if (!node) return;
    const textNodes = Array.from(node.childNodes).filter((child) => (
      child.nodeType === 3 && String(child.nodeValue || '').trim()
    ));
    if (textNodes.length) {
      const target = textNodes[textNodes.length - 1];
      if (String(target.nodeValue || '').trim() !== label) target.nodeValue = `\n        ${label}\n      `;
      return;
    }
    let labelNode = node.querySelector('.vx-root-nav-label');
    if (!labelNode) {
      labelNode = document.createElement('span');
      labelNode.className = 'vx-root-nav-label';
      node.appendChild(labelNode);
    }
    if (labelNode.textContent !== label) labelNode.textContent = label;
  }

  function setIcon(node, iconName) {
    if (!node || !iconName) return;
    const icon = node.querySelector('i');
    if (!icon) return;
    Array.from(icon.classList).forEach((name) => {
      if (name.startsWith('ph-') && !['ph-light', 'ph-bold', 'ph-fill'].includes(name) && name !== iconName) {
        icon.classList.remove(name);
      }
    });
    if (!icon.classList.contains(iconName)) icon.classList.add(iconName);
  }

  function canonicalRootKey(node) {
    if (!node) return '';
    const byId = ROOT_NAV.find((item) => item.desktop === node.id || item.mobile === node.id);
    if (byId) return byId.key;
    const onclick = String(node.getAttribute('onclick') || '');
    const match = onclick.match(/showTab\(['"]([^'"]+)/);
    if (match && ROOT_NAV.some((item) => item.key === match[1])) return match[1];
    const label = textLabel(node);
    return ROOT_NAV.find((item) => item.label === label)?.key || '';
  }

  function hideArchiveRootNavigation() {
    const candidates = [
      document.getElementById('nav-archiv'),
      document.getElementById('mnav-archiv'),
      ...Array.from(document.querySelectorAll('.nav-item,.mobile-nav-btn')).filter((node) => {
        const label = textLabel(node);
        const onclick = String(node.getAttribute('onclick') || '');
        return label === 'Archiv' || /showTab\(['"]archiv/.test(onclick);
      })
    ].filter(Boolean);

    candidates.forEach((node) => {
      node.dataset.vxHiddenRootNav = 'archive';
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('tabindex', '-1');
    });
  }

  function normalizeRootNavigation() {
    ROOT_NAV.forEach((item) => {
      const desktop = document.getElementById(item.desktop);
      const mobile = document.getElementById(item.mobile);
      if (item.key === 'assistent') {
        [desktop, mobile].filter(Boolean).forEach((node) => {
          node.hidden = false;
          node.removeAttribute('aria-hidden');
          node.style.removeProperty('display');
        });
      }
      setLabel(desktop, item.label);
      setLabel(mobile, item.label);
      setIcon(desktop, item.icon);
      setIcon(mobile, item.icon);
      [desktop, mobile].filter(Boolean).forEach((node) => {
        node.dataset.vxRootTab = item.key;
        node.setAttribute('aria-label', item.label);
      });
    });

    hideArchiveRootNavigation();
    orderDesktopNavigation();
    dedupeAndOrderMobileNavigation();
  }

  function orderDesktopNavigation() {
    const assistant = document.getElementById('nav-assistent');
    const report = document.getElementById('nav-auswertung');
    if (
      assistant && report &&
      assistant.parentElement === report.parentElement &&
      assistant.nextElementSibling !== report
    ) {
      report.parentElement.insertBefore(assistant, report);
    }
  }

  function dedupeAndOrderMobileNavigation() {
    const canonicalNodes = ROOT_NAV.map((item) => document.getElementById(item.mobile)).filter(Boolean);
    const container = canonicalNodes[0]?.parentElement;
    if (!container) return;

    const canonicalIds = new Set(ROOT_NAV.map((item) => item.mobile));
    const seenKeys = new Set();
    Array.from(container.querySelectorAll('.mobile-nav-btn')).forEach((node) => {
      const key = canonicalRootKey(node);
      if (!key) return;
      if (canonicalIds.has(node.id) && !seenKeys.has(key)) {
        seenKeys.add(key);
        node.classList.remove('vx-unified-hidden-entry');
        node.removeAttribute('aria-hidden');
        return;
      }
      node.classList.add('vx-unified-hidden-entry');
      node.setAttribute('aria-hidden', 'true');
      node.dataset.vxDuplicateRootNav = '1';
    });

    const currentOrder = Array.from(container.children)
      .filter((node) => canonicalIds.has(node.id))
      .map((node) => node.id);
    const desiredOrder = ROOT_NAV.map((item) => item.mobile).filter((id) => document.getElementById(id));
    if (currentOrder.join('|') === desiredOrder.join('|')) return;

    const fragment = document.createDocumentFragment();
    desiredOrder.forEach((id) => {
      const node = document.getElementById(id);
      if (node) fragment.appendChild(node);
    });
    container.appendChild(fragment);
  }

  function ensureAssistantShell() {
    const assistantTab = document.getElementById('tab-assistent');
    if (!assistantTab) return null;
    assistantTab.classList.add('vx-unified-assistant-root');

    let switcher = document.getElementById('vx-assistant-root-switch');
    if (!switcher) {
      switcher = document.createElement('div');
      switcher.id = 'vx-assistant-root-switch';
      switcher.className = 'vx-assistant-root-switch';
      switcher.setAttribute('role', 'tablist');
      switcher.setAttribute('aria-label', 'Assistentenbereich');
      switcher.innerHTML = ASSISTANT_VIEWS.map((view) => (
        `<button type="button" data-vx-assistant-view="${view.key}" role="tab">${view.label}</button>`
      )).join('');
      switcher.addEventListener('click', (event) => {
        const button = event.target.closest('[data-vx-assistant-view]');
        if (!button) return;
        showAssistantView(button.dataset.vxAssistantView, true);
      });
    }

    let host = document.getElementById('vx-assistant-root-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'vx-assistant-root-host';
    }

    if (switcher.parentElement !== assistantTab) assistantTab.insertBefore(switcher, assistantTab.firstChild);
    if (host.parentElement !== assistantTab) assistantTab.insertBefore(host, switcher.nextSibling);
    return { assistantTab, switcher, host };
  }

  function hideSettingsEntry(entry) {
    if (!entry) return;
    entry.classList.add('vx-unified-hidden-entry');
    entry.setAttribute('aria-hidden', 'true');
    entry.setAttribute('tabindex', '-1');
  }

  function settingsList() {
    const main = document.getElementById('mehr-main');
    return main?.querySelector('.vx-page-header')?.nextElementSibling || null;
  }

  function findSettingsEntryByTitle(title) {
    const list = settingsList();
    if (!list) return null;
    return Array.from(list.children).find((entry) => {
      const directText = Array.from(entry.querySelectorAll('div'))
        .filter((node) => node.children.length === 0)
        .map((node) => textLabel(node));
      return directText.includes(title);
    }) || null;
  }

  function cleanupSettingsEntries() {
    ASSISTANT_VIEWS.forEach((view) => hideSettingsEntry(document.getElementById(view.entryId)));
    hideSettingsEntry(findSettingsEntryByTitle('Bericht'));

    Array.from(document.querySelectorAll('#tab-mehr button')).forEach((button) => {
      if (textLabel(button) === 'Zum Assistent-Bereich') hideSettingsEntry(button);
    });

    const heading = document.getElementById('vx-assistant-business-section');
    if (heading && textLabel(heading) !== 'Verbindungen') heading.textContent = 'Verbindungen';
  }

  function mountManagedPages() {
    const shell = ensureAssistantShell();
    if (!shell) return false;

    let complete = true;
    ASSISTANT_VIEWS.forEach((view) => {
      const page = document.getElementById(view.pageId);
      if (!page) {
        complete = false;
        return;
      }
      page.dataset.vxAssistantManagedPage = view.key;
      if (page.parentElement !== shell.host) shell.host.appendChild(page);
      page.querySelector('[data-vx-ap-back],[data-ops-back]')?.setAttribute('aria-hidden', 'true');
    });

    cleanupSettingsEntries();
    const selected = shell.assistantTab.dataset.vxAssistantView || 'profile';
    applyAssistantView(selected);
    return complete;
  }

  function triggerViewLoad(view) {
    const config = ASSISTANT_VIEWS.find((item) => item.key === view);
    if (!config) return;

    if (view === 'updates') {
      if (typeof root.vxOperationalUpdatesOpen === 'function') root.vxOperationalUpdatesOpen();
      return;
    }

    const entry = document.getElementById(config.entryId);
    if (entry && typeof entry.click === 'function') entry.click();
  }

  function applyAssistantView(view) {
    const shell = ensureAssistantShell();
    if (!shell) return;
    const selected = ASSISTANT_VIEWS.some((item) => item.key === view) ? view : 'profile';
    shell.assistantTab.dataset.vxAssistantView = selected;

    ASSISTANT_VIEWS.forEach((item) => {
      const page = document.getElementById(item.pageId);
      if (page) page.style.display = item.key === selected ? 'block' : 'none';
    });

    shell.switcher.querySelectorAll('[data-vx-assistant-view]').forEach((button) => {
      const active = button.dataset.vxAssistantView === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('tabindex', active ? '0' : '-1');
    });
  }

  function showAssistantView(view, shouldLoad) {
    const selected = ASSISTANT_VIEWS.some((item) => item.key === view) ? view : 'profile';
    if (shouldLoad) triggerViewLoad(selected);
    mountManagedPages();
    applyAssistantView(selected);
    root.requestAnimationFrame?.(() => {
      mountManagedPages();
      applyAssistantView(selected);
    });
  }

  function restoreSettingsRoot() {
    const main = document.getElementById('mehr-main');
    if (main) main.style.display = '';
    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => {
      node.style.display = 'none';
    });
    cleanupSettingsEntries();
  }

  function simplifyVoiceSelection() {
    const body = document.getElementById('vx-assistant-profile-body');
    if (!body) return;
    const voiceCard = Array.from(body.querySelectorAll('.vx-ap-card')).find((card) => (
      textLabel(card.querySelector('.vx-ap-title')) === 'Stimme'
    ));
    if (!voiceCard || voiceCard.querySelector('.vx-nav-voice-details')) return;
    const filters = voiceCard.querySelector('.vx-ap-filters');
    const voices = voiceCard.querySelector('.vx-ap-voices');
    if (!filters || !voices) return;

    const details = document.createElement('details');
    details.className = 'vx-nav-voice-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Andere Stimme wählen';
    details.appendChild(summary);
    details.appendChild(filters);
    details.appendChild(voices);
    voiceCard.appendChild(details);
  }

  function simplifyCapabilities() {
    const card = document.getElementById('vx-assistant-capabilities-card');
    if (!card) return;
    card.classList.add('vx-as-capabilities-simple');
    const title = card.querySelector('.vx-ap-title');
    const meta = card.querySelector('.vx-ap-meta');
    if (title && textLabel(title) !== 'Fähigkeiten') title.textContent = 'Fähigkeiten';
    if (meta) meta.textContent = 'Die wichtigsten Aufgaben, die Ihr Assistent aktuell übernimmt.';

    const capabilities = Array.from(card.querySelectorAll('.vx-as-cap'));
    capabilities.forEach((item, index) => item.classList.toggle('vx-as-extra-capability', index >= 4));
    if (capabilities.length <= 4 || card.querySelector('.vx-as-capability-toggle')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vx-as-capability-toggle';
    button.setAttribute('aria-expanded', 'false');
    button.textContent = `${capabilities.length - 4} weitere Fähigkeiten anzeigen`;
    button.addEventListener('click', () => {
      const expanded = card.classList.toggle('is-expanded');
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.textContent = expanded ? 'Weniger anzeigen' : `${capabilities.length - 4} weitere Fähigkeiten anzeigen`;
    });
    card.appendChild(button);
  }

  function simplifyTechnicalStatus() {
    const card = document.getElementById('vx-assistant-status-extension');
    if (!card || card.querySelector('.vx-nav-status-details')) return;
    const head = card.querySelector('.vx-ap-head');
    if (!head) return;

    const title = head.querySelector('.vx-ap-title');
    const meta = head.querySelector('.vx-ap-meta');
    if (title) title.textContent = 'Betriebsstatus';
    if (meta) meta.textContent = 'Nur Abweichungen werden hervorgehoben. Technische Details bleiben optional.';

    const hasError = Boolean(card.querySelector('.vx-as-state.error'));
    const hasAttention = Boolean(card.querySelector('.vx-as-state.attention'));
    const summaryBox = document.createElement('div');
    summaryBox.className = 'vx-nav-status-summary' + (hasError ? ' error' : hasAttention ? ' attention' : '');
    summaryBox.textContent = hasError
      ? 'Mindestens eine Verbindung ist aktuell nicht betriebsbereit.'
      : hasAttention
        ? 'Mindestens eine Einrichtung benötigt noch Ihre Aufmerksamkeit.'
        : 'Die wichtigsten Verbindungen sind betriebsbereit.';

    const details = document.createElement('details');
    details.className = 'vx-nav-status-details';
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = 'Technische Details';
    details.appendChild(detailsSummary);
    Array.from(card.children).filter((child) => child !== head).forEach((child) => details.appendChild(child));
    card.appendChild(summaryBox);
    card.appendChild(details);
  }

  function setStableRootActive(key) {
    if (!ROOT_NAV.some((item) => item.key === key)) return;
    stableRootKey = key;
    ROOT_NAV.forEach((item) => {
      [document.getElementById(item.desktop), document.getElementById(item.mobile)]
        .filter(Boolean)
        .forEach((node) => {
          const active = item.key === key;
          node.classList.toggle('vx-root-nav-active', active);
          if (active) node.setAttribute('aria-current', 'page');
          else node.removeAttribute('aria-current');
        });
    });
  }

  function initialRootKey() {
    const active = ROOT_NAV.find((item) => (
      document.getElementById(item.desktop)?.classList.contains('active') ||
      document.getElementById(item.mobile)?.classList.contains('active')
    ));
    if (active) return active.key;

    const query = new URLSearchParams(root.location?.search || '');
    const raw = String(query.get('tab') || '').toLowerCase();
    const aliases = { today: 'dashboard', requests: 'anrufe', assistant: 'assistent', report: 'auswertung', more: 'mehr' };
    return ROOT_NAV.some((item) => item.key === raw) ? raw : aliases[raw] || 'dashboard';
  }

  function installShowTabBridge() {
    if (root.__vxUnifiedShowTabWrapped) return true;
    if (typeof root.showTab !== 'function') return false;
    const original = root.showTab;
    root.showTab = function unifiedShowTab(tabName) {
      const key = ROOT_NAV.some((item) => item.key === tabName) ? tabName : '';
      if (key) setStableRootActive(key);
      const result = original.apply(this, arguments);
      if (key === 'assistent') root.setTimeout(() => showAssistantView('profile', true), 0);
      if (key === 'mehr') root.setTimeout(restoreSettingsRoot, 0);
      if (key) root.requestAnimationFrame?.(() => setStableRootActive(key));
      return result;
    };
    root.__vxUnifiedShowTabWrapped = true;
    return true;
  }

  function applyManagedEnhancements() {
    mountManagedPages();
    simplifyVoiceSelection();
    simplifyCapabilities();
    simplifyTechnicalStatus();
    cleanupSettingsEntries();
  }

  function installObservers() {
    if (!managedObserver) {
      managedObserver = new MutationObserver(() => {
        root.requestAnimationFrame?.(applyManagedEnhancements);
      });
      managedObserver.observe(document.body, { childList: true, subtree: true });
    }

    const settings = document.getElementById('tab-mehr');
    if (settings && !settingsObserver) {
      settingsObserver = new MutationObserver(() => {
        cleanupSettingsEntries();
        mountManagedPages();
      });
      settingsObserver.observe(settings, { childList: true, subtree: true });
    }
  }

  function boot() {
    addStyles();
    normalizeRootNavigation();
    installShowTabBridge();
    applyManagedEnhancements();
    if (!stableRootKey) setStableRootActive(initialRootKey());

    bootAttempts += 1;
    const complete = ASSISTANT_VIEWS.every((view) => document.getElementById(view.pageId));
    if (complete && stableRootKey === 'assistent' && !initialAssistantLoadDone) {
      initialAssistantLoadDone = true;
      showAssistantView('profile', true);
    }
    if (!complete && bootAttempts < 80) {
      root.setTimeout(boot, 250);
      return;
    }
    installObservers();
  }

  function install() {
    document.addEventListener('click', (event) => {
      const rootButton = event.target?.closest?.('[data-vx-root-tab]');
      if (rootButton) {
        const key = rootButton.dataset.vxRootTab;
        if (key) setStableRootActive(key);
      }
    }, true);

    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : this);
