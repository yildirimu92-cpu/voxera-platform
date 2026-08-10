/**
 * core/admin-api.js — der einzige Weg vom Admin-Portal zum Server.
 *
 * Welle 1 des Admin-Zielbilds, Regeln R2 und R4.
 *
 * Was hier zusammengelegt wurde
 * -----------------------------
 * `callAdminFunction` war acht Mal umwickelt. Jeder Wrapper behielt den
 * vorigen und rief ihn auf; ein Aufruf durchlief also acht fremde Schichten,
 * bevor er den `fetch` erreichte. Zwei der Wrapper prüften mit einer
 * Marker-Schleife, ob sie schon in der Kette hingen — der Aufwand, den die
 * Schicht betrieb, um sich nicht selbst doppelt einzuhängen, war das Argument
 * gegen sie.
 *
 * Abgelöste Wrapper, in der Reihenfolge, in der sie früher ausgewertet wurden
 * (aussen zuerst — das ist die Reihenfolge der Regeln unten):
 *
 *   1. admin-runtime-invoice-mail-routing-fix.js   Rechnungsmail: Vorschau/Versand
 *   2. admin-runtime-invoice-only-ch.js            Alt-Mailtypen, Zahlungslink-Sperre
 *   3. admin-runtime-billing-inline-qr.js          Überzugsrechnung
 *   4. admin-runtime-voice-errors.js               verständliche ElevenLabs-Fehler
 *   5. admin-runtime-invoice-adjustments.js        Storno und Gutschrift
 *   6. admin-runtime-contract-termination.js       Vertragskündigung
 *   7. admin-runtime-data-integrity.js             Kundendaten schreiben
 *   8. admin-runtime-launch-p0.js                  v2-Endpunkte
 *
 * Die Reihenfolge ist Verhalten, nicht Geschmack: Regel 1 schreibt
 * `mail-dispatch` auf `invoice-mail-dispatch` um, und Regel 2 greift danach
 * nicht mehr, weil sie nur `mail-dispatch` kennt. Jede Regel arbeitet auf dem
 * Ergebnis der vorherigen, genau wie die Wrapper-Kette es tat.
 *
 * Bewusst noch hier: die beiden Nachbearbeitungen (`after`) schreiben in
 * `state` und lösen Neuzeichnen aus. Das gehört fachlich in die Screens und
 * zieht in Welle 4 bzw. 5 dorthin um. Bis dahin stehen sie hier — sichtbar
 * markiert statt in acht Dateien verstreut.
 */
(function (root) {
  'use strict';
  if (!root) return;

  /* ── Konfiguration ──────────────────────────────────────────────────────── */

  var getAccessToken = null;

  function configure(options) {
    if (options && typeof options.getAccessToken === 'function') {
      getAccessToken = options.getAccessToken;
    }
  }

  /* ── Hilfsmittel ────────────────────────────────────────────────────────── */

  var lower = function (value) { return String(value == null ? '' : value).trim().toLowerCase(); };
  var body = function (payload) { return (payload && typeof payload === 'object') ? payload : {}; };

  function requestId(prefix) {
    var random = (root.crypto && typeof root.crypto.randomUUID === 'function')
      ? root.crypto.randomUUID()
      : Math.random().toString(16).slice(2);
    return prefix + '-' + random;
  }

  /* ── Regel 1: Rechnungsmail (aus invoice-mail-routing-fix) ──────────────── */

  var INVOICE_MAIL_TYPES = new Set([
    'invoice_email', 'setup_fee_email', 'subscription_payment_email',
    'reminder_email', 'reminder_final_email'
  ]);
  var PREVIEW_NAMES = new Set(['mail-preview', 'email-preview', 'invoice-mail-preview', 'preview-mail', 'preview-email']);

  function normalizeMailType(payload) {
    var raw = lower(payload.mail_type || payload.event_type || payload.original_mail_type);
    if (raw === 'setup_fee_email' || raw === 'subscription_payment_email') return 'invoice_email';
    if (raw === 'reminder_final_email') return 'reminder_final_email';
    if (raw === 'reminder_email') return 'reminder_email';
    return raw || 'invoice_email';
  }

  function invoiceMailRule(name, payload) {
    var data = body(payload);
    var type = normalizeMailType(data);
    var lowered = lower(name);
    var hasInvoiceContext = Boolean(data.invoice_id || (data.invoice && data.invoice.id) || data.customer_id || data.subscription_id);
    var rawType = lower(data.mail_type || data.event_type || data.original_mail_type);
    var isSupported = INVOICE_MAIL_TYPES.has(rawType) || ['invoice_email', 'reminder_email', 'reminder_final_email'].indexOf(type) >= 0;
    var isDryRun = data.dry_run === true || data.preview === true || data.validate_only === true;
    var isPreview = PREVIEW_NAMES.has(lowered) || (lowered.indexOf('preview') >= 0 && (lowered.indexOf('mail') >= 0 || lowered.indexOf('email') >= 0));
    var isDispatch = lowered === 'mail-dispatch' || lowered === 'invoice-mail-dispatch';

    if (!hasInvoiceContext || !isSupported) return null;

    var rewritten = Object.assign({}, data, {
      invoice_id: data.invoice_id || (data.invoice && data.invoice.id),
      original_mail_type: data.original_mail_type || data.mail_type || data.event_type || type,
      mail_type: type,
      event_type: type
    });

    if (isPreview || (isDispatch && isDryRun)) {
      rewritten.dry_run = true;
      return { name: 'invoice-mail-preview', payload: rewritten };
    }
    if (isDispatch) {
      rewritten.dry_run = false;
      return { name: 'invoice-mail-dispatch', payload: rewritten };
    }
    return null;
  }

  /* ── Regel 2: Alt-Mailtypen und Zahlungslink-Sperre (aus invoice-only-ch) ─ */

  var LEGACY_PAYMENT_ACTIONS = new Set(['send_payment_link', 'send_monthly_payment_link', 'send_yearly_payment_link']);

  function invoiceOnlyChRule(name, payload) {
    var data = body(payload);
    var mailType = lower(data.mail_type || data.event_type);

    if (name === 'mail-dispatch' && INVOICE_MAIL_TYPES.has(mailType)) {
      return {
        name: 'invoice-mail-dispatch',
        payload: Object.assign({}, data, { original_mail_type: mailType, mail_type: mailType, event_type: mailType })
      };
    }
    if (name === 'customer-billing-update' && LEGACY_PAYMENT_ACTIONS.has(lower(data.action))) {
      var error = new Error('Zahlungslinks sind deaktiviert. Bitte eine Swiss-QR-Rechnung erstellen und versenden.');
      error.payload = { error: error.message, step_failed: 'legacy_payment_link_disabled' };
      return { reject: error };
    }
    return null;
  }

  /* ── Regel 3: Überzugsrechnung (aus billing-inline-qr) ───────────────────── */

  function overageRule(name, payload) {
    var data = body(payload);
    if (name !== 'customer-billing-update' || lower(data.action) !== 'create_overage_invoice') return null;
    return {
      name: 'admin-overage-invoice',
      payload: data,
      // → Welle 5: gehört nach screens/billing.js
      after: function (result) {
        if (result && result.invoice && root.state && Array.isArray(root.state.invoices)) {
          var index = root.state.invoices.findIndex(function (row) { return String(row.id) === String(result.invoice.id); });
          if (index >= 0) root.state.invoices[index] = Object.assign({}, root.state.invoices[index], result.invoice);
          else root.state.invoices.unshift(result.invoice);
        }
        if (result && result.success && typeof root.showToast === 'function') {
          root.showToast(result.created === false
            ? 'Überzugsrechnung für diese Periode ist bereits vorhanden.'
            : 'Überzugsrechnung mit Swiss QR Code wurde erstellt.', { tone: 'success' });
        }
      }
    };
  }

  /* ── Regel 4: Storno und Gutschrift (aus invoice-adjustments) ────────────── */

  function invoiceAdjustmentRule(name, payload) {
    var data = body(payload);
    if (name !== 'customer-billing-update') return null;
    var action = lower(data.action);

    if (action === 'cancel_invoice') {
      return {
        name: 'invoice-financial-action',
        payload: {
          action: 'void_draft',
          invoice_id: data.invoice_id,
          reason: data.reason || data.notes || null,
          request_id: data.request_id || requestId('void_draft')
        }
      };
    }
    if (action === 'create_credit_note') {
      return {
        name: 'invoice-financial-action',
        payload: {
          action: 'create_credit',
          invoice_id: data.invoice_id,
          amount: data.amount,
          reason: data.reason || data.description || data.notes,
          request_id: data.request_id || requestId('create_credit')
        }
      };
    }
    return null;
  }

  /* ── Regel 5: Vertragskündigung (aus contract-termination) ───────────────── */

  function contractTerminationRule(name, payload) {
    var data = body(payload);
    if (name !== 'admin-mutate' || lower(data.action) !== 'contracts.cancel') return null;
    return {
      name: 'contract-terminate',
      payload: data.payload || data,
      // → Welle 5: gehört nach screens/contracts.js
      after: function (result) {
        syncTerminatedContract(result);
        if (typeof root.renderAll === 'function') root.renderAll();
        if (result && result.finance_action_required && typeof root.showToast === 'function') {
          var open = (result.open_invoices && result.open_invoices.length) || 0;
          root.showToast(open + ' offene Rechnung(en) bleiben bestehen. Finanzielle Behandlung separat festlegen.', { tone: 'warning' });
        }
      }
    };
  }

  function syncTerminatedContract(result) {
    var state = root.state;
    if (!state || !result || !result.contract) return;
    var updated = result.contract;
    if (Array.isArray(state.contracts)) {
      var index = state.contracts.findIndex(function (item) { return String(item && item.id) === String(updated.id); });
      if (index >= 0) state.contracts[index] = Object.assign({}, state.contracts[index], updated);
    }
    var scheduled = result.termination && result.termination.scheduled;
    if (updated.customer_id && Array.isArray(state.customers) && !scheduled) {
      var customer = state.customers.find(function (item) { return String(item && item.id) === String(updated.customer_id); });
      if (customer) {
        customer.operational_status = 'terminated';
        customer.operational_ended_at = (result.termination && result.termination.effective_at) || new Date().toISOString();
      }
    }
  }

  /* ── Regel 6: Kundendaten schreiben (aus data-integrity) ─────────────────── */

  function customerUpdateRule(name, payload) {
    var data = body(payload);
    if (name !== 'admin-mutate' || lower(data.action) !== 'customers.update') return null;
    return {
      name: 'admin-customer-update',
      payload: { id: data.id, customer_id: data.customer_id, patch: data.patch }
    };
  }

  /* ── Regel 7: v2-Endpunkte (aus launch-p0) ──────────────────────────────── */

  var ENDPOINT_ALIASES = {
    'trigger-elevenlabs-sync': 'trigger-elevenlabs-sync-v2',
    'scrape-website': 'scrape-website-v2'
  };

  function aliasRule(name, payload) {
    var mapped = ENDPOINT_ALIASES[name];
    return mapped ? { name: mapped, payload: payload } : null;
  }

  /* ── Fehlerwörterbuch (aus voice-errors) ────────────────────────────────── */

  var VOICE_ERRORS = {
    payment_required: 'Für individuelle Sprachvorschauen ist ein aktives ElevenLabs-Abonnement oder ausreichendes Guthaben erforderlich.',
    missing_permissions: 'Der ElevenLabs-API-Schlüssel benötigt Zugriff auf Text zu Sprache und Leserechte für Stimmen.',
    quota_exceeded: 'Das ElevenLabs-Guthaben ist aufgebraucht. Bitte Credits oder Abonnement prüfen.',
    credits_exhausted: 'Das ElevenLabs-Guthaben ist aufgebraucht. Bitte Credits oder Abonnement prüfen.'
  };

  function describeError(name, error) {
    if (name !== 'admin-voices' || !error || typeof error !== 'object') return error;
    var code = lower((error.payload && (error.payload.provider_code || error.payload.code)) || error.provider_code);
    var friendly = VOICE_ERRORS[code];
    if (!friendly) return error;
    error.message = friendly;
    if (error.payload && typeof error.payload === 'object') error.payload.error = friendly;
    return error;
  }

  /* ── Die Kette ──────────────────────────────────────────────────────────── */

  var RULES = [
    invoiceMailRule,          // 1
    invoiceOnlyChRule,        // 2
    overageRule,              // 3
    invoiceAdjustmentRule,    // 4
    contractTerminationRule,  // 5
    customerUpdateRule,       // 6
    aliasRule                 // 7 — innerste Schicht, greift auf das Ergebnis aller vorherigen
  ];

  /**
   * Wendet die Regeln der Reihe nach an. Gibt den finalen Endpunkt, die finale
   * Nutzlast und alle gesammelten Nachbearbeitungen zurück.
   */
  function resolve(name, payload) {
    var current = { name: name, payload: payload };
    var after = [];
    for (var index = 0; index < RULES.length; index += 1) {
      var outcome = RULES[index](current.name, current.payload);
      if (!outcome) continue;
      if (outcome.reject) return { reject: outcome.reject };
      current = { name: outcome.name, payload: outcome.payload };
      if (typeof outcome.after === 'function') after.push(outcome.after);
    }
    current.after = after;
    return current;
  }

  /* ── Der eine Aufruf ────────────────────────────────────────────────────── */

  async function request(name, payload) {
    if (typeof getAccessToken !== 'function') throw new Error('Admin-Auth nicht verfügbar.');
    var token = await getAccessToken();

    var response = await fetch('/.netlify/functions/' + name, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(payload || {})
    });

    var json = await response.json().catch(function () { return {}; });
    if (response.ok) return json;

    var message = (json && json.error && json.error.message)
      || (json && json.message)
      || (json && typeof json.error === 'string' ? json.error : '')
      || ('HTTP ' + response.status);
    var error = new Error(message);
    error.status = response.status;
    error.payload = json;
    throw error;
  }

  /**
   * Der einzige Weg zum Server. Ersetzt `callAdminFunction` samt aller acht
   * Wrapper.
   */
  async function call(name, payload) {
    var resolved = resolve(name, payload);
    if (resolved.reject) throw resolved.reject;

    var result;
    try {
      result = await request(resolved.name, resolved.payload);
    } catch (error) {
      throw describeError(resolved.name, error);
    }

    for (var index = 0; index < resolved.after.length; index += 1) {
      try {
        await resolved.after[index](result);
      } catch (afterError) {
        // Eine fehlgeschlagene Nachbearbeitung darf das Ergebnis des Aufrufs
        // nicht verschlucken — der Server hat bereits geantwortet.
        console.warn('[admin-api] Nachbearbeitung fehlgeschlagen für', resolved.name, afterError && afterError.message);
      }
    }
    return result;
  }

  root.VoxeraAdminApi = {
    configure: configure,
    call: call,
    resolve: resolve,      // für Prüfskripte und Tests
    describeError: describeError
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
