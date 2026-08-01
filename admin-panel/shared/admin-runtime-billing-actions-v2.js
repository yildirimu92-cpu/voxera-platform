(function billingActionsV2(){
  'use strict';

  const STYLE_ID='voxera-billing-actions-v2-style';
  if(!document.getElementById(STYLE_ID)){
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      #billing-finance .vx-billing-actions-v2{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0}
      #billing-finance .vx-billing-actions-v2>.btn:first-child{flex:0 0 auto}
      #billing-finance .vx-action-menu{position:relative;flex:0 0 auto}
      #billing-finance .vx-action-menu>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 14px;border:1px solid var(--line,#e4e8f0);border-radius:10px;background:#fff;color:var(--ink,#1a1a2e);font-weight:700;white-space:nowrap}
      #billing-finance .vx-action-menu>summary::-webkit-details-marker{display:none}
      #billing-finance .vx-action-popover{position:absolute;right:0;top:calc(100% + 8px);z-index:80;width:220px;padding:7px;background:#fff;border:1px solid var(--line,#e4e8f0);border-radius:12px;box-shadow:0 16px 40px rgba(13,31,60,.16);display:grid;gap:4px}
      #billing-finance .vx-action-popover .btn,#billing-finance .vx-action-popover button,#billing-finance .vx-action-popover a{width:100%;min-height:38px;justify-content:flex-start;text-align:left;border:0!important;box-shadow:none!important;background:transparent!important;color:var(--ink,#1a1a2e)!important;padding:9px 11px!important;border-radius:8px!important;white-space:normal}
      #billing-finance .vx-action-popover .btn:hover,#billing-finance .vx-action-popover button:hover,#billing-finance .vx-action-popover a:hover{background:#f1f5f9!important}
      #billing-finance .vx-action-popover .danger{color:#b42318!important}
      #billing-finance td:last-child{overflow:visible!important;min-width:210px}
      #billing-finance table{table-layout:auto!important}
      .modal .vx-modal-actions-v2{display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap}
      .modal .vx-modal-actions-v2 .vx-action-menu{position:relative}
      @media(max-width:980px){#billing-finance td:last-child{min-width:170px}}
      @media(max-width:720px){
        #billing-finance .vx-billing-actions-v2{display:grid;grid-template-columns:1fr auto;width:100%}
        #billing-finance .vx-billing-actions-v2>.btn:first-child{width:100%}
        #billing-finance .vx-action-popover{position:fixed;left:12px;right:12px;bottom:12px;top:auto;width:auto;border-radius:16px;padding:10px;z-index:9999}
      }
    `;
    document.head.appendChild(style);
  }

  const labelOf=(el)=>String(el?.textContent||el?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim().toLowerCase();
  const isAction=(el)=>/öffnen|erneut senden|mahnen|mahnung|bezahlt|qr öffnen|pdf öffnen|neu generieren|storno|gutschrift/.test(labelOf(el));
  const dedupe=(actions)=>{
    const seen=new Set();
    return actions.filter(action=>{
      const key=labelOf(action).replace(/^als /,'').replace(/^rechnung /,'');
      if(!key||seen.has(key)){action.style.display='none';return false;}
      seen.add(key);return true;
    });
  };

  function closeOtherMenus(current){
    document.querySelectorAll('details.vx-action-menu[open]').forEach(d=>{if(d!==current)d.removeAttribute('open');});
  }

  function buildGroup(container, rawActions){
    if(container.dataset.vxActionsV2==='1')return;
    const actions=dedupe(rawActions);
    if(actions.length<3)return;
    const openAction=actions.find(a=>/^öffnen$|rechnung öffnen/.test(labelOf(a)))||actions[0];
    const secondary=actions.filter(a=>a!==openAction);
    const group=document.createElement('div');
    group.className='vx-billing-actions-v2';
    openAction.parentNode.insertBefore(group,openAction);
    group.appendChild(openAction);
    const details=document.createElement('details');
    details.className='vx-action-menu';
    const summary=document.createElement('summary');
    summary.textContent='Aktionen';
    const pop=document.createElement('div');
    pop.className='vx-action-popover';
    secondary.forEach(action=>{
      if(/storno|gutschrift/.test(labelOf(action)))action.classList.add('danger');
      pop.appendChild(action);
    });
    details.append(summary,pop);
    details.addEventListener('toggle',()=>{if(details.open)closeOtherMenus(details);});
    group.appendChild(details);
    container.dataset.vxActionsV2='1';
  }

  function normalizeBillingRows(){
    const root=document.getElementById('billing-finance')||document.querySelector('[data-section="billing-finance"]');
    if(!root)return;
    root.querySelectorAll('tr, .invoice-row, [data-invoice-id]').forEach(row=>{
      const actions=[...row.querySelectorAll('button,a')].filter(isAction);
      if(actions.length<3)return;
      const container=actions[0].parentElement;
      if(container)buildGroup(container,actions);
    });
  }

  function normalizeInvoiceModal(){
    document.querySelectorAll('.modal').forEach(modal=>{
      const title=String(modal.textContent||'').toLowerCase();
      if(!title.includes('billing')&&!title.includes('rechnung'))return;
      const actions=dedupe([...modal.querySelectorAll('button,a')].filter(isAction));
      if(actions.length<4)return;
      const footer=actions[0].closest('.modal-footer')||actions[0].parentElement;
      if(!footer||footer.dataset.vxActionsV2==='1')return;
      const primary=actions.find(a=>/erneut senden/.test(labelOf(a)))||actions[0];
      const rest=actions.filter(a=>a!==primary);
      const wrap=document.createElement('div');wrap.className='vx-modal-actions-v2';
      footer.insertBefore(wrap,actions[0]);
      const details=document.createElement('details');details.className='vx-action-menu';
      const summary=document.createElement('summary');summary.textContent='Weitere Aktionen';
      const pop=document.createElement('div');pop.className='vx-action-popover';
      rest.forEach(a=>pop.appendChild(a));details.append(summary,pop);
      wrap.append(details,primary);footer.dataset.vxActionsV2='1';
    });
  }

  function run(){normalizeBillingRows();normalizeInvoiceModal();}
  const observer=new MutationObserver(()=>requestAnimationFrame(run));
  observer.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',event=>{
    if(!event.target.closest('.vx-action-menu'))document.querySelectorAll('details.vx-action-menu[open]').forEach(d=>d.removeAttribute('open'));
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();