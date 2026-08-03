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
    { key: 'profile', pageId: 'mehr-sub-assistant-profile', label: 'Assistent' },
    { key: 'business', pageId: 'mehr-sub-business-profile', label: 'Geschäftsprofil' },
    { key: 'updates', pageId: 'mehr-sub-betriebsinfos', label: 'Aktuelle Infos' }
  ];

  let bootAttempts = 0;
  let assistantObserver = null;
  let stableRootKey = '';
  let initialAssistantLoadDone = false;
  let voiceSelectionExpanded = false;

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
      if (String(target.nodeValue || '').trim() !== label) target.nodeValue = `
        ${label}
      `;
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



  // Delete stale archive root buttons that may survive in cached or injected legacy markup.
  function hideArchiveRootNavigation() {
    [
      document.getElementById('nav-archiv'),
      document.getElementById('mnav-archiv')
    ].filter(Boolean).forEach((node) => node.remove());
  }

  function normalizeRootNavigation() {
    hideArchiveRootNavigation();
    ROOT_NAV.forEach((item) => {
      const desktop = document.getElementById(item.desktop);
      const mobile = document.getElementById(item.mobile);
      [desktop, mobile].filter(Boolean).forEach((node) => {
        node.hidden = false;
        node.removeAttribute('aria-hidden');
        node.removeAttribute('tabindex');
        node.style.removeProperty('display');
      });
      setLabel(desktop, item.label);
      setLabel(mobile, item.label);
      setIcon(desktop, item.icon);
      setIcon(mobile, item.icon);
      [desktop, mobile].filter(Boolean).forEach((node) => {
        node.dataset.vxRootTab = item.key;
        node.setAttribute('aria-label', item.label);
      });
    });

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
        node.hidden = false;
        node.removeAttribute('aria-hidden');
        return;
      }
      node.hidden = true;
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
    });

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

    root.vxAssistantProfileOpen?.(view);
  }

  function applyAssistantView(view) {
    const shell = ensureAssistantShell();
    if (!shell) return;
    const selected = ASSISTANT_VIEWS.some((item) => item.key === view) ? view : 'profile';
    shell.assistantTab.dataset.vxAssistantView = selected;

    ASSISTANT_VIEWS.forEach((item) => {
      const page = document.getElementById(item.pageId);
      if (!page) return;
      const active = item.key === selected;
      page.hidden = !active;
      page.style.display = active ? 'block' : 'none';
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
    mountManagedPages();
    applyAssistantView(selected);
    if (shouldLoad) triggerViewLoad(selected);
  }

  function restoreSettingsRoot() {
    const main = document.getElementById('mehr-main');
    if (main) {
      main.hidden = false;
      main.style.display = '';
    }
    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => {
      node.hidden = true;
      node.style.display = 'none';
    });
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
    details.open = voiceSelectionExpanded;
    details.addEventListener('toggle', () => {
      voiceSelectionExpanded = details.open;
    });
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
    const title = card.querySelector('.vx-ap-title');
    const meta = card.querySelector('.vx-ap-meta');
    if (title && textLabel(title) !== 'Fähigkeiten') title.textContent = 'Fähigkeiten';
    if (meta) meta.textContent = 'Die wichtigsten Aufgaben, die Ihr Assistent aktuell übernimmt.';
    card.classList.remove('vx-as-capabilities-simple', 'is-expanded');
    card.querySelectorAll('.vx-as-cap').forEach((item) => item.classList.remove('vx-as-extra-capability'));
    card.querySelector('.vx-as-capability-toggle')?.remove();
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
    const queryTab = String(query.get('tab') || '').toLowerCase();
    const hashTab = String(root.location?.hash || '').replace(/^#(?:tab-)?/, '').toLowerCase();
    const raw = queryTab || hashTab;
    const aliases = {
      today: 'dashboard',
      requests: 'anrufe',
      assistant: 'assistent',
      report: 'auswertung',
      more: 'mehr',
      archiv: 'anrufe',
      archive: 'anrufe'
    };
    return ROOT_NAV.some((item) => item.key === raw) ? raw : aliases[raw] || 'dashboard';
  }

  function showArchiveInsideRequests() {
    const button = document.querySelector('#tab-anrufe [data-filter="archiv"]');
    if (!button) return;
    if (typeof root.anrufeChipFilter === 'function') {
      root.anrufeChipFilter('archiv', button);
      return;
    }
    button.click();
  }

  function installShowTabBridge() {
    if (root.__vxUnifiedShowTabWrapped) return true;
    if (typeof root.showTab !== 'function') return false;
    const original = root.showTab;
    root.showTab = function unifiedShowTab(tabName) {
      const requested = String(tabName || '').toLowerCase();
      const archiveRequested = requested === 'archiv' || requested === 'archive';
      const key = archiveRequested ? 'anrufe' : ROOT_NAV.some((item) => item.key === requested) ? requested : '';
      if (key) setStableRootActive(key);
      let result;
      if (archiveRequested) {
        const args = Array.from(arguments);
        args[0] = 'anrufe';
        args[1] = document.getElementById('nav-anrufe');
        result = original.apply(this, args);
        showArchiveInsideRequests();
      } else {
        result = original.apply(this, arguments);
      }
      if (key === 'assistent') showAssistantView('profile', true);
      if (key === 'mehr') restoreSettingsRoot();
      if (key) setStableRootActive(key);
      return result;
    };
    root.__vxUnifiedShowTabWrapped = true;
    return true;
  }

  function applyAssistantEnhancements() {
    simplifyVoiceSelection();
    simplifyCapabilities();
    simplifyTechnicalStatus();
  }

  function installAssistantObserver() {
    const body = document.getElementById('vx-assistant-profile-body');
    if (!body || assistantObserver || typeof MutationObserver !== 'function') return;
    assistantObserver = new MutationObserver(() => {
      root.requestAnimationFrame?.(applyAssistantEnhancements);
    });
    assistantObserver.observe(body, { childList: true, subtree: true });
  }

  function boot() {
    normalizeRootNavigation();
    installShowTabBridge();
    mountManagedPages();
    applyAssistantEnhancements();
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
    installAssistantObserver();
  }

  function install() {
    document.addEventListener('click', (event) => {
      const businessProfileShortcut = event.target?.closest?.('#vx-open-business-profile');
      if (businessProfileShortcut) {
        event.preventDefault();
        event.stopPropagation();
        showAssistantView('business', true);
        return;
      }

      const rootButton = event.target?.closest?.('[data-vx-root-tab]');
      if (rootButton) {
        const key = rootButton.dataset.vxRootTab;
        if (key) setStableRootActive(key);
      }
    }, true);

    boot();
  }

  root.vxShowAssistantView = showAssistantView;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : this);
