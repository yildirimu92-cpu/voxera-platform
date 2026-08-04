(function installCustomerNotifications(root){
  'use strict';
  if(!root||!root.document||root.__vxCustomerNotificationsInstalled)return;
  root.__vxCustomerNotificationsInstalled=true;

  function findBell(){
    const selectors=[
      '[data-notifications-trigger]','[data-notification-trigger]','#notification-button','#notifications-button','#notification-bell','#notifications-bell',
      'button[aria-label*="Benachrichtigung" i]','button[title*="Benachrichtigung" i]','button[aria-label*="notification" i]','button[title*="notification" i]'
    ];
    for(const selector of selectors){const node=root.document.querySelector(selector);if(node)return node;}
    return Array.from(root.document.querySelectorAll('button,a,[role="button"]')).find(function(node){
      return !!node.querySelector('.ph-bell,.ph-bell-ringing,[class*="bell" i],svg[data-lucide="bell"],svg.lucide-bell');
    })||null;
  }

  function ensureStyles(){
    if(root.document.getElementById('vx-customer-notifications-style'))return;
    const style=root.document.createElement('style');
    style.id='vx-customer-notifications-style';
    style.textContent=`
      #vx-customer-notifications{position:fixed;inset:0;z-index:5000;display:none;background:rgba(15,35,71,.38);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);padding:calc(92px + env(safe-area-inset-top,0px)) 18px calc(98px + env(safe-area-inset-bottom,0px));box-sizing:border-box;}
      #vx-customer-notifications.is-open{display:flex;justify-content:flex-end;align-items:flex-start;}
      .vx-notifications-panel{width:min(390px,100%);max-height:min(620px,calc(100vh - 190px));overflow:hidden;background:#fff;border:1px solid #dde5ef;border-radius:24px;box-shadow:0 24px 70px rgba(15,35,71,.22);display:flex;flex-direction:column;}
      .vx-notifications-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 20px 18px;background:#102344;color:#fff;}
      .vx-notifications-title{font-size:22px;line-height:1.2;font-weight:750;}
      .vx-notifications-close{width:44px;height:44px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(255,255,255,.1);color:#fff;font-size:28px;line-height:1;display:grid;place-items:center;cursor:pointer;}
      .vx-notifications-body{padding:28px 20px 32px;overflow:auto;}
      .vx-notifications-empty{min-height:190px;border:1px solid #e3e9f1;border-radius:18px;background:#f8fafc;display:grid;place-items:center;text-align:center;padding:24px;color:#64748b;}
      .vx-notifications-empty strong{display:block;color:#111827;font-size:18px;margin-bottom:8px;}
      @media(max-width:768px){#vx-customer-notifications{padding:calc(116px + env(safe-area-inset-top,0px)) 16px calc(104px + env(safe-area-inset-bottom,0px));}.vx-notifications-panel{width:100%;max-height:calc(100vh - 235px);border-radius:22px;}}
    `;
    root.document.head.appendChild(style);
  }

  function ensurePanel(){
    let overlay=root.document.getElementById('vx-customer-notifications');
    if(overlay)return overlay;
    overlay=root.document.createElement('div');
    overlay.id='vx-customer-notifications';
    overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML='<section class="vx-notifications-panel" role="dialog" aria-modal="true" aria-labelledby="vx-notifications-title"><header class="vx-notifications-head"><div id="vx-notifications-title" class="vx-notifications-title">Benachrichtigungen</div><button type="button" class="vx-notifications-close" aria-label="Benachrichtigungen schliessen">×</button></header><div class="vx-notifications-body"><div class="vx-notifications-empty"><div><strong>Keine neuen Benachrichtigungen</strong>Wichtige Änderungen und Hinweise erscheinen künftig hier.</div></div></div></section>';
    root.document.body.appendChild(overlay);
    overlay.addEventListener('click',function(event){if(event.target===overlay||event.target.closest('.vx-notifications-close'))close();});
    root.document.addEventListener('keydown',function(event){if(event.key==='Escape'&&overlay.classList.contains('is-open'))close();});
    return overlay;
  }

  function open(){
    ensureStyles();
    const overlay=ensurePanel();
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden','false');
    root.document.documentElement.style.overflow='hidden';
    root.setTimeout(function(){overlay.querySelector('.vx-notifications-close')?.focus();},0);
  }
  function close(){
    const overlay=root.document.getElementById('vx-customer-notifications');
    if(!overlay)return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden','true');
    root.document.documentElement.style.overflow='';
  }

  function bind(){
    const bell=findBell();
    if(!bell)return false;
    if(bell.dataset.vxNotificationsBound==='1')return true;
    bell.dataset.vxNotificationsBound='1';
    bell.setAttribute('aria-label',bell.getAttribute('aria-label')||'Benachrichtigungen öffnen');
    bell.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();open();},true);
    return true;
  }

  let attempts=0;
  function boot(){
    ensureStyles();
    if(bind())return;
    attempts+=1;
    if(attempts<80)root.setTimeout(boot,200);
  }
  const observer=new MutationObserver(function(){bind();});
  function start(){boot();observer.observe(root.document.documentElement,{childList:true,subtree:true});}
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof globalThis!=='undefined'?globalThis:this);
