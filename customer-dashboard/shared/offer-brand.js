(function (root) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = require('./offer-brand-core.js');
    return;
  }

  if (!root || !root.document) return;

  // This wrapper is parser-loaded. document.write keeps the existing brand/audio
  // runtime synchronous, then adds the customer support/case intake bridge.
  root.document.write('<script src="/shared/offer-brand-core.js"><\/script>');
  root.document.write('<script src="/shared/customer-runtime-case-intake.js?v=20260731-1"><\/script>');
})(typeof globalThis !== 'undefined' ? globalThis : this);
