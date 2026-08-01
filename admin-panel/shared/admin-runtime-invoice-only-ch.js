(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const LEGACY_MAIL_TYPES = new Set([
    'invoice_email',
    'setup_fee_email',
    'subscription_payment_email',
    'reminder_email',
    'reminder_final_email'
  ]);
  const LEGACY_PAYMENT_ACTIONS = new Set([
    'send_payment_link',
    'send_monthly_payment_link',
    'send_yearly_payment_link'
  ]);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'CODE', 'PRE', 'SVG', 'PATH']);

  function formatDate(value, includeTime) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const options = {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Europe/Zurich'
    };
    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    return new Intl.DateTimeFormat('de-CH', options).format(date);
  }

  function parseAmount(raw) {
    let value = String(raw || '').replace(/[\s'’]/g, '');
    if (!value) return null;
    const hasComma = value.includes(',');
    const hasDot = value.includes('.');
    if (hasComma && hasDot) {
      if (value.lastIndexOf(',') > value.lastIndexOf('.')) value = value.replace(/\./g, '').replace(',', '.');
      else value = value.replace(/,/g, '');
    } else if (hasComma) {
      value = value.replace(',', '.');
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatAmount(raw) {
    const amount = parseAmount(raw);
    if (amount == null) return null;
    return new Intl.NumberFormat('de-CH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function localizeText(value) {
    let text = String(value || '');
    text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z\b/g, (match) => formatDate(match, true));
    text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match) => formatDate(`${match}T12:00:00Z`, false));
    text = text.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, (_match, day, month, year) => `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`);
    text = text.replace(/\bCHF\s*([+-]?\d[\d\s'’]*(?:[.,]\d{1,2})?)\b/g, (_match, raw) => {
      const formatted = formatAmount(raw);
      return formatted == null ? _match : `CHF ${formatted}`;
    });
    text = text.replace(/\b([+-]?\d[\d\s'’]*(?:[.,]\d{1,2})?)\s*CHF\b/g, (_match, raw) => {
      const formatted = formatAmount(raw);
      return formatted == null ? _match : `CHF ${formatted}`;
    });
    return text;
  }

  function localizeVisibleText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[contenteditable="true"],.monaco-editor,.CodeMirror')) return NodeFilter.FILTER_REJECT;
        const value = String(node.nodeValue || '');
        if (!value.trim() || (!/\d{4}-\d{2}-\d{2}/.test(value) && !/\bCHF\b/.test(value) && !/\b\d{1,2}\.\d{1,2}\.\d{4}\b/.test(value))) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const next = localizeText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });
  }

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

  function hasAdminApiWrapper(fn, marker) {
    const seen = new Set();
    let current = fn;
    while (typeof current === 'function' && !seen.has(current)) {
      if (current[marker]) return true;
      seen.add(current);
      current = current.__voxeraOriginal || current.__voxOriginal;
    }
    return false;
  }

  function wrapAdminApi() {
    const current = w.callAdminFunction;
    if (typeof current !== 'function' || hasAdminApiWrapper(current, '__voxeraInvoiceOnly')) return;
    const original = current.bind(w);
    const wrapped = function (functionName, payload, ...rest) {
      const body = payload && typeof payload === 'object' ? payload : {};
      const mailType = String(body.mail_type || body.event_type || '').trim().toLowerCase();
      if (functionName === 'mail-dispatch' && LEGACY_MAIL_TYPES.has(mailType)) {
        return original('invoice-mail-dispatch', {
          ...body,
          original_mail_type: mailType,
          mail_type: mailType,
          event_type: mailType
        }, ...rest);
      }
      if (functionName === 'customer-billing-update' && LEGACY_PAYMENT_ACTIONS.has(String(body.action || '').toLowerCase())) {
        const error = new Error('Zahlungslinks sind deaktiviert. Bitte eine Swiss-QR-Rechnung erstellen und versenden.');
        error.payload = { error: error.message, step_failed: 'legacy_payment_link_disabled' };
        return Promise.reject(error);
      }
      return original(functionName, payload, ...rest);
    };
    wrapped.__voxeraInvoiceOnly = true;
    wrapped.__voxeraOriginal = current;
    w.callAdminFunction = wrapped;
  }

  function pass() {
    document.documentElement.lang = 'de-CH';
    wrapAdminApi();
    hideLegacyPaymentControls();
    replaceLegacyLabels();
    localizeVisibleText(document.querySelector('.main') || document.body);
    document.querySelectorAll('.modal-overlay.open,.modal-overlay[style*="display: flex"],#toast').forEach(localizeVisibleText);
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
    document.addEventListener('click', () => setTimeout(pass, 80), true);
    w.addEventListener('hashchange', () => setTimeout(pass, 80));
    setInterval(pass, 1200);
    pass();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);
