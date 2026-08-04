(function installCustomerNotifications(root){
  'use strict';
  if(!root||!root.document||root.__vxCustomerNotificationsInstalled)return;
  root.__vxCustomerNotificationsInstalled=true;

  let currentBell=null;
  let outsideHandler=null;

  function hasBellIcon(node){
    if(!node||node.nodeType!==1)return false;
    const ownClass=String(node.className&&node.className.baseVal||node.className||'');
    const lucide=String(node.getAttribute?.('data-lucide')||'');
    if(/(?:^|\s)ph(?:-[a-z]+)*-bell(?:-[a-z]+)*(?:\s|$)/i.test(ownClass))return true;
    if(/bell/i.test(lucide))return true;
    return !!node.querySelector?.('[class*="ph-bell" i],svg[data-lucide*="bell" i],svg[class*="bell" i],i[class*="bell" i]');
  }

  function findBell(){
    const explicit=[
      '[data-notifications-trigger]',
      '[data-notification-trigger]',
      '#notification-button',
      '#notifications-button',
      '#notification-bell',
      '#notifications-bell',
      'button[aria-label*="Benachrichtigung" i]',
      '[role="button"][aria-label*="Benachrichtigung" i]',
      'button[title*="Benachrichtigung" i]',
      'button[aria-label*="notification" i]',
      '[role="button"][aria-label*="notification" i]'
    ];
    for(const selector of explicit){
      const node=root.document.querySelector(selector);
      if(node)return node.closest?.('button,a,[role="button"],[tabindex]')||node;
    }
    return Array.from(root.document.querySelectorAll('button,a,[role="button"],[tabindex]')).find(hasBellIcon)||null;
  }

  function ensureStyles(){
    if(root.document.getElementById('vx-customer-notifications-style'))return;
    const style=root.document.createElement('style');
    style.id='vx-customer-notifications-style';
    style.textContent=`
      #vx-customer-notifications{position:fixed;z-index:9100;display:none;width:min(360px,calc(100vw - 32px));box-sizing:border-box;background:#fff;border:1px solid rgba(226,232,240,.95);border-radius:24px;box-shadow:0 22px 55px rgba(15,35,71,.18);overflow:hidden;color:#111827;}
      #vx-customer-notifications.is-open{display:block;animation:vxNotificationsIn .16s ease-out;}
      .vx-notifications-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 22px 17px;border-bottom:1px solid #edf1f6;background:#fff;}
      .vx-notifications-title{font-size:21px;line-height:1.25;font-weight:750;color:#111827;}
      .vx-notifications-close{width:42px;height:42px;border:0;border-radius:14px;background:#f2f6fc;color:#475569;font-size:27px;line-height:1;display:grid;place-items:center;cursor:pointer;}
      .vx-notifications-close:focus-visible{outline:3px solid rgba(52,120,237,.24);outline-offset:2px;}
      .vx-notifications-body{padding:18px 20px 22px;}
      .vx-notifications-empty{min-height:154px;border:1px solid #e4eaf2;border-radius:18px;background:#f8fafc;display:grid;place-items:center;text-align:center;padding:22px;color:#64748b;font-size:15px;line-height:1.5;}
      .vx-notifications-empty strong{display:block;color:#111827;font-size:17px;line-height:1.35;margin-bottom:7px;}
      @keyframes vxNotificationsIn{from{opacity:0;transform:translateY(-7px) scale(.985)}to{opacity:1;transform:none}}
      @media(max-width:768px){#vx-customer-notifications{width:min(360px,calc(100vw - 32px));border-radius:22px;}.vx-notifications-head{padding:20px 20px 16px;}.vx-notifications-body{padding:16px 18px 20px;}}
    `;
    root.document.head.appendChild(style);
  }

  function ensurePanel(){
    let panel=root.document.getElementById('vx-customer-notifications');
    if(panel)return panel;
    panel=root.document.createElement('section');
    panel.id='vx-customer-notifications';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','false');
    panel.setAttribute('aria-labelledby','vx-notifications-title');
    panel.setAttribute('aria-hidden','true');
    panel.innerHTML='<header class="vx-notifications-head"><div id="vx-notifications-title" class="vx-notifications-title">Benachrichtigungen</div><button type="button" class="vx-notifications-close" aria-label="Benachrichtigungen schliessen">×</button></header><div class="vx-notifications-body"><div class="vx-notifications-empty"><div><strong>Keine neuen Benachrichtigungen</strong>Wichtige Änderungen und Hinweise erscheinen künftig hier.</div></div></div>';
    root.document.body.appendChild(panel);
    panel.querySelector('.vx-notifications-close')?.addEventListener('click',function(event){
      event.preventDefault();
      close();
    });
    return panel;
  }

  function positionPanel(){
    const panel=ensurePanel();
    const bell=currentBell&&root.document.contains(currentBell)?currentBell:findBell();
    if(!bell)return;
    currentBell=bell;
    const rect=bell.getBoundingClientRect();
    const margin=16;
    const gap=12;
    const width=Math.min(360,root.innerWidth-margin*2);
    const left=Math.max(margin,Math.min(root.innerWidth-width-margin,rect.right-width));
    panel.style.width=width+'px';
    panel.style.left=Math.round(left)+'px';
    panel.style.right='auto';
    panel.style.top=Math.round(rect.bottom+gap)+'px';
  }

  function removeOutsideHandler(){
    if(!outsideHandler)return;
    root.document.removeEventListener('pointerdown',outsideHandler,true);
    outsideHandler=null;
  }

  function close(){
    const panel=root.document.getElementById('vx-customer-notifications');
    if(!panel)return;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden','true');
    currentBell?.setAttribute?.('aria-expanded','false');
    removeOutsideHandler();
  }

  function open(){
    ensureStyles();
    const panel=ensurePanel();
    positionPanel();
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden','false');
    currentBell?.setAttribute?.('aria-expanded','true');
    removeOutsideHandler();
    outsideHandler=function(event){
      const target=event.target;
      if(panel.contains(target)||currentBell?.contains?.(target))return;
      close();
    };
    root.setTimeout(function(){root.document.addEventListener('pointerdown',outsideHandler,true);},0);
  }

  function toggle(){
    const panel=ensurePanel();
    if(panel.classList.contains('is-open'))close();else open();
  }

  function bindBell(){
    const bell=findBell();
    if(!bell)return false;
    currentBell=bell;
    if(bell.dataset.vxNotificationsBound==='dropdown-v1')return true;
    bell.dataset.vxNotificationsBound='dropdown-v1';
    bell.setAttribute?.('aria-label',bell.getAttribute?.('aria-label')||'Benachrichtigungen öffnen');
    bell.setAttribute?.('aria-haspopup','dialog');
    bell.setAttribute?.('aria-expanded','false');
    if(bell.tagName!=='BUTTON'&&bell.tagName!=='A'&&!bell.hasAttribute?.('tabindex'))bell.setAttribute?.('tabindex','0');
    bell.addEventListener('click',function(event){
      event.preventDefault();
      root.setTimeout(toggle,0);
    },true);
    bell.addEventListener('keydown',function(event){
      if(event.key!=='Enter'&&event.key!==' ')return;
      event.preventDefault();
      root.setTimeout(toggle,0);
    },true);
    return true;
  }

  function start(){
    ensureStyles();
    bindBell();
    root.addEventListener('resize',function(){
      if(root.document.getElementById('vx-customer-notifications')?.classList.contains('is-open'))positionPanel();
    });
    root.addEventListener('scroll',function(){
      if(root.document.getElementById('vx-customer-notifications')?.classList.contains('is-open'))positionPanel();
    },true);
    root.document.addEventListener('keydown',function(event){
      if(event.key==='Escape')close();
    });
    let scheduled=false;
    new MutationObserver(function(){
      if(scheduled)return;
      scheduled=true;
      root.requestAnimationFrame(function(){scheduled=false;bindBell();});
    }).observe(root.document.documentElement,{childList:true,subtree:true});
  }

  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof globalThis!=='undefined'?globalThis:this);
