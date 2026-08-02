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

  let scheduled = false;

  function addStyles() {
    if (document.getElementById('vx-unified-customer-navigation-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-unified-customer-navigation-style';
    style.textContent = `
      #nav-assistent.nav-item,#mnav-assistent.mobile-nav-btn{display:flex!important}
      #tab-assistent.vx-unified-assistant-root>[id^="mehr-sub-"]{display:none!important}
      #tab-assistent.vx-unified-assistant-root:not(.vx-assistant-view-updates)>#mehr-sub-assistant-profile{display:block!important}
      #tab-assistent.vx-unified-assistant-root.vx-assistant-view-updates>#mehr-sub-betriebsinfos{display:block!important}
      #tab-assistent [data-vx-ap-back],#tab-assistent [data-ops-back]{display:none!important}
      .vx-assistant-root-switch{display:flex;gap:6px;padding:0 0 14px;margin-bottom:2px;border-bottom:.5px solid var(--line,#e4e8f0)}
      .vx-assistant-root-switch button{border:0;border-radius:10px;background:#f1f5f9;color:#64748b;padding:9px 13px;font:650 12px inherit;cursor:pointer}
      .vx-assistant-root-switch button.active{background:#0d1f3c;color:#fff}
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
        #tab-assistent>#mehr-sub-assistant-profile,#tab-assistent>#mehr-sub-betriebsinfos{padding-bottom:calc(86px + env(safe-area-inset-bottom,0px))}
        .vx-assistant-root-switch{position:sticky;top:0;z-index:8;background:var(--surface,#fff);padding-top:4px}
        .vx-assistant-root-switch button{flex:1;min-height:42px}
      }
    `;
    document.head.appendChild(style);
  }

  function setVisible(node) {
    if (!node) return;
    if (node.hidden) node.hidden = false;
    if (node.hasAttribute('aria-hidden')) node.removeAttribute('aria-hidden');
    if (node.style.display) node.style.removeProperty('display');
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
    const existing = node.querySelector('.vx-root-nav-label');
    if (existing) {
      if (existing.textContent !== label) existing.textContent = label;
      return;
    }
    const text = document.createElement('span');
    text.className = 'vx-root-nav-label';
    text.textContent = label;
    node.appendChild(text);
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
    const known = ROOT_NAV.find((item) => item.mobile === node.id);
    if (known) return known.key;
    const onclick = String(node.getAttribute('onclick') || '');
    const match = onclick.match(/showTab\(['"]([^'"]+)/);
    if (match && ROOT_NAV.some((item) => item.key === match[1])) return match[1];
    const label = String(node.textContent || '').replace(/\s+/g, ' ').trim();
    const byLabel = ROOT_NAV.find((item) => item.label === label);
    return byLabel?.key || '';
  }

  function dedupeAndOrderMobileNavigation() {
    const nodes = ROOT_NAV.map((item) => document.getElementById(item.mobile)).filter(Boolean);
    const container = nodes[0]?.parentElement;
    if (!container) return;

    ROOT_NAV.forEach((item) => {
      const duplicates = Array.from(container.querySelectorAll(`[id="${item.mobile}"]`));
      duplicates.slice(1).forEach((node) => {
        node.style.display = 'none';
        node.setAttribute('aria-hidden', 'true');
        node.dataset.vxDuplicateRootNav = '1';
      });
    });

    const canonicalIds = new Set(ROOT_NAV.map((item) => item.mobile));
    const claimedKeys = new Set();
    Array.from(container.querySelectorAll('.mobile-nav-btn')).forEach((node) => {
      if (canonicalIds.has(node.id)) {
        claimedKeys.add(canonicalRootKey(node));
        return;
      }
      const key = canonicalRootKey(node);
      if (!key || !ROOT_NAV.some((item) => item.key === key)) return;
      node.style.display = 'none';
      node.setAttribute('aria-hidden', 'true');
      node.dataset.vxDuplicateRootNav = '1';
    });

    ROOT_NAV.forEach((item) => {
      const node = document.getElementById(item.mobile);
      if (node && node.parentElement === container) container.appendChild(node);
    });
  }

  function normalizeRootNavigation() {
    ROOT_NAV.forEach((item) => {
      const desktop = document.getElementById(item.desktop);
      const mobile = document.getElementById(item.mobile);
      if (item.key === 'assistent') {
        setVisible(desktop);
        setVisible(mobile);
      }
      setLabel(desktop, item.label);
      setLabel(mobile, item.label);
      setIcon(desktop, item.icon);
      setIcon(mobile, item.icon);
      [desktop, mobile].filter(Boolean).forEach((node) => {
        if (node.dataset.vxRootTab !== item.key) node.dataset.vxRootTab = item.key;
        if (node.getAttribute('aria-label') !== item.label) node.setAttribute('aria-label', item.label);
      });
    });

    const assistantDesktop = document.getElementById('nav-assistent');
    const reportDesktop = document.getElementById('nav-auswertung');
    if (
      assistantDesktop && reportDesktop &&
      assistantDesktop.parentElement === reportDesktop.parentElement &&
      assistantDesktop.nextElementSibling !== reportDesktop
    ) {
      reportDesktop.parentElement.insertBefore(assistantDesktop, reportDesktop);
    }

    dedupeAndOrderMobileNavigation();
  }

  function ensureAssistantSwitcher(assistantTab) {
    let switcher = document.getElementById('vx-assistant-root-switch');
    if (!switcher) {
      switcher = document.createElement('div');
      switcher.id = 'vx-assistant-root-switch';
      switcher.className = 'vx-assistant-root-switch';
      switcher.setAttribute('role', 'tablist');
      switcher.setAttribute('aria-label', 'Assistentenbereich');
      switcher.innerHTML = [
        '<button type="button" data-vx-assistant-view="profile" role="tab">Assistent</button>',
        '<button type="button" data-vx-assistant-view="updates" role="tab">Aktuelle Infos</button>'
      ].join('');
      switcher.addEventListener('click', (event) => {
        const button = event.target.closest('[data-vx-assistant-view]');
        if (!button) return;
        showAssistantView(button.dataset.vxAssistantView, true);
      });
    }
    if (switcher.parentElement !== assistantTab) assistantTab.insertBefore(switcher, assistantTab.firstChild);
    return switcher;
  }

  function removeLegacySettingsAssistantLinks() {
    document.getElementById('vx-assistant-profile-entry')?.remove();
    document.getElementById('vx-operational-entry')?.remove();
    Array.from(document.querySelectorAll('#tab-mehr button')).forEach((button) => {
      if (String(button.textContent || '').trim() === 'Zum Assistent-Bereich') button.remove();
    });
    const section = document.getElementById('vx-assistant-business-section');
    if (section && String(section.textContent || '').trim() !== 'Geschäft') section.textContent = 'Geschäft';
  }

  function normalizeOperationalPage(page) {
    if (!page) return;
    const title = page.querySelector('.vx-page-header-title');
    const subtitle = title?.parentElement?.querySelector('div:nth-child(2)');
    if (title && String(title.textContent || '').trim() !== 'Aktuelle Infos') title.textContent = 'Aktuelle Infos';
    const copy = 'Ferien, Abwesenheiten, Sonderzeiten und vorübergehende Hinweise.';
    if (subtitle && String(subtitle.textContent || '').trim() !== copy) subtitle.textContent = copy;
  }

  function mountAssistantAsRootTab() {
    const assistantTab = document.getElementById('tab-assistent');
    const assistantPage = document.getElementById('mehr-sub-assistant-profile');
    const operationalPage = document.getElementById('mehr-sub-betriebsinfos');
    if (!assistantTab || !assistantPage || !operationalPage) return false;

    assistantTab.classList.add('vx-unified-assistant-root');
    ensureAssistantSwitcher(assistantTab);
    if (assistantPage.parentElement !== assistantTab) assistantTab.appendChild(assistantPage);
    if (operationalPage.parentElement !== assistantTab) assistantTab.appendChild(operationalPage);

    const assistantBack = assistantPage.querySelector('[data-vx-ap-back]');
    const operationalBack = operationalPage.querySelector('[data-ops-back]');
    if (assistantBack && assistantBack.style.display !== 'none') assistantBack.style.display = 'none';
    if (operationalBack && operationalBack.style.display !== 'none') operationalBack.style.display = 'none';

    const title = assistantPage.querySelector('.vx-page-header-title');
    if (title && String(title.textContent || '').trim() !== 'Assistent') title.textContent = 'Assistent';
    const subtitle = title?.parentElement?.querySelector('div:nth-child(2)');
    const subtitleCopy = 'Stimme, Auftreten und die wichtigsten Funktionen.';
    if (subtitle && String(subtitle.textContent || '').trim() !== subtitleCopy) subtitle.textContent = subtitleCopy;
    normalizeOperationalPage(operationalPage);
    removeLegacySettingsAssistantLinks();
    return true;
  }

  function showAssistantView(view, loadUpdates) {
    const assistantTab = document.getElementById('tab-assistent');
    if (!assistantTab) return;
    const updates = view === 'updates';
    assistantTab.classList.toggle('vx-assistant-view-updates', updates);
    assistantTab.querySelectorAll('[data-vx-assistant-view]').forEach((button) => {
      const active = button.dataset.vxAssistantView === (updates ? 'updates' : 'profile');
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if (updates && loadUpdates && typeof root.vxOperationalUpdatesOpen === 'function') {
      root.vxOperationalUpdatesOpen();
      const operationalPage = document.getElementById('mehr-sub-betriebsinfos');
      if (operationalPage?.parentElement !== assistantTab) assistantTab.appendChild(operationalPage);
      assistantTab.classList.add('vx-assistant-view-updates');
      normalizeOperationalPage(operationalPage);
      removeLegacySettingsAssistantLinks();
    }
  }

  function restoreSettingsRoot() {
    const main = document.getElementById('mehr-main');
    if (main) main.style.display = '';
    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => { node.style.display = 'none'; });
  }

  function simplifyVoiceSelection() {
    const body = document.getElementById('vx-assistant-profile-body');
    if (!body) return;
    const voiceCard = Array.from(body.querySelectorAll('.vx-ap-card')).find((card) => (
      String(card.querySelector('.vx-ap-title')?.textContent || '').trim() === 'Stimme'
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
    if (title && String(title.textContent || '').trim() !== 'Fähigkeiten') title.textContent = 'Fähigkeiten';
    const meta = card.querySelector('.vx-ap-meta');
    const metaCopy = 'Die wichtigsten Aufgaben, die Ihr Assistent aktuell übernimmt.';
    if (meta && String(meta.textContent || '').trim() !== metaCopy) meta.textContent = metaCopy;

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

  function syncActiveNavigation() {
    const active = ROOT_NAV.find((item) => {
      const desktop = document.getElementById(item.desktop);
      const mobile = document.getElementById(item.mobile);
      return desktop?.classList.contains('active') || mobile?.classList.contains('active');
    });
    if (!active) return;
    ROOT_NAV.forEach((item) => {
      [document.getElementById(item.desktop), document.getElementById(item.mobile)].filter(Boolean).forEach((node) => {
        if (item.key === active.key) node.setAttribute('aria-current', 'page');
        else node.removeAttribute('aria-current');
      });
    });
  }

  function apply() {
    addStyles();
    normalizeRootNavigation();
    mountAssistantAsRootTab();
    simplifyVoiceSelection();
    simplifyCapabilities();
    simplifyTechnicalStatus();
    if (!document.getElementById('tab-assistent')?.classList.contains('vx-assistant-view-updates')) showAssistantView('profile', false);
    syncActiveNavigation();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    root.setTimeout(() => {
      scheduled = false;
      apply();
    }, 50);
  }

  function install() {
    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('click', (event) => {
      const rootButton = event.target?.closest?.('[data-vx-root-tab]');
      if (!rootButton) return;
      const key = rootButton.dataset.vxRootTab;
      root.setTimeout(() => {
        if (key === 'assistent') showAssistantView('profile', false);
        if (key === 'mehr') restoreSettingsRoot();
        syncActiveNavigation();
      }, 0);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : this);
