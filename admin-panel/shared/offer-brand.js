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

/* Admin compatibility bootstrap. Loaded before the main inline bundle. */
(function bootstrapAdminRuntime(root) {
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

  if (document.getElementById('voxera-admin-runtime-patch-script')) return;
  const script = document.createElement('script');
  script.id = 'voxera-admin-runtime-patch-script';
  script.src = '/shared/admin-runtime-patch.js?v=20260731-2';
  script.async = false;
  document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);
