(function installVoxeraRequestsLayoutOwner(root) {
  'use strict';
  if (!root || !root.document || root.__vxRequestsLayoutOwnerInstalled) return;
  root.__vxRequestsLayoutOwnerInstalled = true;

  const DESKTOP_QUERY = '(min-width: 769px)';
  const DETAIL_SELECTORS = [
    '.vx-split-detail',
    '.vx-split-right',
    '.vx-request-detail',
    '.vx-requests-detail',
    '[data-vx-request-detail]',
    '[data-request-detail]',
    '[id*="request-detail"]',
    '[id*="requests-detail"]',
    '[id*="anfrage-detail"]',
    '[id*="anfragen-detail"]'
  ].join(',');

  function directChildOf(ancestor, node) {
    let current = node;
    while (current && current.parentElement && current.parentElement !== ancestor) {
      current = current.parentElement;
    }
    return current && current.parentElement === ancestor ? current : null;
  }

  function commonAncestor(a, b, stop) {
    const parents = new Set();
    let current = a;
    while (current && current !== stop) {
      parents.add(current);
      current = current.parentElement;
    }
    current = b;
    while (current && current !== stop) {
      if (parents.has(current)) return current;
      current = current.parentElement;
    }
    return stop || null;
  }

  function findDetail(requestsRoot, listBranch) {
    const explicit = requestsRoot.querySelector(DETAIL_SELECTORS);
    if (explicit && !listBranch.contains(explicit)) return explicit;

    // Some legacy markup keeps the detail panel in the same branch as the list.
    const nested = listBranch.querySelector(DETAIL_SELECTORS);
    if (nested) return nested;

    return null;
  }

  function removeIdleLoaders(scope) {
    if (!scope) return;
    const hasRows = Boolean(scope.querySelector(
      '[data-request-id], [data-vx-request-id], .vx-request-row, .vx-inbox-row, .vx-call-row'
    ));
    if (hasRows) return;

    scope.querySelectorAll(
      '.vx-loader, .vx-loading, .vx-spinner, [data-vx-loader], [aria-busy="true"]'
    ).forEach((element) => {
      if (element.closest('.vx-requests-desktop-layout')) {
        element.hidden = true;
        element.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function ownDesktopLayout() {
    const requestsRoot = root.document.querySelector('#tab-archiv');
    if (!requestsRoot) return;

    const existing = requestsRoot.querySelector('.vx-requests-desktop-layout');
    if (!root.matchMedia(DESKTOP_QUERY).matches) {
      if (existing) {
        const parent = existing.parentElement;
        while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
        existing.remove();
      }
      return;
    }

    if (existing) {
      removeIdleLoaders(existing);
      return;
    }

    const filters = requestsRoot.querySelector('.vx-split-filters');
    if (!filters) return;

    const listBranch = directChildOf(requestsRoot, filters) || filters.parentElement;
    const detailNode = findDetail(requestsRoot, listBranch);
    if (!listBranch || !detailNode) return;

    const layoutAncestor = commonAncestor(listBranch, detailNode, requestsRoot) || requestsRoot;
    const listPane = directChildOf(layoutAncestor, filters) || listBranch;
    const detailPane = directChildOf(layoutAncestor, detailNode) || detailNode;
    if (!listPane || !detailPane || listPane === detailPane) return;

    const layout = root.document.createElement('div');
    layout.className = 'vx-requests-desktop-layout';
    layout.dataset.vxOwner = 'requests-layout';

    layoutAncestor.insertBefore(layout, listPane);
    layout.appendChild(listPane);
    layout.appendChild(detailPane);
    removeIdleLoaders(layout);
  }

  const schedule = () => root.requestAnimationFrame(ownDesktopLayout);

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }

  root.addEventListener('resize', schedule, { passive: true });
  root.addEventListener('popstate', schedule);
  root.document.addEventListener('click', schedule, true);

  const observer = new MutationObserver(schedule);
  observer.observe(root.document.documentElement, { childList: true, subtree: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
