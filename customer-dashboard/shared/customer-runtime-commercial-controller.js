(function installCommercialController(root) {
  'use strict';
  if (!root || !root.document || root.__vxCommercialControllerInstalled) return;
  root.__vxCommercialControllerInstalled = true;

  const ENDPOINT = '/.netlify/functions/customer-commercial-request';
  const PLAN_ORDER = ['starter', 'business', 'professional'];
  const PLAN_CATALOG = {
    business: { title: 'Business', price: 249, minutes: 150 },
    professional: { title: 'Professional', price: 399, minutes: 350 }
  };

  function normalizePlan(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text.includes('enterprise')) return 'enterprise';
    if (text.includes('professional') || text === 'pro') return 'professional';
    if (text.includes('business') || text.includes('standard')) return 'business';
    if (text.includes('starter') || text.includes('basic')) return 'starter';
    return '';
  }

  function currentPlan() {
    const nodes = [
      root.document.querySelector('.vx-abo-plan-name'),
      root.document.getElementById('abo-plan-name'),
      root.document.querySelector('[data-current-plan]'),
      root.document.querySelector('.vx-abo-hero')
    ].filter(Boolean);
    for (const node of nodes) {
      const value = normalizePlan((node.dataset && node.dataset.currentPlan) || node.textContent);
      if (value) return value;
    }
    try {
      const state = typeof root.getUpgradeModalState === 'function' ? root.getUpgradeModalState() : null;
      const value = normalizePlan(state && state.currentPlan);
      if (value) return value;
    } catch (_error) {}
    try {
      const value = normalizePlan(root.customerMeta && root.customerMeta.plan);
      if (value) return value;
    } catch (_error) {}
    return '';
  }

  async function token() {
    const client = typeof root.getSupabaseAuthClient === 'function' ? root.getSupabaseAuthClient() : root._sb;
    if (!client || !client.auth) return '';
    const result = await client.auth.getSession();
    return String(result && result.data && result.data.session && result.data.session.access_token || '');
  }

  function state(next) {
    root.vxCommercialState = Object.assign({
      type: '', selected: '', options: [], estimatedAmount: null,
      submitting: false, submitted: false, existingRequest: null
    }, next || {});
    return root.vxCommercialState;
  }

  function copyFor(s) {
    const enterprise = s.type === 'plan_upgrade' && s.selected === 'enterprise';
    if (s.existingRequest) return {
      summary: 'Ihre Anfrage wurde bereits eingereicht. Unser Team prüft sie und meldet sich bei Ihnen.',
      successTitle: 'Anfrage in Bearbeitung', successText: 'Wir melden uns persönlich bei Ihnen.'
    };
    if (enterprise) return {
      summary: 'Nach dem Absenden meldet sich unser Team persönlich bei Ihnen.',
      successTitle: 'Anfrage erhalten', successText: 'Wir melden uns persönlich bei Ihnen.'
    };
    if (s.type === 'plan_upgrade') return {
      summary: 'Nach dem Absenden wird Ihr neuer Plan innerhalb von 24 Stunden aufgeschaltet.',
      successTitle: 'Bestellung erhalten', successText: 'Ihr neuer Plan wird innerhalb von 24 Stunden aufgeschaltet.'
    };
    return {
      summary: 'Nach dem Absenden werden die Zusatzminuten sofort aufgeschaltet. Sie erhalten dafür eine Rechnung.',
      successTitle: 'Bestellung erhalten', successText: 'Die Zusatzminuten werden sofort aufgeschaltet. Die Rechnung folgt separat.'
    };
  }

  function render() {
    const s = root.vxCommercialState || state();
    const body = root.document.getElementById('vx-commercial-body');
    const title = root.document.getElementById('vx-commercial-title');
    const subtitle = root.document.getElementById('vx-commercial-subtitle');
    const submit = root.document.getElementById('vx-commercial-submit');
    if (!body || !title || !subtitle || !submit) return;

    title.textContent = s.type === 'plan_upgrade' ? 'Plan wechseln' : 'Zusatzminuten';
    subtitle.textContent = s.type === 'plan_upgrade'
      ? (s.existingRequest ? 'Ihre bestehende Anfrage.' : 'Wählen Sie den gewünschten Plan.')
      : 'Wählen Sie ein einmaliges Minutenpaket.';

    const options = (s.options || []).map(function(option) {
      const selected = String(option.value) === String(s.selected);
      const disabled = !!s.existingRequest || !!s.submitted;
      return '<button type="button" class="vx-commercial-choice' + (selected ? ' is-selected' : '') + '" data-vx-commercial-value="' + option.value + '"' + (disabled ? ' disabled' : '') + '>'
        + '<span><strong>' + option.title + '</strong><small>' + option.meta + '</small></span>'
        + '<span class="vx-commercial-radio" aria-hidden="true"></span></button>';
    }).join('');

    const copy = copyFor(s);
    const success = (s.submitted || s.existingRequest)
      ? '<div class="vx-commercial-status" data-state="success"><strong>' + copy.successTitle + '</strong><small>' + copy.successText + '</small></div>'
      : '<div id="vx-commercial-status" class="vx-commercial-status" role="status" aria-live="polite"></div>';

    body.innerHTML = '<div class="vx-commercial-choice-grid">' + options + '</div>'
      + '<div class="vx-commercial-summary"><strong>So funktioniert es</strong><p>' + copy.summary + '</p></div>' + success;

    body.querySelectorAll('[data-vx-commercial-value]').forEach(function(button) {
      button.addEventListener('click', function() { select(button.dataset.vxCommercialValue); });
    });

    submit.disabled = !s.selected || s.submitting || s.submitted || !!s.existingRequest;
    if (s.existingRequest) submit.textContent = 'Bereits übermittelt';
    else if (s.submitted) submit.textContent = 'Erhalten';
    else if (s.submitting) submit.textContent = 'Wird übermittelt …';
    else submit.textContent = (s.type === 'plan_upgrade' && s.selected === 'enterprise')
      ? 'Anfrage verbindlich übermitteln'
      : 'Bestellung verbindlich übermitteln';
  }

  function open() {
    const overlay = root.document.getElementById('vx-commercial-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    if (typeof root.syncOverlayScrollLock === 'function') root.syncOverlayScrollLock();
  }

  function close() {
    const overlay = root.document.getElementById('vx-commercial-overlay');
    if (overlay) { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); }
    state();
    if (typeof root.syncOverlayScrollLock === 'function') root.syncOverlayScrollLock();
  }

  function select(value) {
    const s = root.vxCommercialState || state();
    if (s.submitted || s.existingRequest) return;
    s.selected = String(value || '');
    const option = s.options.find(function(item) { return String(item.value) === s.selected; });
    s.estimatedAmount = option && Number.isFinite(Number(option.estimatedAmount)) ? Number(option.estimatedAmount) : null;
    render();
  }

  function planOptions(plan) {
    if (plan === 'professional' || plan === 'enterprise') {
      return [{ value: 'enterprise', title: 'Enterprise', meta: 'Individuelles Volumen, mehrere Standorte, Integrationen und erweiterter Support' }];
    }
    const index = PLAN_ORDER.indexOf(plan);
    if (index < 0) return [{ value: 'enterprise', title: 'Enterprise', meta: 'Wir prüfen Ihren Bedarf und melden uns persönlich bei Ihnen.' }];
    return PLAN_ORDER.slice(index + 1).filter(function(key) { return PLAN_CATALOG[key]; }).map(function(key) {
      const item = PLAN_CATALOG[key];
      return { value: key, title: item.title, meta: 'CHF ' + item.price + ' / Mt · ' + item.minutes + ' Min. inklusive' };
    });
  }

  async function activePlanRequest() {
    const accessToken = await token();
    if (!accessToken) return null;
    const response = await root.fetch(ENDPOINT, { method: 'GET', headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' } });
    if (!response.ok) return null;
    const json = await response.json();
    return json && json.active_plan_request || null;
  }

  async function upgrade() {
    const existing = await activePlanRequest().catch(function() { return null; });
    if (existing) {
      const date = existing.created_at ? new Intl.DateTimeFormat('de-CH').format(new Date(existing.created_at)) : '';
      state({ type: 'plan_upgrade', selected: 'existing', existingRequest: existing, options: [{ value: 'existing', title: 'Anfrage in Bearbeitung', meta: (existing.title || 'Plananfrage') + (date ? ' · Eingereicht am ' + date : '') }] });
    } else {
      const options = planOptions(currentPlan());
      state({ type: 'plan_upgrade', selected: options.length === 1 && options[0].value === 'enterprise' ? 'enterprise' : '', options: options });
    }
    render(); open();
  }

  function minutes() {
    let rate = 0;
    try {
      const cfg = typeof root.getPlanConfigEntryForPlan === 'function' ? root.getPlanConfigEntryForPlan(currentPlan()) : null;
      rate = Number(cfg && cfg.extraRate || 0);
    } catch (_error) {}
    const options = [50, 100, 250, 500].map(function(amount) {
      const estimate = rate > 0 ? Math.round(rate * amount * 100) / 100 : null;
      return { value: String(amount), title: amount + ' Minuten', meta: estimate == null ? 'Betrag gemäss Vertrag' : 'Voraussichtlich CHF ' + estimate.toFixed(2), estimatedAmount: estimate };
    });
    state({ type: 'extra_minutes', selected: '', options: options });
    render(); open();
  }

  async function submit() {
    const s = root.vxCommercialState || state();
    if (!s.type || !s.selected || s.submitting || s.submitted || s.existingRequest) return;
    s.submitting = true; render();
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error('Sitzung abgelaufen. Bitte melden Sie sich erneut an.');
      const payload = { type: s.type, request_id: root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : 'commercial-' + Date.now(), keep_billing_cycle: true };
      if (s.type === 'plan_upgrade') payload.target_plan = s.selected;
      else { payload.minutes = Number(s.selected); payload.estimated_amount = s.estimatedAmount; }
      const response = await root.fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify(payload) });
      const json = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(json.error || 'Übermittlung fehlgeschlagen.');
      s.submitting = false; s.submitted = true; render();
      if (typeof root.toast === 'function') root.toast(s.type === 'extra_minutes' ? 'Bestellung erhalten.' : 'Anfrage erhalten.');
    } catch (error) {
      s.submitting = false; render();
      const status = root.document.getElementById('vx-commercial-status');
      if (status) { status.dataset.state = 'error'; status.textContent = error.message || 'Übermittlung fehlgeschlagen.'; }
    }
  }

  function install() {
    root.vxCommercialRender = render;
    root.vxCommercialSelect = select;
    root.vxCommercialOpen = open;
    root.vxCommercialClose = close;
    root.vxAboUpgrade = upgrade;
    root.vxAboMinuten = minutes;
    root.vxCommercialSubmit = submit;
    root.requestUpgrade = upgrade;
    root.requestExtraMinutes = minutes;
    root.sendUpgradeRequest = submit;
    root.sendMinutesRequest = submit;
  }

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : this);
