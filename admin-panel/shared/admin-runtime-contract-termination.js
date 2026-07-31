(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once:true });

  function syncLocalState(result) {
    if (typeof state === 'undefined' || !result?.contract) return;
    const updated = result.contract;
    if (Array.isArray(state.contracts)) {
      const index = state.contracts.findIndex(item => String(item?.id) === String(updated.id));
      if (index >= 0) state.contracts[index] = { ...state.contracts[index], ...updated };
    }
    if (updated.customer_id && Array.isArray(state.customers) && !result.termination?.scheduled) {
      const customer = state.customers.find(item => String(item?.id) === String(updated.customer_id));
      if (customer) {
        customer.operational_status = 'terminated';
        customer.operational_ended_at = result.termination?.effective_at || new Date().toISOString();
      }
    }
  }

  function installRouting() {
    const original = w.callAdminFunction;
    if (typeof original !== 'function' || original.__voxContractTermination) return;

    const routed = async function (name, payload) {
      const action = String(payload?.action || '');
      if (name === 'admin-mutate' && action === 'contracts.cancel') {
        const result = await original.call(this, 'contract-terminate', payload?.payload || payload);
        syncLocalState(result);
        if (typeof w.renderAll === 'function') w.renderAll();
        if (result?.finance_action_required && typeof w.showToast === 'function') {
          w.showToast(`${result.open_invoices?.length || 0} offene Rechnung(en) bleiben bestehen. Finanzielle Behandlung separat festlegen.`);
        }
        return result;
      }
      return original.call(this, name, payload);
    };

    routed.__voxContractTermination = true;
    routed.__voxOriginal = original;
    w.callAdminFunction = routed;
  }

  function installPredicates() {
    w.voxeraCustomerIsOperational = function (customer) {
      return String(customer?.operational_status || 'active').toLowerCase() !== 'terminated';
    };
    w.voxeraInvoiceIsReceivable = function (invoice) {
      return !['paid','cancelled','void','credited'].includes(String(invoice?.status || '').toLowerCase());
    };
  }

  function install() {
    installRouting();
    installPredicates();
  }

  ready(() => {
    install();
    setTimeout(install, 250);
    setTimeout(install, 1200);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
