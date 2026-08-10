/**
 * Alt-Bedienelemente der Zahlungslink-Phase ausblenden.
 *
 * Rest des früheren `admin-runtime-invoice-only-ch.js` nach Welle 1. Was hier
 * stand und jetzt woanders liegt:
 *
 *   - Die Formatierung von Beträgen und Daten → shared/core/admin-format.js.
 *     Der frühere Nachlauf hier lief alle 1200 ms über jeden Textknoten des
 *     Dokuments und zerstörte dabei Inhalte: aus "0.018 CHF/Minute" wurde
 *     "0.CHF 18.00/Minute". Der Ersatz formatiert nur, was eindeutig ein Betrag
 *     oder ein Datum ist, und lässt Tarife mit drei Nachkommastellen in Ruhe.
 *   - Die Umleitung von Alt-Mailtypen und die Sperre der Zahlungslink-Aktionen
 *     → shared/core/admin-api.js, als Regel 2 der Endpunkttabelle.
 *
 * Was noch hier steht, ist reines Verstecken von Markup, das es nicht mehr
 * geben sollte. → Welle 5: Die Alt-Zahlungsfelder werden aus index.html
 * entfernt, statt sie per CSS und JavaScript zu verdecken. Der Ablationstest
 * hat gezeigt, dass hier 12 Bedienelemente unsichtbar gemacht werden — solange
 * das Markup existiert, muss dieses Verstecken bleiben.
 */
(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  function legacyField(element) {
    const token = `${element?.name || ''} ${element?.id || ''}`.toLowerCase();
    return token.includes('stripe')
      || token.includes('payment_link')
      || token.includes('payment-link')
      || token.includes('setup_fee_link');
  }

  function hideLegacyPaymentControls() {
    document.querySelectorAll('input,select,textarea').forEach((field) => {
      if (!legacyField(field)) return;
      field.value = '';
      field.disabled = true;
      const container = field.closest('.form-group,.field,.settings-row,.setting-row,label,tr,.grid-item') || field.parentElement;
      if (container) container.style.display = 'none';
    });

    const scopes = [document.getElementById('section-settings'), document.getElementById('edit-customer-modal')].filter(Boolean);
    scopes.forEach((scope) => {
      scope.querySelectorAll('label,button,small,.muted,.field-label,.card-title').forEach((node) => {
        const text = String(node.textContent || '').trim().toLowerCase();
        if (!text) return;
        if (text.includes('stripe') || text.includes('zahlungslink') || text.includes('payment link')) {
          const container = node.closest('.form-group,.field,.settings-row,.setting-row,label,tr,.grid-item') || node;
          container.style.display = 'none';
        }
      });
    });
  }

  function replaceLegacyLabels() {
    const replacements = [
      [/setup[- ]fee[- ]link senden/gi, 'Setup-Rechnung senden'],
      [/monatlichen zahlungslink senden/gi, 'Monatsrechnung senden'],
      [/jährlichen zahlungslink senden/gi, 'Jahresrechnung senden'],
      [/zahlungslink senden/gi, 'QR-Rechnung senden'],
      [/stripe[- ]link/gi, 'Online-Zahlung']
    ];
    document.querySelectorAll('button,a,span,div').forEach((node) => {
      if (node.children.length) return;
      const before = String(node.textContent || '');
      let after = before;
      replacements.forEach(([pattern, replacement]) => { after = after.replace(pattern, replacement); });
      if (after !== before) node.textContent = after;
    });
  }

  function pass() {
    hideLegacyPaymentControls();
    replaceLegacyLabels();
  }

  function install() {
    const style = document.createElement('style');
    style.id = 'vx-invoice-only-ch-style';
    style.textContent = `
      :is(.form-group,.field,label,tr,.settings-row,.setting-row):has([name*="stripe" i]),
      :is(.form-group,.field,label,tr,.settings-row,.setting-row):has([id*="stripe" i]),
      :is(.form-group,.field,label,tr,.settings-row,.setting-row):has([name*="payment_link" i]),
      :is(.form-group,.field,label,tr,.settings-row,.setting-row):has([id*="payment_link" i]),
      :is(.form-group,.field,label,tr,.settings-row,.setting-row):has([name="setup_fee_link"]){display:none!important;}
    `;
    document.head.appendChild(style);
    // Kein Intervall mehr (Regel R6): das Verstecken haengt an echten
    // Ereignissen. Neue Alt-Felder entstehen nur beim Rendern eines Screens
    // oder beim Oeffnen eines Dialogs, und beides folgt auf einen Klick.
    document.addEventListener('click', () => setTimeout(pass, 80), true);
    w.addEventListener('hashchange', () => setTimeout(pass, 80));
    pass();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);
