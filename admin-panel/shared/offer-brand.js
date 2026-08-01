(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoxeraOfferBrand = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const OFFER_BRAND_ASSET_PATH = '/brand/05-app-icon-512px.svg';
  const OFFER_BRAND_ASSET_NAME = '05 App Icon 512px';
  const BRAND_LOGO_PATH = OFFER_BRAND_ASSET_PATH;
  const BRAND_FAVICON_PATH = OFFER_BRAND_ASSET_PATH;
  return { OFFER_BRAND_ASSET_PATH, OFFER_BRAND_ASSET_NAME, BRAND_LOGO_PATH, BRAND_FAVICON_PATH };
});

(function bootstrapAdminRuntime(root) {
  if (!root || typeof document === 'undefined') return;
  if (!root.CUSTOMER_STATUS) root.CUSTOMER_STATUS = Object.freeze({
    ONBOARDING:'onboarding', READY:'ready', INVITED:'invited', ACTIVATED:'activated', LIVE:'live', PAUSED:'paused', DELETED:'deleted'
  });
  [
    '/shared/admin-runtime-ui.js?v=20260731-3',
    '/shared/admin-runtime-navigation.js?v=20260731-3',
    '/shared/admin-runtime-sync.js?v=20260731-4',
    '/shared/admin-runtime-cases.js?v=20260731-3',
    '/shared/admin-runtime-cases-admin-only.js?v=20260731-1',
    '/shared/admin-runtime-mobile.js?v=20260731-1',
    '/shared/admin-runtime-operations-v3.js?v=20260731-1',
    '/shared/admin-runtime-cases-state-hotfix.js?v=20260731-1',
    '/shared/admin-runtime-cases-usability-fix.js?v=20260731-2',
    '/shared/admin-runtime-launch-p0.js?v=20260731-2',
    '/shared/admin-runtime-data-integrity.js?v=20260731-1',
    '/shared/admin-runtime-contract-termination.js?v=20260731-1',
    '/shared/admin-runtime-invoice-adjustments.js?v=20260731-1',
    '/shared/admin-runtime-design-system-v2.js?v=20260731-1',
    '/shared/admin-runtime-payment-account.js?v=20260801-2',
    '/shared/admin-runtime-billing-inline-qr.js?v=20260801-2',
    '/shared/admin-runtime-invoice-only-ch.js?v=20260801-1',
    '/shared/admin-runtime-invoice-mail-routing-fix.js?v=20260801-2',
    '/shared/admin-runtime-admin-ui-cleanup.js?v=20260801-1',
    '/shared/admin-runtime-design-system-v3.js?v=20260801-2',
    '/shared/admin-runtime-v3-regression-fix.js?v=20260801-1',
    '/shared/admin-runtime-plan-input-cleanup.js?v=20260801-1',
    '/shared/admin-runtime-plan-input-render-fix.js?v=20260801-1',
    '/shared/admin-runtime-plan-placeholder-visibility.js?v=20260801-1',
    '/shared/admin-runtime-billing-ui-consolidated.js?v=20260801-2'
  ].forEach((src, index) => {
    const id = `voxera-admin-runtime-${index}`;
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    document.head.appendChild(script);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);