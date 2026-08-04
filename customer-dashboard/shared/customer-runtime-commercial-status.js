(function installCustomerCommercialStatus(root) {
  'use strict';
  if (!root || !root.document || root.__vxCommercialStatusInstalled) return;
  root.__vxCommercialStatusInstalled = true;

  const endpoint = '/.netlify/functions/customer-commercial-request';

  async function getAccessToken() {
    const client = typeof root.getSupabaseAuthClient === 'function'
      ? root.getSupabaseAuthClient()
      : (root._sb || null);
    if (!client || !client.auth || typeof client.auth.getSession !== 'function') return '';
    const result = await client.auth.getSession();
    return String(result && result.data && result.data.session && result.data.session.access_token || '').trim();
  }

  async function loadActivePlanRequest() {
    const token = await getAccessToken();
    if (!token) return null;
    const response = await root.fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload && payload.active_plan_request || null;
  }

  function formatDate(value) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat('de-CH', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).format(new Date(value));
    } catch (_error) {
      return '';
    }
  }

  function renderExistingRequest(request) {
    if (typeof root.vxCommercialRender !== 'function' || typeof root.vxCommercialOpen !== 'function') return false;
    const date = formatDate(request && request.created_at);
    const title = String(request && request.title || 'Plananfrage').trim();

    root.vxCommercialState = {
      type: 'plan_upgrade',
      selected: 'existing_request',
      options: [{
        value: 'existing_request',
        title: 'Anfrage in Bearbeitung',
        meta: `${title}${date ? ` · Eingereicht am ${date}` : ''}`
      }],
      estimatedAmount: null,
      submitting: false,
      existingRequest: request
    };

    root.vxCommercialRender();
    root.vxCommercialOpen();

    root.setTimeout(function decorateExistingRequest() {
      const subtitle = root.document.getElementById('vx-commercial-subtitle');
      if (subtitle) subtitle.textContent = 'Ihre bestehende Anfrage wird bereits bearbeitet.';

      const summary = root.document.querySelector('#vx-commercial-body .vx-commercial-summary');
      if (summary) {
        summary.innerHTML = '<strong>Anfrage erhalten</strong><p>Unser Team prüft Ihre Anfrage und meldet sich bei Ihnen. Eine weitere Plananfrage ist während der Bearbeitung nicht nötig.</p>';
      }

      const status = root.document.getElementById('vx-commercial-status');
      if (status) {
        status.dataset.state = 'success';
        status.innerHTML = '<strong>Status: In Bearbeitung</strong><small>Wir melden uns bei Ihnen.</small>';
      }

      const submit = root.document.getElementById('vx-commercial-submit');
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Bereits übermittelt';
        submit.setAttribute('aria-disabled', 'true');
      }
    }, 0);
    return true;
  }

  function wrapUpgradeFunction() {
    const current = root.vxAboUpgrade;
    if (typeof current !== 'function') return false;
    if (current.__vxCommercialStatusOwner) return true;

    async function ownedUpgrade() {
      try {
        const active = await loadActivePlanRequest();
        if (active) return renderExistingRequest(active);
      } catch (error) {
        console.warn('[commercial-status] status lookup failed', error);
      }
      return current.apply(this, arguments);
    }

    ownedUpgrade.__vxCommercialStatusOwner = true;
    ownedUpgrade.__vxCommercialStatusOriginal = current;
    root.vxAboUpgrade = ownedUpgrade;
    return true;
  }

  function boot(attempt) {
    const installed = wrapUpgradeFunction();
    if (attempt < 30) {
      root.setTimeout(function retryOwner() {
        if (!root.vxAboUpgrade || !root.vxAboUpgrade.__vxCommercialStatusOwner) {
          wrapUpgradeFunction();
        }
        boot(attempt + 1);
      }, installed ? 250 : 120);
    }
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', function () { boot(0); }, { once: true });
  } else {
    boot(0);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
