(function installCustomerSettingsPolish(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerSettingsPolishInstalled) return;
  root.__vxCustomerSettingsPolishInstalled = true;

  function ensureDesignOwner() {
    if (root.document.body) root.document.body.classList.add('vx-customer-design-foundation');
  }

  function installStyles() {
    if (root.document.getElementById('vx-settings-polish-styles')) return;
    const style = root.document.createElement('style');
    style.id = 'vx-settings-polish-styles';
    style.textContent = `
      #mehr-sub-profil,
      #tab-hilfe { color: #0f172a; }
      #mehr-sub-profil .vx-page-header,
      #tab-hilfe .vx-page-header { margin-bottom:18px;padding:22px 24px;border-radius:22px;background:#10213f;color:#fff; }
      #mehr-sub-profil .vx-page-header-title,
      #tab-hilfe .vx-page-header-title { color:#fff;font-size:clamp(28px,5vw,40px);font-weight:780;letter-spacing:-.035em; }
      #mehr-sub-profil .vx-page-header-subtitle,
      #tab-hilfe .vx-page-header-subtitle { margin-top:4px;color:rgba(255,255,255,.64);font-size:14px; }
      #mehr-sub-profil .vx-settings-card,
      #tab-hilfe .vx-settings-card { overflow:hidden;margin-bottom:16px;border:1px solid #dbe4ef;border-radius:22px;background:#fff;box-shadow:0 4px 16px rgba(15,35,71,.05); }
      #mehr-sub-profil .vx-settings-card-head,
      #tab-hilfe .vx-settings-card-head { padding:20px 22px 0; }
      #mehr-sub-profil .vx-settings-card-title,
      #tab-hilfe .vx-settings-card-title { margin:0;color:#0f172a;font-size:19px;font-weight:760; }
      #mehr-sub-profil .vx-settings-card-meta,
      #tab-hilfe .vx-settings-card-meta { margin-top:4px;color:#64748b;line-height:1.5; }
      #mehr-sub-profil .vx-settings-card-body { padding:18px 22px 22px; }
      #mehr-sub-profil .vx-settings-identity { display:flex;align-items:center;gap:14px;padding:20px 22px;background:#10213f; }
      #mehr-sub-profil .vx-settings-field :is(input,select) { box-sizing:border-box;width:100%;min-height:48px;padding:0 14px;border:1px solid #dbe4ef;border-radius:12px;background:#f8fafc;color:#0f172a;font:inherit; }
      #mehr-sub-profil .vx-settings-actions .btn { min-height:48px;border-radius:13px; }
      #tab-hilfe .vx-help-action-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:20px 22px 22px; }
      #tab-hilfe .vx-help-action { display:grid;justify-items:center;gap:7px;padding:18px 12px;border:1px solid #dbe4ef;border-radius:16px;background:#fff;color:#0f172a;text-align:center; }
      #tab-hilfe .vx-help-action>span { display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:#eef4ff;color:#3478ed;font-size:21px; }
      #tab-hilfe .vx-help-step-list,
      #tab-hilfe .vx-help-faq { margin:0;padding:20px 22px 22px; }
      #tab-hilfe .vx-help-faq details { padding:16px 0;border-bottom:1px solid #e5ebf2; }
      #tab-hilfe .vx-help-faq details:last-child { border-bottom:0; }
      @media(max-width:600px){
        #mehr-sub-profil .vx-page-header,#tab-hilfe .vx-page-header{margin:0 0 16px;padding:20px;border-radius:18px;}
        #tab-hilfe .vx-help-action-grid{grid-template-columns:1fr;padding:16px;}
        #tab-hilfe .vx-help-action{grid-template-columns:46px minmax(0,1fr);justify-items:start;text-align:left;}
        #tab-hilfe .vx-help-action small{grid-column:2;}
      }
    `;
    root.document.head.appendChild(style);
  }

  function normalizePlan(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    if (text.includes('enterprise')) return 'enterprise';
    if (text.includes('professional') || text === 'pro') return 'professional';
    if (text.includes('business')) return 'business';
    if (text.includes('starter') || text.includes('basic')) return 'starter';
    return '';
  }

  function resolveCurrentPlan() {
    try {
      if (typeof root.getUpgradeModalState === 'function') {
        const state = root.getUpgradeModalState();
        const resolved = normalizePlan(state && state.currentPlan);
        if (resolved) return resolved;
      }
    } catch (_error) {}

    const planNodes = [
      root.document.getElementById('abo-plan-name'),
      root.document.getElementById('subscription-plan-name'),
      root.document.querySelector('[data-current-plan]')
    ].filter(Boolean);
    for (const node of planNodes) {
      const resolved = normalizePlan(node.dataset?.currentPlan || node.textContent);
      if (resolved) return resolved;
    }

    try {
      const meta = root.customerMeta;
      const resolved = normalizePlan(meta && meta.plan);
      if (resolved) return resolved;
    } catch (_error) {}
    return '';
  }

  function installEnterpriseUpgrade() {
    if (root.__vxEnterpriseUpgradeInstalled) return true;
    if (typeof root.vxCommercialRender !== 'function' || typeof root.vxCommercialOpen !== 'function') return false;

    root.vxAboUpgrade = function openUpgradeWithEnterprise() {
      const currentPlan = resolveCurrentPlan();
      const order = ['starter', 'business', 'professional'];
      const catalog = {
        starter: { title: 'Starter', price: 149, minutes: 60 },
        business: { title: 'Business', price: 249, minutes: 150 },
        professional: { title: 'Professional', price: 399, minutes: 350 }
      };
      const currentIndex = order.indexOf(currentPlan);
      const options = [];

      if (currentIndex >= 0) {
        order.forEach(function(plan, index) {
          if (index <= currentIndex) return;
          const item = catalog[plan];
          options.push({
            value: plan,
            title: item.title,
            meta: 'CHF ' + item.price + ' / Mt · ' + item.minutes + ' Min. inklusive'
          });
        });
      }

      if (currentPlan === 'professional' || currentPlan === 'enterprise' || options.length === 0) {
        options.length = 0;
        options.push({
          value: 'enterprise',
          title: 'Enterprise',
          meta: 'Individuelles Volumen, mehrere Standorte, Integrationen und erweiterter Support'
        });
      }

      root.vxCommercialState = {
        type: 'plan_upgrade',
        selected: '',
        options: options,
        estimatedAmount: null,
        submitting: false
      };
      root.vxCommercialRender();
      root.vxCommercialOpen();
    };

    root.__vxEnterpriseUpgradeInstalled = true;
    return true;
  }

  function boot() {
    ensureDesignOwner();
    installStyles();
    if (!installEnterpriseUpgrade()) root.setTimeout(boot, 120);
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
