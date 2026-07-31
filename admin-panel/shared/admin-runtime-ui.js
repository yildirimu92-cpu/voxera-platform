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

  function addCss() {
    if (document.getElementById('voxera-runtime-ui-css')) return;
    const style = document.createElement('style');
    style.id = 'voxera-runtime-ui-css';
    style.textContent = `
      #overview-kpis,#onboarding-kpis,#finance-kpi-strip{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:0!important;border:1px solid var(--line)!important;border-radius:14px!important;overflow:hidden!important;margin-bottom:16px!important;background:#fff!important;box-shadow:0 1px 2px rgba(15,23,42,.04)!important}
      #overview-kpis>*,#onboarding-kpis>*,#finance-kpi-strip>*{min-width:0!important;padding:16px 18px!important;margin:0!important;border:0!important;border-radius:0!important;background:#fff!important;box-shadow:none!important}
      #overview-kpis>*+*,#onboarding-kpis>*+*,#finance-kpi-strip>*+*{border-left:1px solid var(--line)!important}
      #overview-kpis>:nth-child(1),#onboarding-kpis>:nth-child(1),#finance-kpi-strip>:nth-child(1){background:#ECFDF5!important}
      #overview-kpis>:nth-child(2),#onboarding-kpis>:nth-child(2),#finance-kpi-strip>:nth-child(2){background:#FFFBEB!important}
      #overview-kpis>:nth-child(3),#onboarding-kpis>:nth-child(3),#finance-kpi-strip>:nth-child(3){background:#EFF6FF!important}
      #overview-kpis .kpi-label,#onboarding-kpis .kpi-label,#finance-kpi-strip .bf-kpi-label{font-size:10px!important;font-weight:700!important;text-transform:uppercase!important;letter-spacing:.08em!important;color:#64748B!important;margin-bottom:7px!important}
      #overview-kpis .kpi-value,#onboarding-kpis .kpi-value,#finance-kpi-strip .bf-kpi-value{color:#0D1F3C!important;font-size:25px!important;font-weight:800!important;line-height:1.05!important;letter-spacing:-.035em!important}
      #overview-kpis .kpi-sub,#onboarding-kpis .kpi-sub,#finance-kpi-strip .bf-kpi-sub{font-size:11px!important;color:#64748B!important;margin-top:5px!important;line-height:1.35!important}
      .main .vox-dark-head,.main [style*="background:#0D1F3C"],.main [style*="background: #0D1F3C"]{color:#fff!important}
      .main .vox-dark-head h1,.main .vox-dark-head h2,.main .vox-dark-head h3,.main .vox-dark-head strong,.main [style*="background:#0D1F3C"] h1,.main [style*="background:#0D1F3C"] h2,.main [style*="background:#0D1F3C"] h3,.main [style*="background:#0D1F3C"] strong{color:#fff!important}
      .main .vox-dark-head .muted,.main .vox-dark-head p,.main .vox-dark-head small{color:rgba(255,255,255,.72)!important}
      #overview-activity-list{display:block!important;margin-top:12px}
      .vox-ops{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:14px 16px 16px}
      .vox-op{border:1px solid var(--line);border-radius:12px;background:#F8FAFC;padding:13px 14px;text-align:left;cursor:pointer;font:inherit}
      .vox-op b{display:block;font-size:22px;color:#0D1F3C;margin:5px 0 4px}.vox-op span{font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:.07em;font-weight:700}.vox-op small{font-size:11px;color:#64748B}
      @media(max-width:900px){#overview-kpis,#onboarding-kpis,#finance-kpi-strip{grid-template-columns:1fr 1fr!important}#overview-kpis>:nth-child(3),#onboarding-kpis>:nth-child(3),#finance-kpi-strip>:nth-child(3){grid-column:1/-1;border-left:0!important;border-top:1px solid var(--line)!important}.vox-ops{grid-template-columns:1fr 1fr}}
      @media(max-width:560px){#overview-kpis,#onboarding-kpis,#finance-kpi-strip{grid-template-columns:1fr!important}#overview-kpis>*+*,#onboarding-kpis>*+*,#finance-kpi-strip>*+*{border-left:0!important;border-top:1px solid var(--line)!important}#overview-kpis>:nth-child(3),#onboarding-kpis>:nth-child(3),#finance-kpi-strip>:nth-child(3){grid-column:auto}.vox-ops{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function applyDarkHeaderContrast(root = document) {
    root.querySelectorAll('.card-head,.section-head').forEach(head => {
      const bg = getComputedStyle(head).backgroundColor;
      const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!match) return;
      const r = Number(match[1]), g = Number(match[2]), b = Number(match[3]);
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      head.classList.toggle('vox-dark-head', luminance < 0.46);
    });
  }

  function patchCockpit() {
    try {
      const customers = (state.customers || []).filter(c => life(c) !== 'deleted');
      const live = customers.filter(c => life(c) === 'live').length;
      const mrr = customers.reduce((sum, c) => {
        if (!['live', 'activated', 'invited'].includes(life(c))) return sum;
        const p = typeof planConfigByCode === 'function' ? planConfigByCode(c.plan_code || c.plan) : null;
        return sum + Number(p?.monthly_price || 0);
      }, 0);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const calls = (state.calls || []).filter(x => {
        const d = new Date(x?.raw?.created_at || x?.created_at || '');
        return !Number.isNaN(d.getTime()) && d >= start;
      }).length;
      const k = document.getElementById('overview-kpis');
      if (k) k.innerHTML = `<div class="kpi"><div class="kpi-label">Live</div><div class="kpi-value">${live}</div><div class="kpi-sub">Kunden aktiv</div></div><div class="kpi"><div class="kpi-label">MRR</div><div class="kpi-value">CHF ${mrr.toLocaleString('de-CH')}</div><div class="kpi-sub">Monatlich wiederkehrend</div></div><div class="kpi"><div class="kpi-label">Anrufe heute</div><div class="kpi-value">${calls}</div><div class="kpi-sub">Seit Mitternacht</div></div>`;

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
    addCss(); applyDarkHeaderContrast();
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
    patchCockpit(); billingKpis(); applyDarkHeaderContrast();
    setTimeout(() => { patchCockpit(); billingKpis(); applyDarkHeaderContrast(); }, 1600);
    const contrastObserver = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === 1) applyDarkHeaderContrast(node.matches?.('.card-head,.section-head') ? node.parentElement || node : node);
      }));
    });
    contrastObserver.observe(document.querySelector('.main') || document.body, { childList: true, subtree: true });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
