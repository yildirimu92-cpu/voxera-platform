(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  let patchScheduled = false;

  function setTextIfChanged(node, value) {
    const next = String(value);
    if (node && node.textContent !== next) node.textContent = next;
  }

  function renderCasesSafe() {
    try {
      if (typeof w.renderCases === 'function') w.renderCases();
    } catch (error) {
      console.warn('[cases-usability] render failed:', error?.message || error);
    }
  }

  function resetCaseFilters(event) {
    const button = event.target?.closest?.('#cases-reset');
    if (!button) return;

    // The legacy reset listener calls the old lexical renderCases implementation.
    // Stop it before it can replace the new administrative queue with an empty table.
    event.preventDefault();
    event.stopImmediatePropagation();

    const search = document.getElementById('cases-search');
    const type = document.getElementById('cases-type-filter');
    if (search) search.value = '';
    if (type) type.value = 'all';
    renderCasesSafe();
  }

  function patchPageCopy() {
    const section = document.getElementById('section-cases');
    if (!section?.classList.contains('active')) return;
    setTextIfChanged(document.querySelector('.page-title'), 'Cases');
    setTextIfChanged(
      document.querySelector('.page-sub'),
      'Interne Aufgaben, Support-Anfragen und administrative Wiedervorlagen.'
    );
  }

  function patchSourceLabels() {
    const labels = {
      admin_portal: 'Manuell erfasst',
      manual_admin: 'Manuell erfasst',
      admin: 'Intern erstellt',
      internal: 'Intern erstellt',
      operations: 'Operations',
      customer_portal_support: 'Kunden-Support',
      ai_change_request: 'Assistenten-Anfrage'
    };
    document.querySelectorAll('#cases-all .case-source-note').forEach(node => {
      const raw = String(node.textContent || '').trim().toLowerCase();
      const next = labels[raw];
      if (next) setTextIfChanged(node, next);
    });
  }

  function patchCasesUi() {
    patchPageCopy();
    patchSourceLabels();
  }

  function schedulePatchCasesUi() {
    if (patchScheduled) return;
    patchScheduled = true;
    const run = () => {
      patchScheduled = false;
      patchCasesUi();
    };
    if (typeof w.requestAnimationFrame === 'function') w.requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function start() {
    if (!w.__voxCasesResetCaptureInstalled) {
      document.addEventListener('click', resetCaseFilters, true);
      w.__voxCasesResetCaptureInstalled = true;
    }

    patchCasesUi();
    w.addEventListener('hashchange', schedulePatchCasesUi);

    const main = document.querySelector('.main') || document.body;
    const observer = new MutationObserver(schedulePatchCasesUi);
    observer.observe(main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });

    setTimeout(schedulePatchCasesUi, 250);
    setTimeout(schedulePatchCasesUi, 900);
  }

  if (document.readyState === 'complete') start();
  else w.addEventListener('load', start, { once:true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
