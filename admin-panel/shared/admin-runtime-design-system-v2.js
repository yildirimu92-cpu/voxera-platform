(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete'
    ? setTimeout(fn, 0)
    : w.addEventListener('load', fn, { once:true });

  function addCss() {
    if (document.getElementById('voxera-admin-design-system-v2-css')) return;
    const style = document.createElement('style');
    style.id = 'voxera-admin-design-system-v2-css';
    style.textContent = `
      :root{
        --vx-admin-bg:#F4F6F9;
        --vx-admin-surface:#FFFFFF;
        --vx-admin-surface-soft:#F8FAFC;
        --vx-admin-border:#E3E8F0;
        --vx-admin-border-strong:#D5DCE7;
        --vx-admin-ink:#10213D;
        --vx-admin-muted:#66758B;
        --vx-admin-muted-soft:#98A2B3;
        --vx-admin-radius:14px;
        --vx-admin-radius-sm:10px;
        --vx-admin-shadow:0 1px 2px rgba(15,23,42,.03),0 8px 28px rgba(15,23,42,.035);
        --vx-admin-shadow-raised:0 12px 32px rgba(15,23,42,.08);
        --vx-admin-control-h:38px;
        --vx-admin-content-max:1440px;
      }

      html,body{background:var(--vx-admin-bg)!important}
      body{color:var(--vx-admin-ink)!important}
      .main{background:var(--vx-admin-bg)!important;min-width:0!important}
      .content{
        width:100%!important;max-width:var(--vx-admin-content-max)!important;
        margin:0 auto!important;padding:22px 26px 42px!important;
      }
      .topbar{
        min-height:68px!important;padding:14px 26px!important;
        background:rgba(255,255,255,.92)!important;
        border-bottom:1px solid rgba(213,220,231,.82)!important;
        box-shadow:0 1px 0 rgba(15,23,42,.015)!important;
      }
      .page-title{font-size:18px!important;font-weight:750!important;color:var(--vx-admin-ink)!important}
      .page-sub{font-size:12px!important;color:var(--vx-admin-muted)!important}

      .card,.bf-panel,.bf-block,.customer-section-shell,.customer-workspace-section,
      .offer-card,.offer-header-card,.profile-card,.settings-card{
        background:var(--vx-admin-surface)!important;
        border:1px solid var(--vx-admin-border)!important;
        border-radius:var(--vx-admin-radius)!important;
        box-shadow:var(--vx-admin-shadow)!important;
      }
      .card,.bf-panel,.bf-block,.customer-section-shell,.customer-workspace-section{margin-bottom:16px!important}

      .vx-unified-head{
        min-height:52px!important;padding:13px 16px!important;margin:0!important;
        display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;
        background:linear-gradient(180deg,#FFFFFF 0%,#FBFCFE 100%)!important;
        color:var(--vx-admin-ink)!important;
        border:0!important;border-bottom:1px solid var(--vx-admin-border)!important;
        border-radius:var(--vx-admin-radius) var(--vx-admin-radius) 0 0!important;
        box-shadow:none!important;
      }
      .vx-unified-head h1,.vx-unified-head h2,.vx-unified-head h3,
      .vx-unified-head strong,.vx-unified-head .card-title{
        color:var(--vx-admin-ink)!important;text-shadow:none!important;
      }
      .vx-unified-head h2,.vx-unified-head h3{font-size:14px!important;font-weight:750!important;letter-spacing:-.015em!important}
      .vx-unified-head .card-title{
        font-size:13px!important;font-weight:750!important;letter-spacing:-.015em!important;
        text-transform:none!important;margin:0!important;
      }
      .vx-unified-head p,.vx-unified-head small,.vx-unified-head .muted{
        color:var(--vx-admin-muted)!important;
      }
      .vx-unified-head .badge,.vx-unified-head [class*="badge"]{text-shadow:none!important}

      .module-tabs,.bf-tabs,.profile-tabs,.vx-module-tabs,.segmented,.tab-bar{
        display:flex!important;align-items:center!important;gap:4px!important;
        width:max-content;max-width:100%!important;
        padding:4px!important;margin-bottom:16px!important;
        border:1px solid var(--vx-admin-border)!important;border-radius:11px!important;
        background:#EEF2F7!important;box-shadow:none!important;
      }
      .module-tab,.bf-tab,.profile-tab,.vx-module-tab,
      .vx-module-tabs>button,.segmented>button,.tab-bar>button{
        min-height:34px!important;padding:7px 13px!important;border:0!important;border-radius:8px!important;
        background:transparent!important;color:#718096!important;
        font-size:12px!important;font-weight:650!important;line-height:1.2!important;
        white-space:nowrap!important;margin:0!important;box-shadow:none!important;
      }
      .module-tab.active,.module-tab[aria-selected="true"],.bf-tab-active,.profile-tab.active,
      .vx-module-tab.active,.vx-module-tab[aria-selected="true"],
      .segmented>button.active,.tab-bar>button.active{
        background:#FFFFFF!important;color:var(--vx-admin-ink)!important;
        box-shadow:0 1px 3px rgba(15,23,42,.10)!important;
      }

      .toolbar,.filter-bar,.vx-toolbar{
        min-height:56px!important;padding:10px 12px!important;gap:8px!important;
        background:var(--vx-admin-surface-soft)!important;
        border:1px solid var(--vx-admin-border)!important;border-radius:12px!important;
        box-shadow:none!important;
      }
      input,select,textarea,.input,.select{
        border-color:var(--vx-admin-border-strong)!important;
        border-radius:9px!important;background:#FFFFFF!important;color:var(--vx-admin-ink)!important;
        box-shadow:none!important;
      }
      input:not([type="checkbox"]):not([type="radio"]),select,.input,.select{
        min-height:var(--vx-admin-control-h)!important;
      }
      input:focus,select:focus,textarea:focus,.input:focus,.select:focus{
        border-color:#73A7F3!important;box-shadow:0 0 0 3px rgba(26,111,232,.10)!important;outline:none!important;
      }
      .btn,button.btn{
        min-height:36px;border-radius:9px!important;font-weight:650!important;
        transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease!important;
      }
      .btn:hover,button.btn:hover{transform:translateY(-1px)}
      .btn-primary,button.btn-primary{box-shadow:0 4px 12px rgba(26,111,232,.16)!important}

      .data-table thead th,.bf-invoice-table thead th{
        background:#F7F9FC!important;color:#718096!important;
        font-size:10px!important;font-weight:750!important;letter-spacing:.055em!important;
        border-bottom:1px solid var(--vx-admin-border)!important;
      }
      .data-table tbody td,.bf-invoice-table tbody td{border-bottom-color:#EDF1F6!important}
      .data-table tbody tr:hover,.bf-invoice-table tbody tr:hover{background:#FAFCFF!important}

      #overview-kpis,#onboarding-kpis,#finance-kpi-strip{
        border:1px solid var(--vx-admin-border)!important;border-radius:var(--vx-admin-radius)!important;
        background:#FFFFFF!important;box-shadow:var(--vx-admin-shadow)!important;
      }
      #overview-kpis>*,#onboarding-kpis>*,#finance-kpi-strip>*{
        position:relative;background:#FFFFFF!important;box-shadow:none!important;
      }
      #overview-kpis>:nth-child(1),#onboarding-kpis>:nth-child(1),#finance-kpi-strip>:nth-child(1){box-shadow:inset 0 3px 0 #10B981!important}
      #overview-kpis>:nth-child(2),#onboarding-kpis>:nth-child(2),#finance-kpi-strip>:nth-child(2){box-shadow:inset 0 3px 0 #E8C547!important}
      #overview-kpis>:nth-child(3),#onboarding-kpis>:nth-child(3),#finance-kpi-strip>:nth-child(3){box-shadow:inset 0 3px 0 #1A6FE8!important}

      .vx-empty-state,.vx-empty-cell{
        min-height:132px!important;padding:28px 18px!important;
        display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;
        gap:7px!important;text-align:center!important;color:var(--vx-admin-muted)!important;
        background:linear-gradient(180deg,#FFFFFF 0%,#FBFCFE 100%)!important;
      }
      .vx-empty-state::before,.vx-empty-cell::before{
        content:'';display:block;width:34px;height:34px;border-radius:11px;
        background:radial-gradient(circle at 38% 34%,#FFFFFF 0 14%,transparent 15%),#EEF3F9;
        border:1px solid #DFE6F0;box-shadow:inset 0 0 0 7px #F8FAFC;
      }
      .vx-empty-state.vx-empty-success::before,.vx-empty-cell.vx-empty-success::before{
        content:'✓';display:grid;place-items:center;background:#ECFDF5;border-color:#A7F3D0;
        box-shadow:none;color:#059669;font-size:18px;font-weight:800;
      }

      #section-ai-setup .card,#section-ai-setup .bf-panel{max-width:none!important}
      #section-ai-setup .vx-empty-state{min-height:180px!important}
      #section-settings .grid-2{align-items:start!important}
      #section-settings .card{height:auto!important}

      @media(max-width:1024px){
        .sidebar{
          width:min(300px,86vw)!important;transform:translateX(-100%)!important;
          z-index:320!important;box-shadow:none!important;
        }
        .sidebar.open{transform:translateX(0)!important;box-shadow:8px 0 34px rgba(15,23,42,.20)!important}
        .main{margin-left:0!important;width:100%!important}
        .mobile-menu-btn{display:flex!important;align-items:center!important;justify-content:center!important}
        .topbar-brand{display:flex!important}
        .sidebar-overlay{z-index:310!important}
        .content{padding-left:20px!important;padding-right:20px!important}
      }

      @media(max-width:768px){
        :root{--vx-admin-radius:12px;--vx-admin-radius-sm:9px}
        html,body,.app,.main,.content,.section{width:100%!important;max-width:100%!important;min-width:0!important}
        body{overflow-x:hidden!important}
        .topbar{
          min-height:60px!important;padding:10px 12px!important;gap:8px!important;
          align-items:center!important;
        }
        .topbar-left{min-width:0!important;gap:9px!important}
        .topbar-right{gap:6px!important}
        .topbar-right .status-pill{display:none!important}
        .page-title{font-size:16px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        .page-sub{display:none!important}
        .content{padding:12px 10px calc(28px + var(--mobile-bottom-spacing,0px))!important}

        .card,.bf-panel,.bf-block,.customer-section-shell,.customer-workspace-section,
        .offer-card,.offer-header-card,.profile-card,.settings-card{
          width:100%!important;max-width:100%!important;min-width:0!important;
          border-radius:12px!important;margin-bottom:12px!important;
        }
        .vx-unified-head{
          min-height:48px!important;padding:12px 13px!important;
          align-items:flex-start!important;flex-direction:column!important;
        }
        .vx-unified-head>.inline-actions,.vx-unified-head>.actions,.vx-unified-head>[class*="actions"]{
          width:100%!important;display:grid!important;grid-template-columns:1fr!important;gap:8px!important;
        }
        .vx-unified-head>.inline-actions .btn,.vx-unified-head>.actions .btn,.vx-unified-head>[class*="actions"] .btn{width:100%!important}

        .grid-2,.grid-3,.grid-4,.offer-columns,.offer-editor,.profile-overview-grid,
        .profile-action-grid,.modal-grid-2,.settings-grid,.admin-settings-grid{
          grid-template-columns:minmax(0,1fr)!important;
        }
        [style*="grid-template-columns: 1fr 1fr"],[style*="grid-template-columns:1fr 1fr"],
        [style*="grid-template-columns: repeat(2"],[style*="grid-template-columns:repeat(2"]{
          grid-template-columns:minmax(0,1fr)!important;
        }
        .kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
        #overview-kpis,#onboarding-kpis,#finance-kpi-strip{grid-template-columns:minmax(0,1fr)!important}
        #overview-kpis>*+*,#onboarding-kpis>*+*,#finance-kpi-strip>*+*{
          border-left:0!important;border-top:1px solid var(--vx-admin-border)!important;
        }
        #overview-kpis>:nth-child(3),#onboarding-kpis>:nth-child(3),#finance-kpi-strip>:nth-child(3){grid-column:auto!important}

        .module-tabs,.bf-tabs,.profile-tabs,.vx-module-tabs,.segmented,.tab-bar{
          width:100%!important;max-width:100%!important;overflow-x:auto!important;overflow-y:hidden!important;
          justify-content:flex-start!important;-webkit-overflow-scrolling:touch!important;scrollbar-width:none!important;
        }
        .module-tabs::-webkit-scrollbar,.bf-tabs::-webkit-scrollbar,.profile-tabs::-webkit-scrollbar,
        .vx-module-tabs::-webkit-scrollbar,.segmented::-webkit-scrollbar,.tab-bar::-webkit-scrollbar{display:none!important}
        .module-tab,.bf-tab,.profile-tab,.vx-module-tab,.vx-module-tabs>button{flex:0 0 auto!important}

        .toolbar,.filter-bar,.vx-toolbar{
          display:grid!important;grid-template-columns:minmax(0,1fr)!important;
          width:100%!important;padding:10px!important;gap:8px!important;
        }
        .toolbar>*,.filter-bar>*,.vx-toolbar>*,
        .toolbar input,.toolbar select,.toolbar button,
        .filter-bar input,.filter-bar select,.filter-bar button{
          width:100%!important;max-width:100%!important;min-width:0!important;
        }
        .inline-actions{max-width:100%!important;flex-wrap:wrap!important}
        .inline-actions>.btn,.inline-actions>button{flex:1 1 150px!important}

        .modal-overlay{padding:0!important;align-items:flex-end!important}
        .modal,.billing-dialog,.vox-support-modal{
          width:100%!important;max-width:100%!important;max-height:calc(100dvh - var(--safe-top))!important;
          border-radius:18px 18px 0 0!important;margin:0!important;
          overflow-y:auto!important;overflow-x:hidden!important;
        }
        .modal-body,.billing-dialog-body{padding-left:14px!important;padding-right:14px!important;overflow-x:hidden!important}

        .table-wrap,.bf-invoice-table-wrap,.ai-queue-table-wrap{width:100%!important;max-width:100%!important}
        table.vox-mobile-table tbody tr{border-radius:11px!important;box-shadow:none!important}
        table.vox-mobile-table tbody td{grid-template-columns:minmax(86px,34%) minmax(0,66%)!important;gap:8px!important}

        #section-customers>div:first-child{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
        #cw-header{padding:14px!important}
        #cw-actions{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:8px!important}
        #cw-actions>*{width:100%!important}
      }

      @media(max-width:480px){
        .content{padding-left:8px!important;padding-right:8px!important}
        .kpi-grid{grid-template-columns:minmax(0,1fr)!important}
        #section-customers>div:first-child{grid-template-columns:minmax(0,1fr)!important}
        .inline-actions>.btn,.inline-actions>button{flex-basis:100%!important;width:100%!important}
        table.vox-mobile-table tbody td{grid-template-columns:minmax(0,1fr)!important;gap:4px!important}
        table.vox-mobile-table tbody td::before{margin-bottom:1px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function shouldUnifyHead(head) {
    if (!head || head.dataset.vxKeepDark === 'true') return false;
    if (head.closest('.sidebar,.modal,.billing-dialog,.vox-support-modal,#db-loading-overlay')) return false;
    return Boolean(head.closest('.card,.bf-panel,.bf-block,.customer-section-shell,.customer-workspace-section,.offer-card,.profile-card,#section-cases,#section-ai-setup,#section-insights,#section-settings'));
  }

  function patchHeads(root) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll('.card-head,.section-head,.bf-panel-head,.bf-block-head,.customer-section-head').forEach(head => {
      if (shouldUnifyHead(head)) head.classList.add('vx-unified-head');
    });
    if (scope.matches?.('.card-head,.section-head,.bf-panel-head,.bf-block-head,.customer-section-head') && shouldUnifyHead(scope)) {
      scope.classList.add('vx-unified-head');
    }
  }

  function patchTabs(root) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll('.module-tabs,.bf-tabs,.profile-tabs,.segmented,.tab-bar').forEach(tabs => {
      tabs.classList.add('vx-module-tabs');
      [...tabs.children].forEach(child => {
        if (child.matches('button,[role="tab"],.module-tab,.bf-tab,.profile-tab')) child.classList.add('vx-module-tab');
      });
    });
  }

  function emptyText(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function patchEmptyStates(root) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll('.empty,.empty-state,.bf-empty,.ai-empty,.customer-empty,.cases-empty').forEach(node => {
      node.classList.add('vx-empty-state');
      if (/alles erledigt|nichts offen|kein handlungsbedarf/i.test(emptyText(node))) node.classList.add('vx-empty-success');
    });
    scope.querySelectorAll('td[colspan],.table-empty').forEach(node => {
      const text = emptyText(node);
      if (!/^(keine|kein|noch keine|nichts|alles erledigt)/i.test(text)) return;
      node.classList.add('vx-empty-cell');
      if (/alles erledigt|nichts offen|kein handlungsbedarf/i.test(text)) node.classList.add('vx-empty-success');
    });
  }

  function patchToolbars(root) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll('.toolbar,.filter-bar').forEach(node => node.classList.add('vx-toolbar'));
  }

  function setRouteMarker() {
    const route = String(location.hash || '#overview').replace(/^#/, '').split(/[?&]/)[0] || 'overview';
    document.body.dataset.vxAdminRoute = route;
  }

  function updateViewportHeight() {
    document.documentElement.style.setProperty('--app-dvh', `${w.innerHeight}px`);
  }

  function closeTabletDrawer() {
    if (w.innerWidth <= 1024) return;
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.sidebar-overlay')?.classList.remove('open');
    document.body.classList.remove('mobile-nav-lock');
  }

  function patch(root) {
    patchHeads(root);
    patchTabs(root);
    patchEmptyStates(root);
    patchToolbars(root);
  }

  ready(() => {
    addCss();
    updateViewportHeight();
    setRouteMarker();
    patch(document);

    let timer = null;
    const observer = new MutationObserver(records => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        records.forEach(record => record.addedNodes.forEach(node => {
          if (node.nodeType === 1) patch(node);
        }));
        patch(document);
      }, 40);
    });
    observer.observe(document.body, { childList:true, subtree:true });

    w.addEventListener('hashchange', () => {
      setRouteMarker();
      setTimeout(() => patch(document), 0);
    }, { passive:true });
    w.addEventListener('resize', () => {
      updateViewportHeight();
      closeTabletDrawer();
    }, { passive:true });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
