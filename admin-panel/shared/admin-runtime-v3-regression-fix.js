/**
 * Alt-Bedienelemente der Zahlungslink-Phase im Billing und in den Einstellungen.
 *
 * Rest dieser Datei nach Welle 2. Der CSS-Teil -- er reparierte, was
 * admin-runtime-design-system-v3.js angerichtet hatte -- ist mit v3 zusammen
 * nach shared/admin-components.css gewandert. Uebrig bleibt DOM-Logik:
 * das Verstecken der Alt-Zahlungslinks (der Ablationstest hat gezeigt, dass
 * hier 12 Bedienelemente unsichtbar gemacht werden) und das Zusammenfassen der
 * Zeilenaktionen im Billing.
 *
 * → Welle 5: Beides gehoert in screens/billing.js beziehungsweise verschwindet
 * mit dem Markup, das es versteckt. Bis dahin bleibt es hier.
 */
(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function hideLegacyPaymentLinks() {
    const settings = document.querySelector('#section-settings');
    if (!settings) return;
    const candidates = Array.from(settings.querySelectorAll('label,.field,.form-group,div,section'));
    candidates.forEach(node => {
      const ownText = norm(Array.from(node.childNodes || [])
        .filter(child => child.nodeType === 3)
        .map(child => child.textContent)
        .join(' '));
      if (!ownText) return;
      if (!/^(setup link|payment links?|monatlich payment|jährlich payment)$/.test(ownText)) return;
      const group = node.closest('.field,.form-group,[class*="field"],[class*="form-group"]') || node.parentElement;
      if (group) group.classList.add('vx-legacy-payment-link-hidden');
    });

    Array.from(settings.querySelectorAll('input')).forEach(input => {
      const value = norm(input.value || input.placeholder);
      if (!value.includes('buy.stripe.com')) return;
      const group = input.closest('.field,.form-group,[class*="field"],[class*="form-group"]') || input.parentElement;
      if (group) group.classList.add('vx-legacy-payment-link-hidden');
    });
  }

  function reconcileBillingActions() {
    document.querySelectorAll('.vx-billing-action-shell').forEach(shell => {
      const cell = shell.closest('td,[role="cell"],.table-cell') || shell.parentElement;
      const details = shell.querySelector('.vx-billing-action-more');
      const menu = details && details.querySelector('.vx-billing-action-menu');
      if (!cell || !menu) return;

      Array.from(cell.querySelectorAll('button,a')).forEach(node => {
        if (shell.contains(node)) return;
        const text = norm(node.textContent);
        if (['bezahlt','als bezahlt','qr öffnen','pdf öffnen','neu generieren'].includes(text)) menu.appendChild(node);
      });

      const actions = Array.from(menu.querySelectorAll('button,a'));
      if (!actions.length) details.remove();
      else if (actions.length === 1) {
        const only = actions[0];
        details.replaceWith(only);
      }
    });
  }

  function tick() {
    hideLegacyPaymentLinks();
    reconcileBillingActions();
  }

  const observer = new MutationObserver(() => requestAnimationFrame(tick));
  if (document.documentElement) observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',tick,{once:true});
  w.addEventListener('hashchange',() => setTimeout(tick,80));
  setInterval(tick,900);
  tick();
})(typeof globalThis !== 'undefined' ? globalThis : window);
