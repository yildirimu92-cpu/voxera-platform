(function billingUiConsolidated(){
  'use strict';

  const ROOT_ID='billing-finance';
  const STYLE_ID='voxera-billing-ui-consolidated-style';
  const ACTION_RE=/öffnen|erneut senden|mahnen|mahnung|bezahlt|qr öffnen|pdf öffnen|neu generieren|storno|gutschrift/i;

  function labelOf(el){return String(el?.textContent||el?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();}
  function keyOf(el){return labelOf(el).toLowerCase().replace(/\s+/g,' ');}

  function installStyles(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      #${ROOT_ID} .vx-billing-actionbar{display:flex;align-items:center;gap:8px;min-width:0;white-space:nowrap}
      #${ROOT_ID} .vx-billing-actionbar>.btn{flex:0 0 auto}
      .vx-billing-menu{position:relative;display:inline-flex}
      .vx-billing-menu-toggle{min-height:38px;padding:0 14px;border:1px solid var(--line,#e4e8f0);border-radius:10px;background:#fff;color:var(--ink,#1a1a2e);font:inherit;font-weight:700;cursor:pointer}
      .vx-billing-menu-panel{position:absolute;right:0;top:calc(100% + 8px);z-index:120;width:230px;padding:7px;background:#fff;border:1px solid var(--line,#e4e8f0);border-radius:12px;box-shadow:0 16px 40px rgba(13,31,60,.16);display:none}
      .vx-billing-menu.open .vx-billing-menu-panel{display:grid;gap:4px}
      .vx-billing-menu-panel .btn,.vx-billing-menu-panel button,.vx-billing-menu-panel a{width:100%;min-height:38px;display:flex;align-items:center;justify-content:flex-start;text-align:left;padding:9px 11px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:var(--ink,#1a1a2e)!important;box-shadow:none!important;white-space:normal}
      .vx-billing-menu-panel .btn:hover,.vx-billing-menu-panel button:hover,.vx-billing-menu-panel a:hover{background:#f1f5f9!important}
      #${ROOT_ID} table{table-layout:auto!important}
      #${ROOT_ID} td:last-child{min-width:190px;overflow:visible!important}
      .modal .vx-billing-modal-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;width:100%}
      @media(max-width:900px){#${ROOT_ID} td:last-child{min-width:160px}.vx-billing-menu-panel{right:auto;left:0}}
      @media(max-width:720px){#${ROOT_ID} .vx-billing-actionbar{width:100%;justify-content:space-between}.vx-billing-menu-panel{position:fixed;left:12px;right:12px;bottom:12px;top:auto;width:auto;border-radius:16px;z-index:9999}.modal .vx-billing-modal-actions{justify-content:stretch}.modal .vx-billing-modal-actions>*{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function unwrapLegacy(container){
    container.querySelectorAll('.vx-billing-actions-v2,.billing-actions-compact,[data-vx-actions-v2]').forEach(wrapper=>{
      if(wrapper.classList?.contains('vx-action-menu')) return;
      const parent=wrapper.parentNode;
      if(!parent) return;
      [...wrapper.children].forEach(child=>{
        if(child.matches?.('details.vx-action-menu,.vx-action-menu')){
          child.querySelectorAll('button,a,.btn').forEach(action=>parent.insertBefore(action,wrapper));
        }else parent.insertBefore(child,wrapper);
      });
      wrapper.remove();
    });
    container.querySelectorAll('details.vx-action-menu,.vx-action-menu').forEach(menu=>{
      const parent=menu.parentNode;
      if(!parent) return;
      menu.querySelectorAll('button,a,.btn').forEach(action=>parent.insertBefore(action,menu));
      menu.remove();
    });
    delete container.dataset.vxActionsV2;
  }

  function dedupe(actions){
    const seen=new Set();
    return actions.filter(action=>{
      const key=keyOf(action);
      if(!key||seen.has(key)){action.remove();return false;}
      seen.add(key);return true;
    });
  }

  function makeMenu(actions,label='Aktionen'){
    const wrap=document.createElement('div');wrap.className='vx-billing-menu';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='vx-billing-menu-toggle';toggle.textContent=label;
    const panel=document.createElement('div');panel.className='vx-billing-menu-panel';
    actions.forEach(action=>panel.appendChild(action));
    toggle.addEventListener('click',event=>{event.stopPropagation();document.querySelectorAll('.vx-billing-menu.open').forEach(m=>{if(m!==wrap)m.classList.remove('open')});wrap.classList.toggle('open');});
    wrap.append(toggle,panel);return wrap;
  }

  function normalizeRows(){
    const root=document.getElementById(ROOT_ID)||document.querySelector('[data-section="billing-finance"]');
    if(!root) return;
    root.querySelectorAll('tr,.invoice-row,[data-invoice-id]').forEach(row=>{
      if(row.dataset.vxBillingConsolidated==='1') return;
      const raw=[...row.querySelectorAll('button,a,.btn')].filter(el=>ACTION_RE.test(labelOf(el)));
      if(raw.length<3) return;
      const container=raw[0].parentElement;
      if(!container) return;
      unwrapLegacy(container);
      const actions=dedupe([...row.querySelectorAll('button,a,.btn')].filter(el=>ACTION_RE.test(labelOf(el))));
      if(actions.length<2) return;
      const open=actions.find(a=>/^öffnen$/i.test(labelOf(a)))||actions[0];
      const rest=actions.filter(a=>a!==open);
      const bar=document.createElement('div');bar.className='vx-billing-actionbar';
      container.insertBefore(bar,open);bar.appendChild(open);
      if(rest.length===1) bar.appendChild(rest[0]); else bar.appendChild(makeMenu(rest));
      row.dataset.vxBillingConsolidated='1';
    });
  }

  function normalizeModals(){
    document.querySelectorAll('.modal').forEach(modal=>{
      const text=String(modal.textContent||'').toLowerCase();
      if(!text.includes('rechnung')&&!text.includes('billing')) return;
      if(modal.dataset.vxBillingModal==='1') return;
      const raw=[...modal.querySelectorAll('button,a,.btn')].filter(el=>ACTION_RE.test(labelOf(el)));
      if(raw.length<3) return;
      const footer=raw[0].closest('.modal-footer')||raw[0].parentElement;
      if(!footer) return;
      unwrapLegacy(footer);
      const actions=dedupe([...footer.querySelectorAll('button,a,.btn')].filter(el=>ACTION_RE.test(labelOf(el))));
      if(actions.length<2) return;
      const primary=actions.find(a=>/erneut senden/i.test(labelOf(a)))||actions[0];
      const rest=actions.filter(a=>a!==primary);
      const bar=document.createElement('div');bar.className='vx-billing-modal-actions';
      footer.insertBefore(bar,footer.firstChild);bar.appendChild(makeMenu(rest,'Weitere Aktionen'));bar.appendChild(primary);
      modal.dataset.vxBillingModal='1';
    });
  }

  let scheduled=false;
  function run(){scheduled=false;normalizeRows();normalizeModals();}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(run);}

  installStyles();
  document.addEventListener('click',event=>{if(!event.target.closest('.vx-billing-menu'))document.querySelectorAll('.vx-billing-menu.open').forEach(m=>m.classList.remove('open'));});
  const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
})();
