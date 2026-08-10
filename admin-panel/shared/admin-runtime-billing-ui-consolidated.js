(function billingUiConsolidated(){
  'use strict';

  const ROOT_ID='billing-finance';
  const STYLE_ID='voxera-billing-ui-consolidated-style';
  const ACTION_RE=/öffnen|erneut senden|mahnen|mahnung|bezahlt|qr öffnen|pdf öffnen|neu generieren|storno|gutschrift/i;
  let lastReminderLevel='';

  const labelOf=el=>String(el?.textContent||el?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
  const keyOf=el=>labelOf(el).toLowerCase();

  // Die Stilregeln dieser Datei stehen seit Welle 2 Teil 3 in
  // shared/admin-screens.css. Die Funktion installStyles() und ihr Aufruf sind
  // entfallen -- ein zur Laufzeit eingefuegtes Stylesheet gewann nur deshalb,
  // weil es zuletzt kam, und brauchte dafuer !important.

  function dedupe(actions){
    const seen=new Set();
    return actions.filter(action=>{
      const key=keyOf(action).replace(/^rechnung /,'').replace(/^als /,'');
      if(!key||seen.has(key)){action.remove();return false;}
      seen.add(key);return true;
    });
  }

  function makeMenu(actions,label='Aktionen'){
    const wrap=document.createElement('div');wrap.className='vx-billing-menu';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='vx-billing-menu-toggle';toggle.textContent=label;
    const panel=document.createElement('div');panel.className='vx-billing-menu-panel';
    actions.forEach(action=>panel.appendChild(action));
    toggle.addEventListener('click',event=>{
      event.stopPropagation();
      document.querySelectorAll('.vx-billing-menu.open').forEach(menu=>{if(menu!==wrap)menu.classList.remove('open');});
      wrap.classList.toggle('open');
    });
    wrap.append(toggle,panel);return wrap;
  }

  function findActionCell(row,actions){
    const cells=[...row.querySelectorAll(':scope > td,:scope > [role="cell"]')];
    return cells.find(cell=>actions.some(action=>cell.contains(action)))||cells.at(-1)||actions[0]?.parentElement;
  }

  function normalizeRows(){
    // The canonical invoice table already renders the four approved actions.
    // Do not move or wrap them in secondary runtime menus.
  }

  function cleanEmptyState(){
    document.querySelectorAll('section,div').forEach(box=>{
      if(!/alles erledigt/i.test(String(box.textContent||'')))return;
      const checks=[...box.querySelectorAll('span,div,p,i,svg')].filter(el=>/^✓$/.test(String(el.textContent||'').trim())||String(el.getAttribute?.('data-icon')||'').includes('check'));
      checks.slice(1).forEach(el=>el.remove());
    });
  }

  function cleanResendModal(modal){
    const text=String(modal.textContent||'');
    if(!/rechnung erneut versenden/i.test(text))return;
    modal.classList.add('vx-resend-modal-clean');
    [...modal.querySelectorAll('div,tr,section')].forEach(row=>{
      if(/zahlungslink/i.test(String(row.textContent||''))&&/nicht hinterlegt/i.test(String(row.textContent||'')))row.classList.add('vx-payment-link-row');
    });
  }

  function guideReminderModal(modal){
    if(!/mahnung versenden/i.test(String(modal.textContent||'')))return;
    const l1=[...modal.querySelectorAll('button,label,div')].find(el=>/L1\s*·\s*Erste Mahnung/i.test(String(el.textContent||'')));
    const l2=[...modal.querySelectorAll('button,label,div')].find(el=>/L2\s*·\s*Letzte Warnung/i.test(String(el.textContent||'')));
    if(!lastReminderLevel)return;
    if(!modal.querySelector('.vx-guided-reminder-note')){
      const note=document.createElement('div');note.className='vx-guided-reminder-note';
      note.textContent=lastReminderLevel==='L1'?'Die erste Mahnung wurde bereits versendet. Als nächster Schritt ist nur noch die letzte Mahnung verfügbar.':'Die letzte Mahnung wurde bereits versendet. Eine weitere Mahnung ist nicht vorgesehen.';
      const target=[...modal.querySelectorAll('h1,h2,h3')].at(-1)?.parentElement||modal.firstElementChild;
      target?.appendChild(note);
    }
    if(l1)l1.classList.add('vx-reminder-disabled');
    if(lastReminderLevel==='L2'&&l2)l2.classList.add('vx-reminder-disabled');
  }

  function normalizeInvoiceDetail(_modal){
    // Invoice detail actions are rendered canonically in index.html.
  }

  let scheduled=false;
  function run(){
    scheduled=false;normalizeRows();cleanEmptyState();
    document.querySelectorAll('.modal,[role="dialog"]').forEach(modal=>{cleanResendModal(modal);guideReminderModal(modal);normalizeInvoiceDetail(modal);});
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(run);}

  document.addEventListener('click',event=>{
    const reminderButton=event.target.closest('button,a,.btn');
    if(reminderButton&&/mahnung/i.test(labelOf(reminderButton))){
      const context=reminderButton.closest('.modal,tr,.invoice-row,[data-invoice-id]');
      const text=String(context?.textContent||'');
      lastReminderLevel=/mahnstufe\s*L2|letzte warnung/i.test(text)?'L2':/mahnstufe\s*L1|mahnung L1/i.test(text)?'L1':'';
    }
    if(!event.target.closest('.vx-billing-menu'))document.querySelectorAll('.vx-billing-menu.open').forEach(menu=>menu.classList.remove('open'));
    setTimeout(schedule,40);
  },true);
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
})();
