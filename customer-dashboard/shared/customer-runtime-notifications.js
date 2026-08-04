(function installCustomerNotifications(root){
  'use strict';
  if(!root||!root.document||root.__vxCustomerNotificationsInstalled)return;
  root.__vxCustomerNotificationsInstalled=true;

  function containsBellIcon(node){
    if(!node||node.nodeType!==1)return false;
    const ownClass=String(node.className&&node.className.baseVal||node.className||'');
    if(/(?:^|\s)ph(?:-[a-z]+)*-bell(?:-[a-z]+)*(?:\s|$)/i.test(ownClass))return true;
    if(/bell/i.test(String(node.getAttribute&&node.getAttribute('data-lucide')||'')))return true;
    return !!node.querySelector?.('[class*="ph-bell" i],[class~="ph-bell"],svg[data-lucide*="bell" i],svg[class*="bell" i]');
  }

  function triggerFromPath(event){
    const path=typeof event.composedPath==='function'?event.composedPath():[];
    for(const node of path){
      if(!node||node===root.document||node===root)return null;
      if(node.nodeType!==1)continue;
      const label=(String(node.getAttribute?.('aria-label')||'')+' '+String(node.getAttribute?.('title')||'')).toLowerCase();
      if(/benachrichtigung|notification/.test(label)||containsBellIcon(node)){
        return node.closest?.('button,a,[role="button"],[tabindex]')||node;
      }
    }
    let node=event.target;
    while(node&&node!==root.document.body){
      if(node.nodeType===1&&containsBellIcon(node))return node.closest?.('button,a,[role="button"],[tabindex]')||node;
      node=node.parentElement;
    }
    return null;
  }

  function findBell(){
    const selectors=[
      '[data-notifications-trigger]','[data-notification-trigger]','#notification-button','#notifications-button','#notification-bell','#notifications-bell',
      'button[aria-label*="Benachrichtigung" i]','[aria-label*="Benachrichtigung" i]','[title*="Benachrichtigung" i]',
      'button[aria-label*="notification" i]','[aria-label*="notification" i]','[title*="notification" i]',
      '[class*="ph-bell" i]','svg[data-lucide*="bell" i]'
    ];
    for(const selector of selectors){
      const found=root.document.querySelector(selector);
      if(found)return found.closest?.('button,a,[role="button"],[tabindex]')||found;
    }
    return Array.from(root.document.querySelectorAll('button,a,[role="button"],div,span')).find(containsBellIcon)||null;
  }

  function ensureStyles(){
    if(root.document.getElementById('vx-customer-notifications-style'))return;
    const style=root.document.createElement('style');
    style.id='vx-customer-notifications-style';
    style.textContent=`
      #vx-customer-notifications{position:fixed;inset:0;z-index:9000;display:none;background:rgba(15,35,71,.38);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);padding:calc(92px + env(safe-area-inset-top,0px)) 18px calc(98px + env(safe-area-inset-bottom,0px));box-sizing:border-box;pointer-events:auto;}
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

  function prepareBell(bell){
    if(!bell)return false;
    bell.dataset.vxNotificationsBound='1';
    bell.setAttribute?.('aria-label',bell.getAttribute?.('aria-label')||'Benachrichtigungen öffnen');
    if(bell.tagName!=='BUTTON'&&bell.tagName!=='A'&&!bell.hasAttribute?.('tabindex'))bell.setAttribute?.('tabindex','0');
    if(bell.style)bell.style.pointerEvents='auto';
    return true;
  }

  function start(){
    ensureStyles();
    prepareBell(findBell());
    root.document.addEventListener('click',function(event){
      if(event.target?.closest?.('#vx-customer-notifications'))return;
      const trigger=triggerFromPath(event);
      if(!trigger)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      prepareBell(trigger);
      open();
    },true);
    root.document.addEventListener('keydown',function(event){
      if(event.key==='Escape'&&root.document.getElementById('vx-customer-notifications')?.classList.contains('is-open')){close();return;}
      if((event.key==='Enter'||event.key===' ')&&triggerFromPath(event)){
        event.preventDefault();
        open();
      }
    },true);
    new MutationObserver(function(){prepareBell(findBell());}).observe(root.document.documentElement,{childList:true,subtree:true});
  }

  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof globalThis!=='undefined'?globalThis:this);
