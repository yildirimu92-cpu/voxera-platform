(function repairVoxeraMobileNavigationContainment(root) {
  'use strict';
  if (!root || !root.document || root.__vxMobileNavigationContainmentRepairInstalled) return;
  root.__vxMobileNavigationContainmentRepairInstalled = true;

  const MOBILE_NAV_IDS = ['mnav-dashboard','mnav-anrufe','mnav-assistent','mnav-auswertung','mnav-mehr'];
  const GLOBAL_LAYER_IDS = ['vx-commercial-overlay','vx-upgrade-overlay','vx-minutes-overlay','upgrade-overlay','minutes-overlay','confirm-overlay','notification-panel','notifications-panel','notification-popover','notifications-popover'];

  function ensureVisibleStyles(container) {
    if (!container) return;
    container.dataset.vxMobileNavigation = '1';
    let style = root.document.getElementById('vx-mobile-nav-visibility-repair');
    if (!style) {
      style = root.document.createElement('style');
      style.id = 'vx-mobile-nav-visibility-repair';
      style.textContent = `
        @media (max-width:768px){
          html{scroll-padding-bottom:calc(88px + env(safe-area-inset-bottom,0px));}
          body{padding-bottom:calc(88px + env(safe-area-inset-bottom,0px))!important;}
          [data-vx-mobile-navigation="1"]{position:fixed!important;left:0!important;right:0!important;bottom:0!important;width:100%!important;max-width:none!important;box-sizing:border-box!important;margin:0!important;padding:8px 14px calc(8px + env(safe-area-inset-bottom,0px))!important;background:rgba(255,255,255,.98)!important;border-top:1px solid rgba(148,163,184,.24)!important;box-shadow:0 -8px 24px rgba(15,35,71,.08)!important;opacity:1!important;filter:none!important;transform:translateZ(0);isolation:isolate;z-index:1200!important;}
          [data-vx-mobile-navigation="1"] .mobile-nav-btn{min-height:56px!important;}
          #mnav-dashboard,#mnav-anrufe,#mnav-assistent,#mnav-auswertung,#mnav-mehr{color:#64748b!important;opacity:1!important;filter:none!important;text-shadow:none!important;}
          #mnav-dashboard :is(i,svg),#mnav-anrufe :is(i,svg),#mnav-assistent :is(i,svg),#mnav-auswertung :is(i,svg),#mnav-mehr :is(i,svg){color:currentColor!important;opacity:1!important;filter:none!important;stroke:currentColor!important;}
          #mnav-dashboard:is(.active,.vx-root-nav-active),#mnav-anrufe:is(.active,.vx-root-nav-active),#mnav-assistent:is(.active,.vx-root-nav-active),#mnav-auswertung:is(.active,.vx-root-nav-active),#mnav-mehr:is(.active,.vx-root-nav-active){color:#3478ed!important;}
        }
      `;
      root.document.head.appendChild(style);
    }
  }

  function moveOutsideSettings(node, settingsTab, globalHost) {
    if (!node || !settingsTab || !globalHost || !settingsTab.contains(node)) return false;
    globalHost.insertBefore(node, settingsTab.nextSibling);
    node.dataset.vxContainmentRepaired = '1';
    return true;
  }

  function repair() {
    const settingsTab = root.document.getElementById('tab-einstellungen') || root.document.getElementById('tab-mehr');
    const globalHost = settingsTab && settingsTab.parentElement;
    if (!settingsTab || !globalHost) return false;
    const nodes = MOBILE_NAV_IDS.map(function(id){return root.document.getElementById(id);}).filter(Boolean);
    const container = nodes[0] && nodes[0].parentElement;
    if (container && nodes.length === MOBILE_NAV_IDS.length && nodes.every(function(node){return node.parentElement === container;})) {
      moveOutsideSettings(container, settingsTab, globalHost);
      ensureVisibleStyles(container);
    }
    GLOBAL_LAYER_IDS.forEach(function(id){moveOutsideSettings(root.document.getElementById(id), settingsTab, globalHost);});
    return true;
  }

  function boot(){if(!repair())root.setTimeout(boot,100);}
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(typeof globalThis!=='undefined'?globalThis:this);

(function loadCustomerSupplementalRuntimes(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerSupplementalRuntimeLoaderInstalled) return;
  root.__vxCustomerSupplementalRuntimeLoaderInstalled = true;
  [
    '/shared/customer-runtime-commercial-controller.js?v=20260804-2',
    '/shared/customer-runtime-settings-navigation.js?v=20260804-1',
    '/shared/customer-runtime-modal-cancellation.js?v=20260804-2',
    '/shared/customer-runtime-cancellation-contract-owner.js?v=20260804-2'
  ].forEach(function(src){
    const script=root.document.createElement('script');
    script.src=src;
    script.async=false;
    root.document.head.appendChild(script);
  });
})(typeof globalThis!=='undefined'?globalThis:this);
