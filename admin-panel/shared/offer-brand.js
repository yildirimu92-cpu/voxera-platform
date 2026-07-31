(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VoxeraOfferBrand = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const OFFER_BRAND_ASSET_PATH = '/brand/05-app-icon-512px.svg';
  const OFFER_BRAND_ASSET_NAME = '05 App Icon 512px';
  const BRAND_LOGO_PATH = OFFER_BRAND_ASSET_PATH;
  const BRAND_FAVICON_PATH = OFFER_BRAND_ASSET_PATH;

  return {
    OFFER_BRAND_ASSET_PATH,
    OFFER_BRAND_ASSET_NAME,
    BRAND_LOGO_PATH,
    BRAND_FAVICON_PATH
  };
});

/*
 * Admin portal compatibility hotfixes.
 * This file is loaded before the large inline admin bundle and can therefore
 * provide missing global constants without coupling the fix to one module.
 */
(function installAdminPortalHotfixes(root) {
  if (!root || typeof document === 'undefined') return;

  if (!root.CUSTOMER_STATUS) {
    root.CUSTOMER_STATUS = Object.freeze({
      ONBOARDING: 'onboarding',
      READY: 'ready',
      INVITED: 'invited',
      ACTIVATED: 'activated',
      LIVE: 'live',
      PAUSED: 'paused',
      DELETED: 'deleted'
    });
  }

  const style = document.createElement('style');
  style.id = 'voxera-admin-contrast-hotfix';
  style.textContent = `
    .onboarding-detail-shell > .card-head h3,
    .onboarding-detail-shell > .card-head .muted,
    .offer-card > .card-head h3,
    .offer-card > .card-head .muted {
      color: #fff !important;
    }
    .onboarding-detail-shell > .card-head,
    .offer-card > .card-head {
      color: #fff;
    }
  `;
  document.head.appendChild(style);

  function linkedCustomerIds() {
    const appState = root.state;
    if (!appState) return new Set();
    return new Set([
      ...(appState.offers || []).map(row => String(row.customerId || '').trim()),
      ...(appState.contracts || []).map(row => String(row.customerId || '').trim()),
      ...(appState.invoices || []).map(row => String(row.customer_id || '').trim())
    ].filter(Boolean));
  }

  function showCustomerConsistencyWarning() {
    const appState = root.state;
    if (!appState || (appState.customers || []).length > 0) return;
    const references = linkedCustomerIds();
    if (!references.size) return;

    const message = `Die Kundenabfrage lieferte 0 Datensätze, obwohl ${references.size} verknüpfte Kundenreferenzen vorhanden sind. Supabase-RLS und die Deploy-Preview-Umgebungsvariablen prüfen.`;
    const html = `<div class="empty" style="padding:22px;border-color:#FECACA;background:#FEF2F2;color:#991B1B;"><strong>Kundendaten konnten nicht konsistent geladen werden.</strong><br><span style="font-size:12px;">${message}</span></div>`;
    const customers = document.getElementById('customers-card-list');
    const onboarding = document.getElementById('onboarding-cards');
    if (customers) customers.innerHTML = html;
    if (onboarding) onboarding.innerHTML = html;
    console.error('[DB] customer consistency error:', message);
  }

  root.addEventListener('load', function () {
    if (typeof root.openLinkedCustomerFromOffer === 'function') {
      root.openLinkedCustomerFromOffer = function () {
        const offer = (root.state?.offers || []).find(row => root.idsEq
          ? root.idsEq(row.id, root.state.selectedOfferId)
          : String(row.id) === String(root.state?.selectedOfferId));
        const customerId = String(offer?.customerId || '').trim();
        if (!customerId) {
          root.showToast?.('Kein verknüpfter Kunde vorhanden.');
          return;
        }
        root.openCustomerWorkspace?.(customerId);
      };
    }

    if (typeof root.openOfferContract === 'function') {
      root.openOfferContract = function () {
        const offer = (root.state?.offers || []).find(row => root.idsEq
          ? root.idsEq(row.id, root.state.selectedOfferId)
          : String(row.id) === String(root.state?.selectedOfferId));
        if (!offer?.contractId) {
          root.showToast?.('Kein Vertrag verknüpft.');
          return;
        }
        root.setRoute?.('contracts');
        root.renderContracts?.();
        root.requestAnimationFrame(() => root.viewContract?.(offer.contractId));
      };
    }

    root.setTimeout(showCustomerConsistencyWarning, 0);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
