/**
 * core/admin-lifecycle.js — Zustandsfragen zu Kunden, Verträgen und Rechnungen.
 *
 * Welle 1 des Admin-Zielbilds. Vorerst nur die beiden Prädikate aus
 * `shared/admin-runtime-contract-termination.js`; sie standen dort neben einer
 * Aufruf-Umleitung, mit der sie nichts zu tun hatten.
 *
 * In Welle 3 zieht der Rest hierher: `getCustomerLifecycleStatus`,
 * `getCustomerLifecycleLabel`, `getCustomerLifecycleBadge` und
 * `deriveOnboardingSnapshot` aus `admin-runtime-ui.js`. Bis dahin bleibt die
 * Datei bewusst klein — sie markiert den Platz, statt ihn zu füllen.
 */
(function (root) {
  'use strict';
  if (!root) return;

  var NON_RECEIVABLE_INVOICE_STATUS = new Set(['paid', 'cancelled', 'void', 'credited']);

  /** Ist der Kunde betrieblich aktiv, also nicht gekündigt? */
  function customerIsOperational(customer) {
    var status = String((customer && customer.operational_status) || 'active').trim().toLowerCase();
    return status !== 'terminated';
  }

  /** Steht auf dieser Rechnung noch Geld offen? */
  function invoiceIsReceivable(invoice) {
    var status = String((invoice && invoice.status) || '').trim().toLowerCase();
    return !NON_RECEIVABLE_INVOICE_STATUS.has(status);
  }

  root.VoxeraLifecycle = {
    customerIsOperational: customerIsOperational,
    invoiceIsReceivable: invoiceIsReceivable
  };

  // Eingeführte Namen bleiben erhalten — die Aufrufstellen in index.html und in
  // den verbleibenden Laufzeit-Dateien ändern sich dadurch nicht.
  root.voxeraCustomerIsOperational = customerIsOperational;
  root.voxeraInvoiceIsReceivable = invoiceIsReceivable;
})(typeof globalThis !== 'undefined' ? globalThis : window);
