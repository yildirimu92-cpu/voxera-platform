(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VoxeraOfferBrand = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const OFFER_BRAND_ASSET_PATH = '/brand/05-app-icon-512px.svg';
  const OFFER_BRAND_ASSET_NAME = '05 App Icon 512px';

  return {
    OFFER_BRAND_ASSET_PATH,
    OFFER_BRAND_ASSET_NAME
  };
});
