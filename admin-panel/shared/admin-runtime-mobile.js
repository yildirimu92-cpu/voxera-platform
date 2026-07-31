(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete'
    ? setTimeout(fn, 0)
    : w.addEventListener('load', fn, { once: true });

  function addCss() {
    if (document.getElementById('voxera-admin-mobile-css')) return;
    const style = document.createElement('style');
    style.id = 'voxera-admin-mobile-css';
    style.textContent = `
      @media(max-width:768px){
        html,body{width:100%!important;max-width:100%!important;overflow-x:hidden!important}
        body,.app,.main,.content,.section,.card,.table-wrap,.bf-panel,.customer-section-shell{
          min-width:0!important;max-width:100%!important
        }
        .main{width:100%!important}
        .content{width:100%!important;padding:14px 12px calc(24px + var(--mobile-bottom-spacing,0px))!important}
        .section{width:100%!important}
        .card,.bf-panel,.customer-section-shell{overflow:hidden!important}
        .grid-2,.grid-3,.grid-4,.kpi-grid,.offer-columns,.offer-editor,
        .modal-grid-2,.profile-overview-grid,.profile-action-grid,
        [style*="grid-template-columns:repeat(2"],[style*="grid-template-columns: repeat(2"],
        [style*="grid-template-columns:1fr 1fr"],[style*="grid-template-columns: 1fr 1fr"]{
          grid-template-columns:minmax(0,1fr)!important
        }
        .toolbar,.inline-actions,.section-head,.card-head,.bf-panel-head{
          max-width:100%!important;min-width:0!important;flex-wrap:wrap!important
        }
        .toolbar{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:8px!important;padding:12px!important}
        .toolbar>*,.toolbar input,.toolbar select,.toolbar button,
        .inline-actions>*,.inline-actions input,.inline-actions select{
          width:100%!important;max-width:100%!important;min-width:0!important
        }
        input,select,textarea,.input,.select{max-width:100%!important;min-width:0!important}
        button,.btn{max-width:100%;white-space:normal!important}
        .tabs,.segmented,.tab-bar{max-width:100%!important;overflow-x:auto!important;overflow-y:hidden!important;-webkit-overflow-scrolling:touch;scrollbar-width:none}
        .tabs::-webkit-scrollbar,.segmented::-webkit-scrollbar,.tab-bar::-webkit-scrollbar{display:none}
        .modal-overlay{padding:8px!important;align-items:flex-end!important}
        .modal,.billing-dialog,.vox-support-modal{
          width:100%!important;max-width:100%!important;max-height:calc(100dvh - 16px)!important;
          border-radius:16px 16px 0 0!important;overflow-y:auto!important;overflow-x:hidden!important
        }
        .modal-body,.billing-dialog-body{overflow-x:hidden!important}
        img,svg,canvas,video{max-width:100%;height:auto}
        pre,code{max-width:100%;overflow-wrap:anywhere;white-space:pre-wrap}
        .table-wrap{width:100%!important;overflow:visible!important;border:0!important;box-shadow:none!important;background:transparent!important}
        table.data-table,table.vox-mobile-table{
          display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;
          border:0!important;background:transparent!important
        }
        table.vox-mobile-table thead{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important}
        table.vox-mobile-table tbody{display:block!important;width:100%!important}
        table.vox-mobile-table tbody tr{
          display:block!important;width:100%!important;max-width:100%!important;
          margin:0 0 10px!important;padding:6px 12px!important;
          border:1px solid var(--line)!important;border-radius:12px!important;background:#fff!important;
          box-shadow:0 1px 2px rgba(15,23,42,.04)!important
        }
        table.vox-mobile-table tbody td{
          display:grid!important;grid-template-columns:minmax(92px,35%) minmax(0,65%)!important;
          gap:10px!important;align-items:start!important;width:100%!important;max-width:100%!important;
          min-width:0!important;padding:10px 0!important;border:0!important;border-bottom:1px solid var(--line2)!important;
          white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important
        }
        table.vox-mobile-table tbody td:last-child{border-bottom:0!important}
        table.vox-mobile-table tbody td::before{
          content:attr(data-mobile-label);font-size:10px;font-weight:700;line-height:1.35;
          color:var(--slate2);text-transform:uppercase;letter-spacing:.055em
        }
        table.vox-mobile-table tbody td[data-mobile-label=""]{display:block!important}
        table.vox-mobile-table tbody td[data-mobile-label=""]::before{display:none!important}
        table.vox-mobile-table tbody td[colspan]{display:block!important}
        table.vox-mobile-table tbody td[colspan]::before{display:none!important}
        table.vox-mobile-table tbody td .btn,
        table.vox-mobile-table tbody td select,
        table.vox-mobile-table tbody td input{width:100%!important;max-width:100%!important}
        .list-item{align-items:flex-start!important;flex-direction:column!important}
        .list-item>.btn,.list-item>button{width:100%!important}
        #cw-header{display:block!important;padding:16px!important}
        #cw-actions{width:100%!important;margin-top:14px!important;display:grid!important;grid-template-columns:1fr!important}
        #cw-actions>*{width:100%!important}
        #cw-kpis{grid-template-columns:1fr!important}
        #offer-detail-shell,#offers-workspace,#section-customers,#section-onboarding,#section-billing-finance,#section-cases,#section-ai-setup{max-width:100%!important;overflow-x:hidden!important}
      }
    `;
    document.head.appendChild(style);
  }

  function labelTable(table) {
    if (!table || table.dataset.mobilePrepared === '1') return;
    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!headers.length) return;
    table.classList.add('vox-mobile-table');
    table.dataset.mobilePrepared = '1';
    [...table.querySelectorAll('tbody tr')].forEach(row => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName !== 'TD') return;
        cell.dataset.mobileLabel = cell.colSpan > 1 ? '' : (headers[index] || '');
      });
    });
  }

  function prepareTables(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('table').forEach(labelTable);
    if (scope.matches?.('table')) labelTable(scope);
  }

  function refreshDynamicRows(root) {
    const table = root?.closest?.('table') || (root?.matches?.('table') ? root : null);
    if (!table) return;
    delete table.dataset.mobilePrepared;
    [...table.querySelectorAll('tbody td')].forEach(cell => delete cell.dataset.mobileLabel);
    labelTable(table);
  }

  ready(() => {
    addCss();
    prepareTables(document);

    let timer = null;
    const observer = new MutationObserver(records => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        records.forEach(record => {
          record.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            prepareTables(node);
            refreshDynamicRows(node);
          });
          if (record.target?.nodeType === 1) refreshDynamicRows(record.target);
        });
        prepareTables(document);
      }, 30);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    w.addEventListener('resize', () => {
      if (w.innerWidth <= 768) prepareTables(document);
    }, { passive: true });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
