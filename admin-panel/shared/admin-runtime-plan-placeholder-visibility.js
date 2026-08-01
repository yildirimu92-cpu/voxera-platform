(function planPlaceholderVisibilityFix(root) {
  'use strict';

  if (!root || typeof document === 'undefined') return;

  const PLAN_LABELS = [
    'monatlich', 'jährlich', 'jaehrlich', 'setup fee',
    'inklusive minuten', 'zusatz pro minute', 'sortierung'
  ];

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isPlanInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    const scope = input.closest('section, article, form, .card, .panel, [class*="plan"], [class*="package"]');
    const scopeText = text(scope && scope.textContent).toLowerCase();
    const meta = [input.name, input.id, input.placeholder, input.getAttribute('aria-label')]
      .map(text).join(' ').toLowerCase();
    return PLAN_LABELS.some((label) => scopeText.includes(label) || meta.includes(label));
  }

  function hasValue(input) {
    return text(input.value) !== '';
  }

  function nearbyCandidates(input) {
    const wrapper = input.parentElement;
    if (!wrapper) return [];
    return Array.from(wrapper.children).filter((node) => node !== input && node instanceof HTMLElement);
  }

  function looksLikeHintOrPrefix(node, input) {
    const value = text(node.textContent);
    if (!value) return false;
    const normalized = value.toLowerCase();
    const inputValue = text(input.value).toLowerCase();
    const placeholder = text(input.getAttribute('placeholder')).toLowerCase();
    return normalized === 'chf'
      || normalized === inputValue
      || (placeholder && normalized === placeholder)
      || normalized === '0.00'
      || normalized === '0';
  }

  function updateInput(input) {
    if (!isPlanInput(input)) return;

    const filled = hasValue(input);
    const originalPlaceholder = input.dataset.voxeraOriginalPlaceholder
      || input.getAttribute('placeholder')
      || '';

    if (!input.dataset.voxeraOriginalPlaceholder && originalPlaceholder) {
      input.dataset.voxeraOriginalPlaceholder = originalPlaceholder;
    }

    if (filled) {
      input.setAttribute('placeholder', '');
      input.classList.add('voxera-plan-input-filled');
    } else {
      input.classList.remove('voxera-plan-input-filled');
      if (originalPlaceholder) input.setAttribute('placeholder', originalPlaceholder);
    }

    nearbyCandidates(input).forEach((candidate) => {
      if (!looksLikeHintOrPrefix(candidate, input)) return;
      candidate.dataset.voxeraPlanHint = 'true';
      candidate.style.setProperty('display', filled ? 'none' : '', 'important');
      candidate.setAttribute('aria-hidden', filled ? 'true' : 'false');
    });
  }

  function scan(rootNode) {
    const rootElement = rootNode && rootNode.querySelectorAll ? rootNode : document;
    rootElement.querySelectorAll('input').forEach(updateInput);
  }

  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement) updateInput(event.target);
  }, true);
  document.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement) updateInput(event.target);
  }, true);
  document.addEventListener('focusout', (event) => {
    if (event.target instanceof HTMLInputElement) updateInput(event.target);
  }, true);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      });
    });
  });

  function boot() {
    scan(document);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
