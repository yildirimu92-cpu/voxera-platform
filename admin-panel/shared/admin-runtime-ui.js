(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  function ready(fn) {
    if (document.readyState === 'complete') setTimeout(fn, 0);
    else w.addEventListener('load', fn, { once: true });
  }

  function evidence(inv) {
    const r = inv?.raw || {};
    return Boolean(inv && (
      inv.sent_at || inv.email_sent_at || inv.last_sent_at || inv.dispatched_at || inv.mail_sent_at || inv.delivery_requested_at ||
      r.sent_at || r.email_sent_at || r.last_sent_at || r.dispatched_at || r.mail_sent_at || r.delivery_requested_at
    ));
  }

  function life(c) {
    try { return getCustomerLifecycleStatus(c, onboardingForCustomer(c.id)); }
    catch (_) { return String(c?.status || '').toLowerCase(); }
  }

  function installOperationalOnboardingSemantics() {
    const snapshotOriginal = typeof w.deriveOnboardingSnapshot === 'function' ? w.deriveOnboardingSnapshot : null;
    if (snapshotOriginal && !snapshotOriginal.__voxOperationalSetup) {
      const wrappedSnapshot = function (customerId) {
        const snapshot = snapshotOriginal.apply(this, arguments);
        if (!snapshot) return snapshot;

        const appState = typeof state !== 'undefined' ? state : w.state;
        const checklist = Array.isArray(appState?.checklist) ? appState.checklist : [];
        const isPortalActivationStep = step => /dashboard\s*access\s*active|portal.*activ|kundenportal.*aktiv/i.test(String(step || ''));
        const operationalSteps = checklist.filter(step => !isPortalActivationStep(step));
        if (!operationalSteps.length || operationalSteps.length === checklist.length) {
          return Object.assign({}, snapshot, { operationalComplete: Number(snapshot.progress || 0) >= 100 });
        }

        const doneSet = snapshot.doneSet instanceof Set
          ? new Set(snapshot.doneSet)
          : new Set(Array.isArray(snapshot.doneSteps) ? snapshot.doneSteps : []);
        const missingSteps = operationalSteps.filter(step => !doneSet.has(step));
        const doneSteps = operationalSteps.filter(step => doneSet.has(step));
        const progress = Math.round((doneSteps.length / operationalSteps.length) * 100);
        const operationalComplete = missingSteps.length === 0;

        return Object.assign({}, snapshot, {
          operationalComplete,
          operationalProgress: progress,
          progress,
          doneSteps,
          missingSteps,
          missingSet: new Set(missingSteps),
          currentStep: doneSteps.length ? doneSteps[doneSteps.length - 1] : 'Noch nicht gestartet',
          nextStep: operationalComplete ? 'completed' : (missingSteps[0] || snapshot.nextStep),
          blockerStep: operationalComplete ? null : snapshot.blockerStep,
          blocker: operationalComplete ? null : snapshot.blocker,
          status: operationalComplete
            ? (w.ONBOARDING_STATUS?.COMPLETED || 'completed')
            : snapshot.status
        });
      };
      wrappedSnapshot.__voxOperationalSetup = true;
      w.deriveOnboardingSnapshot = wrappedSnapshot;
    }

    const lifecycleOriginal = typeof w.getCustomerLifecycleStatus === 'function' ? w.getCustomerLifecycleStatus : null;
    if (lifecycleOriginal && !lifecycleOriginal.__voxOperationalSetup) {
      let operationalLifecycleDepth = 0;
      const wrappedLifecycle = function (customer, onboarding) {
        const base = lifecycleOriginal.apply(this, arguments);
        if (operationalLifecycleDepth > 0) return base;
        operationalLifecycleDepth += 1;
        try {
          const snapshot = customer?.id && typeof w.deriveOnboardingSnapshot === 'function'
            ? w.deriveOnboardingSnapshot(customer.id)
            : null;
          if (snapshot?.operationalComplete && !['live', 'paused', 'deleted'].includes(String(base || '').toLowerCase())) {
            return 'activated';
          }
          return base;
        } finally {
          operationalLifecycleDepth -= 1;
        }
      };
      wrappedLifecycle.__voxOperationalSetup = true;
      w.getCustomerLifecycleStatus = wrappedLifecycle;
      if (typeof w.getCanonicalCustomerStatus === 'function') w.getCanonicalCustomerStatus = wrappedLifecycle;

      const labelOriginal = typeof w.getCustomerLifecycleLabel === 'function' ? w.getCustomerLifecycleLabel : null;
      w.getCustomerLifecycleLabel = function (customer, onboarding) {
        const status = w.getCustomerLifecycleStatus(customer, onboarding);
        return w.CUSTOMER_LIFECYCLE_LABELS?.[status]
          || (status === 'activated' ? 'Aktiv' : (labelOriginal ? labelOriginal(customer, onboarding) : status));
      };
      w.getCustomerLifecycleStatusLabel = w.getCustomerLifecycleLabel;

      const badgeOriginal = typeof w.getCustomerLifecycleBadge === 'function' ? w.getCustomerLifecycleBadge : null;
      if (badgeOriginal) {
        w.getCustomerLifecycleBadge = function (customer, onboarding) {
          const status = w.getCustomerLifecycleStatus(customer, onboarding);
          return badgeOriginal(Object.assign({}, customer, { status }), onboarding);
        };
      }
    }
  }

  // Die Stilregeln dieser Datei stehen seit Welle 2 Teil 3 in
  // shared/admin-screens.css. Die Funktion addCss() und ihr Aufruf sind
  // entfallen -- ein zur Laufzeit eingefuegtes Stylesheet gewann nur deshalb,
  // weil es zuletzt kam, und brauchte dafuer !important.

  function patchCockpit() {
    try {
      const customers = (state.customers || []).filter(c => life(c) !== 'deleted');
      const liveCustomers = customers.filter(c => life(c) === 'live');
      const live = liveCustomers.length;
      const mrr = liveCustomers.reduce((sum, c) => {
        const contract = typeof latestContractForCustomer === 'function' ? latestContractForCustomer(c.id) : null;
        if (contract && ['active', 'signed'].includes(String(contract.status || '').toLowerCase())) {
          const cycle = String(contract.billingCycle || c.subscription_billing_cycle || 'monthly').toLowerCase();
          const amount = cycle === 'yearly'
            ? Number(contract.recurringAmountYearly || 0) / 12
            : Number(contract.recurringAmountMonthly || 0);
          if (Number.isFinite(amount) && amount > 0) return sum + amount;
        }
        const plan = typeof planConfigByCode === 'function' ? planConfigByCode(c.plan_code || c.plan) : null;
        return sum + Number(plan?.monthly_price || 0);
      }, 0);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const calls = (state.calls || []).filter(x => {
        const d = new Date(x?.raw?.created_at || x?.created_at || '');
        return !Number.isNaN(d.getTime()) && d >= start;
      }).length;
      const k = document.getElementById('overview-kpis');
      if (k) k.innerHTML = `<div class="kpi"><div class="kpi-label">Live</div><div class="kpi-value">${live}</div><div class="kpi-sub">Kunden produktiv aktiv</div></div><div class="kpi"><div class="kpi-label">MRR</div><div class="kpi-value">CHF ${mrr.toLocaleString('de-CH',{maximumFractionDigits:2})}</div><div class="kpi-sub">Nur Live-Kunden</div></div><div class="kpi"><div class="kpi-label">Anrufe heute</div><div class="kpi-value">${calls}</div><div class="kpi-sub">Seit Mitternacht</div></div>`;

      const drafts = (state.invoices || []).filter(inv => {
        let type = String(inv.invoice_type || inv.type || '').toLowerCase();
        try { type = classifyInvoiceType(type); } catch (_) {}
        return String(inv.status || '').toLowerCase() === 'draft' && !evidence(inv) && ['setup_fee', 'recurring', 'extra_minutes'].includes(type);
      }).length;
      const now = document.getElementById('overview-now-list');
      if (now) {
        [...now.querySelectorAll('.list-item')].forEach(row => { if (/Entwurf|Draft-Rechnung/i.test(row.textContent || '')) row.remove(); });
        if (drafts) now.insertAdjacentHTML('beforeend', `<div class="list-item overview-task-item"><div><div class="list-main">${drafts} ${drafts === 1 ? 'Entwurf noch nicht versendet' : 'Entwurfsrechnungen noch nicht versendet'}</div><div class="list-sub">Nur Rechnungen ohne Versandnachweis</div></div><button class="btn btn-quiet btn-sm" onclick="setRoute('billing-finance')">Öffnen</button></div>`);
        if (!now.querySelector('.list-item')) now.innerHTML = '<div class="empty" style="padding:16px 0">Kein Handlungsbedarf heute.</div>';
      }

      const accepted = (state.offers || []).filter(o => {
        if (String(o.status || '').toLowerCase() !== 'accepted' || String(o.contractId || o.contract_id || '').trim()) return false;
        return !(state.contracts || []).some(ct => {
          const sameOffer = String(ct.offerId || ct.offer_id || '') === String(o.id || '');
          const sameCustomer = o.customerId && String(ct.customerId || ct.customer_id || '') === String(o.customerId) && ['signed', 'active'].includes(String(ct.status || '').toLowerCase());
          return sameOffer || sameCustomer;
        });
      }).length;
      const process = document.getElementById('overview-process-list');
      if (process) {
        [...process.querySelectorAll('.list-item')].forEach(row => { if (/akzeptierte Offerte|Offerten akzeptiert/i.test(row.textContent || '')) row.remove(); });
        if (accepted) process.insertAdjacentHTML('beforeend', `<div class="list-item overview-task-item"><div><div class="list-main">${accepted} ${accepted === 1 ? 'akzeptierte Offerte' : 'akzeptierte Offerten'} ohne Vertrag</div><div class="list-sub">Bereits umgewandelte Offerten werden ausgeblendet</div></div><button class="btn btn-quiet btn-sm" onclick="setRoute('offers')">Öffnen</button></div>`);
        if (!process.querySelector('.list-item')) process.innerHTML = '<div class="empty" style="padding:16px 0">Nichts offen.</div>';
      }

      const onboarding = customers.filter(c => ['onboarding', 'ready', 'invited', 'activated'].includes(life(c))).length;
      const invoices = (state.invoices || []).filter(inv => {
        const s = String(inv.status || '').toLowerCase();
        return ['open', 'sent', 'overdue'].includes(s) || (s === 'draft' && !evidence(inv));
      }).length;
      const sync = customers.filter(c => String(c.elevenlabs_sync_status || '').toLowerCase() === 'error').length;
      const cases = (state.cases || []).filter(c => !['done', 'closed', 'resolved'].includes(String(c.status || '').toLowerCase())).length;
      const activity = document.getElementById('overview-activity-list');
      if (activity) activity.innerHTML = `<div class="card"><div class="card-head"><h3>Betrieb im Blick</h3><span class="badge badge-blue">Live-Übersicht</span></div><div class="vox-ops"><button class="vox-op" onclick="setRoute('onboarding')"><span>Onboarding</span><b>${onboarding}</b><small>aktive Setups</small></button><button class="vox-op" onclick="setRoute('billing-finance')"><span>Rechnungen</span><b>${invoices}</b><small>offen oder nachzuverfolgen</small></button><button class="vox-op" onclick="setRoute('ai-setup');setTimeout(()=>aiShowTab('sync'),100)"><span>AI Sync</span><b>${sync}</b><small>Fehler mit Handlungsbedarf</small></button><button class="vox-op" onclick="setRoute('cases')"><span>Cases</span><b>${cases}</b><small>offene Anliegen</small></button></div></div>`;
    } catch (err) { console.warn('[runtime-ui] cockpit:', err); }
  }

  function billingKpis() {
    const root = document.getElementById('finance-kpi-strip');
    if (!root) return;
    let cash = 0, open = 0, mrr = 0;
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    (state.invoices || []).forEach(inv => {
      const s = String(inv.status || '').toLowerCase(), amount = Number(inv.total_amount || inv.amount || 0), paid = inv.paid_at ? new Date(inv.paid_at) : null;
      if (s === 'paid' && paid && paid >= start) cash += amount;
      if (['open', 'sent', 'overdue'].includes(s) || (s === 'draft' && !evidence(inv))) open += amount;
    });
    (state.customers || []).forEach(c => {
      const ct = typeof latestContractForCustomer === 'function' ? latestContractForCustomer(c.id) : null;
      if (!ct || !['active', 'signed'].includes(String(ct.status || '').toLowerCase())) return;
      mrr += String(ct.billingCycle || c.subscription_billing_cycle || 'monthly').toLowerCase() === 'yearly' ? Number(ct.recurringAmountYearly || 0) / 12 : Number(ct.recurringAmountMonthly || 0);
    });
    const money = n => `CHF ${Number(n).toFixed(2)}`;
    root.innerHTML = `<div class="bf-kpi-card"><div class="bf-kpi-label">Cash-In Monat</div><div class="bf-kpi-value">${money(cash)}</div><div class="bf-kpi-sub">Bezahlt im laufenden Monat</div></div><div class="bf-kpi-card"><div class="bf-kpi-label">Offener Betrag</div><div class="bf-kpi-value">${money(open)}</div><div class="bf-kpi-sub">Nicht versendete Drafts + offene Rechnungen</div></div><div class="bf-kpi-card"><div class="bf-kpi-label">MRR</div><div class="bf-kpi-value">${money(mrr)}</div><div class="bf-kpi-sub">Aktive Subscriptions</div></div>`;
  }

  ready(() => {
    installOperationalOnboardingSemantics();
    const overview = typeof renderOverview === 'function' ? renderOverview : null;
    if (overview) renderOverview = function () { const r = overview.apply(this, arguments); patchCockpit(); return r; };
    const onboarding = typeof renderOnboarding === 'function' ? renderOnboarding : null;
    if (onboarding) renderOnboarding = function () { return onboarding.apply(this, arguments); };
    if (typeof renderBillingKpiStrip === 'function') renderBillingKpiStrip = billingKpis;
    const today = typeof renderBillingTodayBlocks === 'function' ? renderBillingTodayBlocks : null;
    if (today) renderBillingTodayBlocks = function () {
      const original = state.invoices;
      state.invoices = (original || []).map(inv => String(inv.status || '').toLowerCase() === 'draft' && evidence(inv) ? Object.assign({}, inv, { status: 'open' }) : inv);
      try { return today.apply(this, arguments); } finally { state.invoices = original; }
    };
    patchCockpit(); billingKpis();
    setTimeout(() => { patchCockpit(); billingKpis(); }, 1600);
    // Der Beobachter, der neue Kopfzeilen nachvermessen hat, ist mit der
    // Kontrast-Heuristik entfallen (Welle 2).
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
