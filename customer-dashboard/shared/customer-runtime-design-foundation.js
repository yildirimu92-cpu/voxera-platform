(function initVoxeraCustomerDesignFoundation(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerDesignFoundationInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxCustomerDesignFoundationInstalled = true;

  const ROOT_PAGE_IDS = [
    'tab-dashboard',
    'tab-anrufe',
    'tab-assistent',
    'tab-auswertung',
    'tab-mehr'
  ];
  const MOBILE_NAV_IDS = [
    'mnav-dashboard',
    'mnav-anrufe',
    'mnav-assistent',
    'mnav-auswertung',
    'mnav-mehr'
  ];

  let scheduled = false;
  let resizeObserver = null;
  let mutationObserver = null;

  function addStyles() {
    if (document.getElementById('vx-customer-design-foundation-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-customer-design-foundation-style';
    style.textContent = `
      :root{
        --vx-font-ui:Inter,"DM Sans","Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        --vx-ink:#101828;
        --vx-muted:#667085;
        --vx-subtle:#8a98ae;
        --vx-brand:#3478ed;
        --vx-brand-dark:#0f2347;
        --vx-surface:#ffffff;
        --vx-canvas:#f6f8fb;
        --vx-line:#e4eaf2;
        --vx-radius-card:18px;
        --vx-radius-control:12px;
        --vx-shadow-card:0 1px 2px rgba(16,24,40,.04);
        --vx-page-gap:16px;
        --vx-mobile-nav-height:92px;
        --vx-mobile-header-height:76px;
        --vx-visual-viewport-height:100dvh;
      }
      html.vx-customer-design-foundation-html{background:var(--vx-canvas);scroll-padding-bottom:calc(var(--vx-mobile-nav-height) + env(safe-area-inset-bottom,0px) + 28px)}
      body.vx-customer-design-foundation{
        margin:0;
        min-height:100svh;
        min-height:var(--vx-visual-viewport-height);
        background:var(--vx-canvas);
        color:var(--vx-ink);
        font-family:var(--vx-font-ui)!important;
        font-size:15px;
        line-height:1.5;
        text-rendering:optimizeLegibility;
        -webkit-font-smoothing:antialiased;
        overflow-x:hidden;
      }
      body.vx-customer-design-foundation :where(button,input,select,textarea){font-family:var(--vx-font-ui)!important}
      body.vx-customer-design-foundation :where(input,select,textarea){font-size:15px;line-height:1.45;color:var(--vx-ink)}
      body.vx-customer-design-foundation textarea{font-family:var(--vx-font-ui)!important;letter-spacing:0!important}
      body.vx-customer-design-foundation :where(button,[role="button"],input,select,textarea,a){-webkit-tap-highlight-color:transparent}
      body.vx-customer-design-foundation :where(button,[role="button"],a,input,select,textarea):focus-visible{outline:3px solid rgba(52,120,237,.24);outline-offset:2px}

      .vx-ds-root-page{box-sizing:border-box;min-width:0;padding-bottom:28px;scroll-margin-bottom:32px}
      .vx-ds-root-page>*{min-width:0;max-width:100%}
      .vx-ds-root-page .vx-page-header{
        box-sizing:border-box;
        border-radius:var(--vx-radius-card)!important;
        padding:22px 24px!important;
        margin-bottom:16px!important;
        box-shadow:none!important;
      }
      .vx-ds-root-page .vx-page-header-title{font-size:25px!important;line-height:1.2!important;font-weight:750!important;letter-spacing:-.025em!important}
      .vx-ds-root-page :where(h1,h2,h3,h4,.vx-ap-title,.vx-ops-title){font-family:var(--vx-font-ui)!important;color:var(--vx-ink);letter-spacing:-.015em}
      .vx-ds-root-page :where(h1){font-size:28px;line-height:1.18;font-weight:760}
      .vx-ds-root-page :where(h2){font-size:22px;line-height:1.25;font-weight:740}
      .vx-ds-root-page :where(h3){font-size:18px;line-height:1.3;font-weight:720}
      .vx-ds-root-page :where(p,.vx-ap-meta,.vx-ops-sub,.vx-ops-help){color:var(--vx-muted);line-height:1.55}

      .vx-ds-root-page :where(.vx-ap-card,.vx-ops-card,.vx-as-cap,.vx-ops-item,.vx-ops-section,.vx-ops-preview){
        border-color:var(--vx-line)!important;
        border-radius:var(--vx-radius-card)!important;
        box-shadow:var(--vx-shadow-card)!important;
      }
      .vx-ds-root-page :where(.vx-ap-card,.vx-ops-card){padding:20px!important}
      .vx-ds-root-page .vx-ap-title{font-size:18px!important;line-height:1.3!important;font-weight:730!important}
      .vx-ds-root-page .vx-ap-meta{font-size:14px!important;line-height:1.55!important;margin-top:4px!important}
      .vx-ds-root-page .vx-ops-title{font-size:17px!important;line-height:1.3!important;font-weight:730!important}
      .vx-ds-root-page .vx-ops-sub{font-size:14px!important;line-height:1.55!important}
      .vx-ds-root-page .vx-ops-message{font-size:15px!important;line-height:1.55!important}
      .vx-ds-root-page .vx-ops-meta{font-size:13px!important;line-height:1.45!important}

      .vx-ds-root-page :where(.btn,.vx-ops-btn,.vx-as-capability-toggle,.vx-ap-card button,.vx-ops-card button){
        min-height:44px;
        border-radius:var(--vx-radius-control)!important;
        font-size:15px!important;
        font-weight:700!important;
        line-height:1.2!important;
      }
      .vx-ds-root-page :where(input,select,textarea){
        box-sizing:border-box;
        min-height:44px;
        border-color:var(--vx-line)!important;
        border-radius:var(--vx-radius-control)!important;
        background:#fff;
        padding:11px 13px!important;
      }
      .vx-ds-root-page textarea{min-height:120px;resize:vertical;line-height:1.55!important}
      .vx-ds-root-page :where(label,.vx-ops-field label){font-size:13px!important;font-weight:700!important;line-height:1.35!important;color:var(--vx-muted)!important;text-transform:none!important;letter-spacing:0!important}
      .vx-ds-root-page :where(.vx-ap-status,.vx-ops-status,.vx-ops-pill){font-family:var(--vx-font-ui)!important}

      .vx-assistant-root-switch{
        box-sizing:border-box;
        gap:8px!important;
        padding:4px 0 14px!important;
        margin:0 0 16px!important;
        border-bottom:1px solid var(--vx-line)!important;
      }
      .vx-assistant-root-switch button{
        min-height:42px!important;
        border-radius:11px!important;
        padding:10px 15px!important;
        font-size:14px!important;
        font-weight:680!important;
      }
      .vx-assistant-root-switch button.active{background:var(--vx-brand-dark)!important;color:#fff!important}

      .vx-ds-dark-surface{color:#fff!important}
      .vx-ds-dark-surface :where(h1,h2,h3,h4,strong,b,.vx-page-header-title){color:#fff!important}
      .vx-ds-dark-surface :where(p,small,span:not(.badge):not(.pill),.vx-page-header-subtitle){color:rgba(255,255,255,.74)!important}
      .vx-ds-dark-surface :where([class*="label"],[class*="meta"],[class*="sub"]){color:rgba(255,255,255,.68)!important}
      .vx-ds-dark-surface :where([class*="value"],[class*="number"],[class*="count"]){color:#fff!important}

      .vx-ds-mobile-nav{box-sizing:border-box;z-index:9990!important}
      .vx-ds-mobile-nav .mobile-nav-btn{min-width:0;min-height:64px}
      .vx-ds-mobile-nav .mobile-nav-btn .vx-root-nav-label{font-size:12px;line-height:1.2}
      .vx-ds-mobile-header{box-sizing:border-box;background:#fff}

      @media(max-width:720px){
        :root{--vx-page-gap:12px}
        html.vx-customer-design-foundation-html{scroll-padding-top:calc(var(--vx-mobile-header-height) + 12px)}
        body.vx-customer-design-foundation{font-size:16px;min-height:100svh;min-height:var(--vx-visual-viewport-height)}
        body.vx-customer-design-foundation :where(input,select,textarea){font-size:16px!important}
        .vx-ds-root-page{
          width:100%;
          min-height:calc(var(--vx-visual-viewport-height) - var(--vx-mobile-header-height));
          padding-left:14px!important;
          padding-right:14px!important;
          padding-bottom:calc(var(--vx-mobile-nav-height) + env(safe-area-inset-bottom,0px) + 34px)!important;
          scroll-padding-bottom:calc(var(--vx-mobile-nav-height) + env(safe-area-inset-bottom,0px) + 28px);
        }
        .vx-ds-root-page .vx-page-header{
          border-radius:16px!important;
          padding:18px 18px!important;
          margin-bottom:14px!important;
        }
        .vx-ds-root-page .vx-page-header-title{font-size:24px!important}
        .vx-ds-root-page :where(h1){font-size:27px}
        .vx-ds-root-page :where(h2){font-size:21px}
        .vx-ds-root-page :where(h3){font-size:18px}
        .vx-ds-root-page :where(.vx-ap-card,.vx-ops-card){padding:18px!important;border-radius:16px!important}
        .vx-ds-root-page .vx-ap-title,.vx-ds-root-page .vx-ops-title{font-size:18px!important}
        .vx-ds-root-page .vx-ap-meta,.vx-ds-root-page .vx-ops-sub{font-size:14px!important}
        .vx-ds-root-page :where(.btn,.vx-ops-btn,.vx-as-capability-toggle,.vx-ap-card button,.vx-ops-card button){min-height:46px;font-size:15px!important}
        .vx-ds-root-page textarea{min-height:148px}
        .vx-assistant-root-switch{
          position:sticky!important;
          top:0!important;
          z-index:30!important;
          margin-left:-14px!important;
          margin-right:-14px!important;
          padding:8px 14px 12px!important;
          background:rgba(246,248,251,.96)!important;
          backdrop-filter:blur(12px);
          -webkit-backdrop-filter:blur(12px);
          overflow-x:auto!important;
          overscroll-behavior-inline:contain;
          scrollbar-width:none;
        }
        .vx-assistant-root-switch::-webkit-scrollbar{display:none}
        .vx-assistant-root-switch button{min-height:44px!important;padding:10px 14px!important;font-size:14px!important}
        .vx-ops-layout,.vx-ops-grid{grid-template-columns:minmax(0,1fr)!important}
        .vx-ops-rule{grid-template-columns:minmax(0,1fr)!important;gap:3px!important}
        .vx-ops-item{padding:16px!important}
        .vx-as-cap{padding:16px!important}
        .vx-ds-mobile-nav{
          min-height:calc(var(--vx-mobile-nav-height) + env(safe-area-inset-bottom,0px))!important;
          padding-bottom:max(8px,env(safe-area-inset-bottom,0px))!important;
          backdrop-filter:blur(14px);
          -webkit-backdrop-filter:blur(14px);
        }
        .vx-ds-mobile-header{
          min-height:var(--vx-mobile-header-height)!important;
          padding-top:10px!important;
          padding-bottom:10px!important;
        }
      }

      @media(max-width:390px){
        .vx-ds-root-page{padding-left:12px!important;padding-right:12px!important}
        .vx-assistant-root-switch{margin-left:-12px!important;margin-right:-12px!important;padding-left:12px!important;padding-right:12px!important}
        .vx-assistant-root-switch button{padding-left:12px!important;padding-right:12px!important}
      }

      @media(prefers-reduced-motion:reduce){
        body.vx-customer-design-foundation *,body.vx-customer-design-foundation *::before,body.vx-customer-design-foundation *::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
      }
    `;
    document.head.appendChild(style);
  }

  function markRootPages() {
    ROOT_PAGE_IDS.forEach((id) => document.getElementById(id)?.classList.add('vx-ds-root-page'));
  }

  function findSharedParent(nodes) {
    const present = nodes.filter(Boolean);
    if (!present.length) return null;
    let parent = present[0].parentElement;
    while (parent && !present.every((node) => parent.contains(node))) parent = parent.parentElement;
    return parent;
  }

  function markMobileNavigation() {
    const nodes = MOBILE_NAV_IDS.map((id) => document.getElementById(id)).filter(Boolean);
    const nav = findSharedParent(nodes);
    if (!nav) return null;
    nav.classList.add('vx-ds-mobile-nav');
    return nav;
  }

  function elementLooksLikeLogo(node) {
    if (!node) return false;
    const text = String(node.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
    const image = node.querySelector?.('img,svg');
    const source = String(image?.getAttribute?.('src') || image?.getAttribute?.('alt') || '').toUpperCase();
    return text.includes('VOXERA') || source.includes('VOXERA') || source.includes('BRAND');
  }

  function markMobileHeader() {
    if (root.matchMedia && !root.matchMedia('(max-width:720px)').matches) return null;
    const candidates = Array.from(document.querySelectorAll('header,[class*="mobile-header"],[class*="topbar"],[class*="top-bar"],[class*="app-header"]'));
    const header = candidates.find((node) => !node.closest('aside') && elementLooksLikeLogo(node));
    if (!header) return null;
    header.classList.add('vx-ds-mobile-header');
    return header;
  }

  function parseRgb(value) {
    const match = String(value || '').match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    return match ? match.slice(1, 4).map(Number) : null;
  }

  function luminance(rgb) {
    if (!rgb) return 1;
    const values = rgb.map((value) => {
      const normalized = value / 255;
      return normalized <= .03928 ? normalized / 12.92 : Math.pow((normalized + .055) / 1.055, 2.4);
    });
    return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
  }

  function markDarkSurfaces() {
    document.querySelectorAll('.vx-ds-root-page .vx-page-header,.vx-ds-root-page [class*="hero"],.vx-ds-root-page [class*="summary-head"],.vx-ds-root-page [class*="card-head"]').forEach((node) => {
      const background = root.getComputedStyle ? root.getComputedStyle(node).backgroundColor : '';
      if (luminance(parseRgb(background)) < .16) node.classList.add('vx-ds-dark-surface');
    });
  }

  function setMeasuredSize(name, node, fallback) {
    const value = node?.getBoundingClientRect?.().height;
    document.documentElement.style.setProperty(name, `${Math.max(fallback, Math.round(Number(value) || 0))}px`);
  }

  function syncViewport() {
    const height = Number(root.visualViewport?.height || root.innerHeight || 0);
    if (height > 0) document.documentElement.style.setProperty('--vx-visual-viewport-height', `${Math.round(height)}px`);
  }

  function measureShell() {
    const nav = markMobileNavigation();
    const header = markMobileHeader();
    setMeasuredSize('--vx-mobile-nav-height', nav, 86);
    setMeasuredSize('--vx-mobile-header-height', header, 72);
    syncViewport();

    if (typeof ResizeObserver === 'function') {
      if (!resizeObserver) resizeObserver = new ResizeObserver(schedule);
      [nav, header].filter(Boolean).forEach((node) => {
        if (!node.dataset.vxDsMeasured) {
          node.dataset.vxDsMeasured = '1';
          resizeObserver.observe(node);
        }
      });
    }
  }

  function apply() {
    document.documentElement.classList.add('vx-customer-design-foundation-html');
    document.body?.classList.add('vx-customer-design-foundation');
    addStyles();
    markRootPages();
    markMobileNavigation();
    markMobileHeader();
    markDarkSurfaces();
    measureShell();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    root.requestAnimationFrame?.(() => {
      scheduled = false;
      apply();
    }) || root.setTimeout(() => {
      scheduled = false;
      apply();
    }, 16);
  }

  function install() {
    apply();
    if (typeof MutationObserver === 'function') {
      mutationObserver = new MutationObserver(schedule);
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
    root.addEventListener?.('resize', schedule, { passive: true });
    root.addEventListener?.('orientationchange', schedule, { passive: true });
    root.visualViewport?.addEventListener?.('resize', syncViewport, { passive: true });
    root.visualViewport?.addEventListener?.('scroll', syncViewport, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : this);
