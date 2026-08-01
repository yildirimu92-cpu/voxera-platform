(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const TYPES = new Set(['invoice_email','setup_fee_email','subscription_payment_email','reminder_email','reminder_final_email']);
  const PREVIEW_NAMES = new Set(['mail-preview','email-preview','invoice-mail-preview','preview-mail','preview-email']);

  function normalizeType(body) {
    const raw = String(body?.mail_type || body?.event_type || body?.original_mail_type || '').trim().toLowerCase();
    if (raw === 'setup_fee_email' || raw === 'subscription_payment_email') return 'invoice_email';
    if (raw === 'reminder_final_email') return 'reminder_final_email';
    if (raw === 'reminder_email') return 'reminder_email';
    return raw || 'invoice_email';
  }

  function install() {
    const current = w.callAdminFunction;
    if (typeof current !== 'function' || current.__voxeraInvoiceMailRoutingFix) return;
    const original = current.bind(w);

    const wrapped = function (functionName, payload, ...rest) {
      const body = payload && typeof payload === 'object' ? payload : {};
      const type = normalizeType(body);
      const name = String(functionName || '').trim().toLowerCase();
      const hasInvoiceContext = Boolean(body.invoice_id || body.invoice?.id || body.customer_id || body.subscription_id);
      const isSupportedMail = TYPES.has(String(body.mail_type || body.event_type || body.original_mail_type || '').trim().toLowerCase()) ||
        ['invoice_email','reminder_email','reminder_final_email'].includes(type);

      if (hasInvoiceContext && isSupportedMail && (PREVIEW_NAMES.has(name) || (name.includes('preview') && (name.includes('mail') || name.includes('email'))))) {
        return original('invoice-mail-preview', {
          ...body,
          invoice_id: body.invoice_id || body.invoice?.id,
          original_mail_type: body.original_mail_type || body.mail_type || body.event_type || type,
          mail_type: type,
          event_type: type
        }, ...rest);
      }

      if (hasInvoiceContext && isSupportedMail && (name === 'mail-dispatch' || name === 'invoice-mail-dispatch')) {
        return original('invoice-mail-dispatch', {
          ...body,
          invoice_id: body.invoice_id || body.invoice?.id,
          original_mail_type: body.original_mail_type || body.mail_type || body.event_type || type,
          mail_type: type,
          event_type: type
        }, ...rest);
      }

      return original(functionName, payload, ...rest);
    };

    wrapped.__voxeraInvoiceMailRoutingFix = true;
    wrapped.__voxeraOriginal = current;
    w.callAdminFunction = wrapped;
  }

  function pass() { install(); }
  document.addEventListener('click', () => setTimeout(pass, 20), true);
  w.addEventListener('hashchange', () => setTimeout(pass, 20));
  setInterval(pass, 500);
  pass();
})(typeof globalThis !== 'undefined' ? globalThis : window);
