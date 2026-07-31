(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  function install() {
    const original = w.callAdminFunction;
    if (typeof original !== 'function' || original.__voxDataIntegrityRouting) return;

    const routed = function (name, payload) {
      if (name === 'admin-mutate' && payload?.action === 'customers.update') {
        return original.call(this, 'admin-customer-update', {
          id: payload.id,
          customer_id: payload.customer_id,
          patch: payload.patch
        });
      }
      return original.call(this, name, payload);
    };

    routed.__voxDataIntegrityRouting = true;
    routed.__voxOriginal = original;
    w.callAdminFunction = routed;
  }

  const boot = () => {
    install();
    setTimeout(install, 250);
    setTimeout(install, 1200);
  };

  if (document.readyState === 'complete') setTimeout(boot, 0);
  else w.addEventListener('load', boot, { once:true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
