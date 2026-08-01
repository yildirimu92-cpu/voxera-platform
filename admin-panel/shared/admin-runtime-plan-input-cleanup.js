(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  function addStyles() {
    if (document.getElementById('vx-plan-input-cleanup-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-plan-input-cleanup-style';
    style.textContent = `
      #section-settings input[type="number"],
      #section-settings input[inputmode="decimal"],
      #section-settings input[data-field*="price"],
      #section-settings input[data-field*="fee"],
      #section-settings input[data-field*="minute"]{
        color:#10213D!important;
        -webkit-text-fill-color:#10213D!important;
        text-shadow:none!important;
        filter:none!important;
        opacity:1!important;
        background-image:none!important;
      }
      #section-settings input[type="number"]::placeholder,
      #section-settings input[inputmode="decimal"]::placeholder,
      #section-settings input[data-field*="price"]::placeholder,
      #section-settings input[data-field*="fee"]::placeholder,
      #section-settings input[data-field*="minute"]::placeholder{
        color:transparent!important;
        -webkit-text-fill-color:transparent!important;
        opacity:0!important;
      }
      #section-settings .vx-plan-card [class*="prefix"],
      #section-settings .vx-plan-card [class*="currency"]{
        text-shadow:none!important;
        filter:none!important;
      }
    `;
    document.head.appendChild(style);
  }

  function cleanInputs() {
    if (!/settings/i.test(String(location.hash || ''))) return;
    document.querySelectorAll('#section-settings input').forEach(input => {
      const label = String(input.closest('label,div')?.textContent || '').toLowerCase();
      const numeric = input.type === 'number' || input.inputMode === 'decimal' || /preis|monatlich|jährlich|setup fee|minute/.test(label);
      if (!numeric) return;
      input.style.textShadow = 'none';
      input.style.filter = 'none';
      input.style.opacity = '1';
      input.style.webkitTextFillColor = '#10213D';
      if (input.value) input.setAttribute('placeholder', '');
    });
  }

  addStyles();
  const run = () => { addStyles(); cleanInputs(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once:true }); else run();
  w.addEventListener('hashchange', () => setTimeout(run, 80));
  setInterval(cleanInputs, 700);
})(typeof globalThis !== 'undefined' ? globalThis : window);
