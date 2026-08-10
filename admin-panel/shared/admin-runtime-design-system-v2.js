/**
 * Design-System v2 — Rest nach Welle 2.
 *
 * Der Kartenkopf, die Karte selbst, Formularfelder, Knoepfe, Reiter und
 * Tabellen sind nach shared/admin-components.css gewandert; die Farbwerte
 * stehen in shared/admin-design-tokens.css. Was hier noch steht, sind
 * Regeln fuer Bereiche, die Welle 3 bis 5 ohnehin anfassen (Reiterleisten,
 * Leerzustaende, KPI-Streifen, Bildschirmhoehe).
 *
 * Aenderung in Welle 2: die Beschriftungsfarbe #718096 lag bei 3.6:1 auf
 * hellem Grund und damit unter der Lesbarkeitsschwelle. Sie ist auf #5D6B80
 * angehoben — derselbe Wert wie --vx-admin-label.
 */
(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete'
    ? setTimeout(fn, 0)
    : w.addEventListener('load', fn, { once:true });

  // Das Aussehen steht seit Welle 2 in shared/admin-layout.css. Hier bleibt
  // nur die DOM-Arbeit: Klassen anhaengen, Bildschirmhoehe messen, Schublade
  // schliessen. → Welle 3 bringt die Klassen ins Markup, dann entfaellt auch das.


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
