(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function injectStyles() {
    if (document.getElementById('vx-admin-v3-regression-fix-css')) return;
    const style = document.createElement('style');
    style.id = 'vx-admin-v3-regression-fix-css';
    style.textContent = `
      /* Prevent inherited/legacy text effects from making form values look doubled. */
      #section-settings input,
      #section-settings select,
      #section-settings textarea,
      #section-settings label,
      #section-settings .field,
      #section-settings [class*="label"]{
        text-shadow:none!important;
        filter:none!important;
        opacity:1!important;
      }
      #section-settings input,
      #section-settings textarea{
        -webkit-text-fill-color:currentColor!important;
        color:var(--vx3-ink,#10213D)!important;
        font-variant-numeric:tabular-nums!important;
      }

      /* Keep customer section headings readable on light cards. */
      #section-customers .vx-unified-head,
      #section-customers .card-head,
      #section-customers .card-header,
      #section-customers [class*="section-head"]{
        color:var(--vx3-ink,#10213D)!important;
        background:linear-gradient(180deg,#fff 0%,#fbfcfe 100%)!important;
      }
      #section-customers .vx-unified-head *,
      #section-customers .card-head *,
      #section-customers .card-header *,
      #section-customers [class*="section-head"] *{
        color:inherit!important;
        text-shadow:none!important;
      }

      /* Billing actions: compact, predictable and aligned. */
      #section-billing-finance .vx-billing-action-shell{
        min-width:0!important;
        width:max-content!important;
        max-width:300px!important;
        display:flex!important;
        align-items:center!important;
        gap:7px!important;
        flex-wrap:nowrap!important;
      }
      #section-billing-finance .vx-billing-action-primary{
        display:flex!important;
        align-items:center!important;
        gap:7px!important;
        flex-wrap:nowrap!important;
      }
      #section-billing-finance .vx-billing-action-primary .btn,
      #section-billing-finance .vx-billing-action-primary button,
      #section-billing-finance .vx-billing-action-primary a,
      #section-billing-finance .vx-billing-action-more>summary{
        min-height:38px!important;
        height:38px!important;
        padding:0 13px!important;
        white-space:nowrap!important;
        width:auto!important;
      }
      #section-billing-finance .vx-billing-action-menu{
        min-width:210px!important;
        z-index:250!important;
      }
      #section-billing-finance td:last-child,
      #section-billing-finance [role="cell"]:last-child{
        min-width:310px!important;
        vertical-align:middle!important;
      }

      .vx-legacy-payment-link-hidden{display:none!important}

      @media(max-width:900px){
        #section-billing-finance .vx-billing-action-shell,
        #section-billing-finance .vx-billing-action-primary{
          width:100%!important;max-width:none!important;
          display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;
        }
        #section-billing-finance .vx-billing-action-primary .btn,
        #section-billing-finance .vx-billing-action-primary button,
        #section-billing-finance .vx-billing-action-primary a,
        #section-billing-finance .vx-billing-action-more,
        #section-billing-finance .vx-billing-action-more>summary{width:100%!important}
        #section-billing-finance td:last-child,
        #section-billing-finance [role="cell"]:last-child{min-width:0!important}
      }
    `;
    document.head.appendChild(style);
  }

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
    injectStyles();
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
