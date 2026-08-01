(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const onSettings = () => /settings/i.test(String(location.hash || '')) || /settings/i.test(String(location.pathname || ''));
  const onBilling = () => /billing/i.test(String(location.hash || '')) || /billing/i.test(String(location.pathname || ''));
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();

  function injectStyles() {
    if (document.getElementById('vx-plan-input-render-fix-style')) return;
    const style = document.createElement('style');
    style.id = 'vx-plan-input-render-fix-style';
    style.textContent = `
      .vx-plan-value-input{
        color:#0F172A!important;
        -webkit-text-fill-color:#0F172A!important;
        text-shadow:none!important;
        filter:none!important;
        opacity:1!important;
        mix-blend-mode:normal!important;
        -webkit-text-stroke:0 transparent!important;
        background-image:none!important;
        box-shadow:none!important;
      }
      .vx-hidden-currency-overlay,
      .vx-hidden-value-overlay{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}
      .vx-empty-duplicate-check{display:none!important}
    `;
    document.head.appendChild(style);
  }

  function likelyPlanInput(input) {
    if (!input || input.tagName !== 'INPUT') return false;
    const type = String(input.type || '').toLowerCase();
    if (!['number','text','tel'].includes(type)) return false;
    const context = norm(input.closest('section,article,.card,.panel,form,div')?.textContent).toLowerCase();
    const marker = `${input.name || ''} ${input.id || ''} ${input.placeholder || ''} ${context}`.toLowerCase();
    return /monatlich|jährlich|setup fee|inklusive minuten|zusatz pro minute|pricing|usage|paket/.test(marker);
  }

  function hideOverlayCandidates(input) {
    const value = norm(input.value);
    const wrappers = [input.parentElement, input.parentElement?.parentElement].filter(Boolean);
    wrappers.forEach(wrapper => {
      Array.from(wrapper.children || []).forEach(node => {
        if (node === input || node.contains(input)) return;
        const text = norm(node.textContent);
        if (!text) return;
        const compact = text.replace(/\s+/g, '').toUpperCase();
        const valueCompact = value.replace(/\s+/g, '').toUpperCase();
        const isCurrency = compact === 'CHF' || compact === 'FR.' || compact === 'FR';
        const duplicatesValue = valueCompact && (compact === valueCompact || compact === `CHF${valueCompact}` || compact === `${valueCompact}CHF`);
        const visuallyOverlayed = (() => {
          const a = input.getBoundingClientRect();
          const b = node.getBoundingClientRect();
          if (!a.width || !b.width) return false;
          const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          return xOverlap > 4 && yOverlap > 4;
        })();
        if ((isCurrency || duplicatesValue) && visuallyOverlayed) {
          node.classList.add(isCurrency ? 'vx-hidden-currency-overlay' : 'vx-hidden-value-overlay');
        }
      });
    });
  }

  function cleanPlanInputs() {
    if (!onSettings()) return;
    document.querySelectorAll('input').forEach(input => {
      if (!likelyPlanInput(input)) return;
      input.classList.add('vx-plan-value-input');
      input.style.setProperty('color', '#0F172A', 'important');
      input.style.setProperty('-webkit-text-fill-color', '#0F172A', 'important');
      input.style.setProperty('text-shadow', 'none', 'important');
      input.style.setProperty('filter', 'none', 'important');
      input.style.setProperty('opacity', '1', 'important');
      input.style.setProperty('mix-blend-mode', 'normal', 'important');
      input.style.setProperty('-webkit-text-stroke', '0 transparent', 'important');
      input.style.setProperty('background-image', 'none', 'important');
      if (norm(input.value)) input.removeAttribute('placeholder');
      hideOverlayCandidates(input);
    });
  }

  function removeDuplicateEmptyCheck() {
    if (!onBilling()) return;
    const containers = Array.from(document.querySelectorAll('section,article,.card,.panel,main div'))
      .filter(node => /alles erledigt/i.test(norm(node.textContent)) && /keine offenen aufgaben/i.test(norm(node.textContent)));
    containers.forEach(container => {
      const candidates = Array.from(container.querySelectorAll('svg,[class*="check"],.icon,[aria-hidden="true"]'))
        .filter(node => {
          const rect = node.getBoundingClientRect();
          return rect.width > 8 && rect.width < 90 && rect.height > 8 && rect.height < 90;
        });
      if (candidates.length <= 1) return;
      const preferred = candidates.find(node => {
        const parentStyle = getComputedStyle(node.parentElement || node);
        return parentStyle.borderStyle !== 'none' || parentStyle.backgroundColor !== 'rgba(0, 0, 0, 0)';
      }) || candidates[0];
      candidates.forEach(node => {
        if (node !== preferred && !preferred.contains(node) && !node.contains(preferred)) node.classList.add('vx-empty-duplicate-check');
      });
    });
  }

  function tick() {
    injectStyles();
    cleanPlanInputs();
    removeDuplicateEmptyCheck();
  }

  const observer = new MutationObserver(() => requestAnimationFrame(tick));
  observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['value','class','style'] });
  document.addEventListener('input', event => {
    if (event.target?.tagName === 'INPUT') setTimeout(tick, 0);
  }, true);
  w.addEventListener('hashchange', () => setTimeout(tick, 80));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once:true }); else tick();
  setInterval(tick, 900);
})(typeof globalThis !== 'undefined' ? globalThis : window);
