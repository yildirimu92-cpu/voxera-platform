(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  function addStyles() {
    if (document.getElementById('voxera-admin-design-system-v3-css')) return;
    const style = document.createElement('style');
    style.id = 'voxera-admin-design-system-v3-css';
    style.textContent = `
      :root{
        --vx3-bg:#F4F7FB;
        --vx3-surface:#FFFFFF;
        --vx3-surface-soft:#F8FAFD;
        --vx3-line:#E5EAF2;
        --vx3-line-strong:#D6DEEA;
        --vx3-ink:#10213D;
        --vx3-muted:#6D7C91;
        --vx3-blue:#2167E8;
        --vx3-navy:#10264A;
        --vx3-success:#0F9F6E;
        --vx3-warning:#D38A00;
        --vx3-danger:#D83A3A;
        --vx3-radius:18px;
        --vx3-radius-sm:12px;
        --vx3-shadow:0 1px 2px rgba(16,33,61,.03),0 12px 34px rgba(16,33,61,.055);
        --vx3-shadow-hover:0 16px 42px rgba(16,33,61,.09);
      }
      html,body,.main{background:var(--vx3-bg)!important}
      body{color:var(--vx3-ink)!important}
      .content{max-width:1480px!important;padding-top:24px!important}
      .card,.bf-panel,.bf-block,.settings-card,.profile-card,.customer-section-shell,
      .customer-workspace-section,.offer-card,.offer-header-card,.vx-payment-account-card{
        background:var(--vx3-surface)!important;border:1px solid var(--vx3-line)!important;
        border-radius:var(--vx3-radius)!important;box-shadow:var(--vx3-shadow)!important;overflow:hidden
      }
      .card:hover,.settings-card:hover,.profile-card:hover,.customer-section-shell:hover{box-shadow:var(--vx3-shadow-hover)!important}
      .card-header,.settings-card-header,.bf-panel-header,.vx-unified-head{
        padding:18px 22px!important;min-height:64px!important;
        background:linear-gradient(180deg,#FFFFFF 0%,#FBFCFE 100%)!important;
        border-bottom:1px solid var(--vx3-line)!important;color:var(--vx3-ink)!important
      }
      .card-header h2,.card-header h3,.settings-card-header h2,.settings-card-header h3,
      .bf-panel-header h2,.bf-panel-header h3,.vx-unified-head h2,.vx-unified-head h3{
        color:var(--vx3-ink)!important;font-size:16px!important;font-weight:760!important;letter-spacing:-.02em!important
      }
      .card-body,.settings-card-body,.bf-panel-body{padding:22px!important}
      .section-title,.card-title,.panel-title{color:var(--vx3-ink)!important;font-weight:760!important}
      .section-subtitle,.muted,.helper-text,.field-help{color:var(--vx3-muted)!important}
      input:not([type=checkbox]):not([type=radio]),select,textarea,.input,.select{
        min-height:44px!important;padding:10px 13px!important;border:1px solid var(--vx3-line-strong)!important;
        border-radius:11px!important;background:#fff!important;color:var(--vx3-ink)!important;
        font-size:14px!important;box-shadow:inset 0 1px 0 rgba(16,33,61,.02)!important
      }
      textarea{min-height:112px!important;line-height:1.5!important}
      label,.field-label{display:block;color:#74839A!important;font-size:12px!important;font-weight:700!important;margin-bottom:7px!important}
      input:focus,select:focus,textarea:focus{border-color:#79A7F5!important;box-shadow:0 0 0 4px rgba(33,103,232,.10)!important}
      .btn,button.btn,a.btn{min-height:42px!important;padding:9px 16px!important;border-radius:11px!important;font-size:13px!important;font-weight:720!important;box-shadow:none!important}
      .btn-primary,button.btn-primary{background:var(--vx3-blue)!important;border-color:var(--vx3-blue)!important;box-shadow:0 8px 18px rgba(33,103,232,.18)!important}
      .btn-secondary,.btn:not(.btn-primary):not(.btn-danger){background:#fff!important;border-color:var(--vx3-line)!important;color:var(--vx3-ink)!important}
      .btn-danger{background:#FFF4F4!important;border-color:#FFCACA!important;color:var(--vx3-danger)!important}
      .toolbar,.filter-bar,.vx-toolbar{padding:12px!important;border-radius:14px!important;background:#fff!important;border:1px solid var(--vx3-line)!important;box-shadow:var(--vx3-shadow)!important}
      .module-tabs,.bf-tabs,.segmented,.tab-bar{background:#EAF0F7!important;border:1px solid #DDE5EF!important;border-radius:13px!important;padding:5px!important}
      .module-tab,.bf-tab,.segmented>button,.tab-bar>button{min-height:38px!important;padding:8px 16px!important;border-radius:9px!important}
      .module-tab.active,.bf-tab-active,.segmented>button.active,.tab-bar>button.active{background:#fff!important;color:var(--vx3-ink)!important;box-shadow:0 3px 10px rgba(16,33,61,.09)!important}
      table{border-collapse:separate!important;border-spacing:0!important}
      thead th{background:#F6F8FC!important;color:#74839A!important;font-size:11px!important;font-weight:760!important;letter-spacing:.05em!important}
      tbody td{border-bottom:1px solid #EDF1F6!important}tbody tr:hover{background:#FAFCFF!important}
      .badge,[class*=badge],.status-pill{border-radius:999px!important;font-weight:720!important}
      #section-settings .grid-4,#section-settings [style*="grid-template-columns: repeat(4"],#section-settings [style*="grid-template-columns:repeat(4"]{gap:16px!important;align-items:start!important}
      #section-settings .grid-4>*,#section-settings [style*="grid-template-columns: repeat(4"]>*{border:1px solid var(--vx3-line)!important;border-radius:16px!important;background:#fff!important;box-shadow:0 8px 24px rgba(16,33,61,.045)!important;padding:18px!important}
      #section-settings textarea{resize:vertical!important}
      #section-settings input[type=checkbox]{width:18px!important;height:18px!important;accent-color:var(--vx3-blue)!important}
      #section-customers .customer-card,#section-customers .customer-row-card{border:1px solid var(--vx3-line)!important;border-radius:18px!important;box-shadow:var(--vx3-shadow)!important;overflow:hidden!important}
      #section-customers .customer-card-header,#section-customers .customer-row-card>header{padding:18px 20px!important;background:var(--vx3-navy)!important;color:#fff!important}
      #section-customers .customer-card-body{padding:20px!important}
      .vx-empty-state,.vx-empty-cell{min-height:180px!important;padding:36px 22px!important;background:linear-gradient(180deg,#fff 0%,#FAFCFF 100%)!important}
      .card,.settings-card,.profile-card,.customer-section-shell,.btn,input,select,textarea{transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease,background-color .16s ease!important}
      @media(max-width:1100px){
        #section-settings .grid-4,#section-settings [style*="grid-template-columns: repeat(4"],#section-settings [style*="grid-template-columns:repeat(4"]{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      }
      @media(max-width:760px){
        :root{--vx3-radius:14px}.content{padding:14px 10px 32px!important}
        .card-header,.settings-card-header,.bf-panel-header,.vx-unified-head{padding:15px!important;min-height:56px!important}
        .card-body,.settings-card-body,.bf-panel-body{padding:15px!important}
        #section-settings .grid-4,#section-settings [style*="grid-template-columns: repeat(4"],#section-settings [style*="grid-template-columns:repeat(4"]{grid-template-columns:minmax(0,1fr)!important}
        .btn,button.btn,a.btn{width:100%!important}
      }
    `;
    document.head.appendChild(style);
  }
  function markPaymentCardAsReference(){
    const heading=Array.from(document.querySelectorAll('h1,h2,h3,strong')).find(node=>/Zahlungskonto\s*&\s*QR-Rechnung/i.test(node.textContent||''));
    if(!heading)return;const card=heading.closest('.card,.settings-card,.bf-panel,section,article');if(card)card.classList.add('vx-payment-account-card');
  }
  function tick(){addStyles();markPaymentCardAsReference()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
  w.addEventListener('hashchange',()=>setTimeout(tick,80));setInterval(tick,1200);
})(typeof globalThis!=='undefined'?globalThis:window);
