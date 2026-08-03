import fs from 'node:fs';

const path = process.argv[2] || 'customer-dashboard/index.html';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('class="vx-settings-list"') && source.includes('class="vx-abo-hero"')) {
  console.log('Settings and subscription markup already migrated.');
  process.exit(0);
}

function replaceBetween(startToken, endToken, replacement, label) {
  const start = source.indexOf(startToken);
  if (start < 0) throw new Error(`${label}: start token not found`);
  const end = source.indexOf(endToken, start);
  if (end < 0) throw new Error(`${label}: end token not found`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

function replaceExact(before, after, label) {
  if (!source.includes(before)) throw new Error(`${label}: exact source not found`);
  source = source.replace(before, after);
}

const settingsMain = `          <div id="mehr-main" class="vx-settings-main">
            <div class="vx-page-header">
              <div class="vx-page-header-title">Einstellungen</div>
            </div>

            <div class="vx-settings-list" aria-label="Einstellungsbereiche">
              <button type="button" class="vx-settings-entry" onclick="showTab('auswertung')">
                <span class="vx-settings-entry-icon"><i class="ph-bold ph-chart-bar" aria-hidden="true"></i></span>
                <span class="vx-settings-entry-copy"><span class="vx-settings-entry-title">Bericht</span><span class="vx-settings-entry-subtitle">Anrufstatistiken &amp; Auswertung</span></span>
                <i class="ph-bold ph-caret-right vx-settings-entry-caret" aria-hidden="true"></i>
              </button>
              <button type="button" class="vx-settings-entry" onclick="vxMehrShow('profil')">
                <span class="vx-settings-entry-icon"><i class="ph-bold ph-user" aria-hidden="true"></i></span>
                <span class="vx-settings-entry-copy"><span class="vx-settings-entry-title">Profil</span><span id="mehr-profil-sub" class="vx-settings-entry-subtitle">Name, E-Mail, Passwort</span></span>
                <i class="ph-bold ph-caret-right vx-settings-entry-caret" aria-hidden="true"></i>
              </button>
              <button type="button" class="vx-settings-entry" onclick="vxMehrShow('benachrichtigungen')">
                <span class="vx-settings-entry-icon"><i class="ph-bold ph-bell" aria-hidden="true"></i></span>
                <span class="vx-settings-entry-copy"><span class="vx-settings-entry-title">Benachrichtigungen</span><span class="vx-settings-entry-subtitle">E-Mail, SMS, Browser</span></span>
                <i class="ph-bold ph-caret-right vx-settings-entry-caret" aria-hidden="true"></i>
              </button>
              <button type="button" class="vx-settings-entry" onclick="vxMehrShow('abonnement')">
                <span class="vx-settings-entry-icon"><i class="ph-bold ph-credit-card" aria-hidden="true"></i></span>
                <span class="vx-settings-entry-copy"><span class="vx-settings-entry-title">Abonnement &amp; Add-ons</span><span id="mehr-plan-label" class="vx-settings-entry-subtitle">Ihr aktueller Plan</span></span>
                <i class="ph-bold ph-caret-right vx-settings-entry-caret" aria-hidden="true"></i>
              </button>
              <button type="button" class="vx-settings-entry" onclick="vxMehrShow('hilfe')">
                <span class="vx-settings-entry-icon"><i class="ph-bold ph-question" aria-hidden="true"></i></span>
                <span class="vx-settings-entry-copy"><span class="vx-settings-entry-title">Hilfe</span><span class="vx-settings-entry-subtitle">FAQ, Support kontaktieren</span></span>
                <i class="ph-bold ph-caret-right vx-settings-entry-caret" aria-hidden="true"></i>
              </button>
            </div>
          </div>

`;

replaceBetween(
  '          <div id="mehr-main" style="margin-bottom:10px;">',
  '          <!-- ── SUB-PAGES ────────────────────────────────── -->',
  settingsMain,
  'settings landing page'
);

const subscription = `          <!-- ABONNEMENT -->
          <div id="mehr-sub-abonnement" class="vx-settings-subpage" style="display:none;">
            <div class="vx-page-header vx-settings-subpage-header">
              <button type="button" onclick="vxMehrBack()" class="vx-back-btn vx-settings-back" aria-label="Zurück zu Einstellungen"><i class="ph-bold ph-arrow-left" aria-hidden="true"></i></button>
              <div class="vx-settings-header-copy"><div class="vx-page-header-title">Abonnement</div><div class="vx-page-header-subtitle">Plan, Nutzung und Vertragsdetails.</div></div>
            </div>

            <section class="vx-abo-hero" aria-labelledby="abo-plan-heading">
              <div id="abo-plan-heading" class="vx-abo-eyebrow">Aktueller Plan</div>
              <div class="vx-abo-plan-row">
                <div id="abo-plan-name" class="vx-abo-plan-name">–</div>
                <div id="abo-plan-price" class="vx-abo-plan-price">–</div>
              </div>
            </section>

            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Vertragsdetails</h2><p class="vx-settings-card-meta">Laufzeit, Betrag und aktueller Vertragsstatus.</p></div></div>
              <div id="abo-contract-details" class="vx-settings-card-body"></div>
            </section>

            <section class="vx-settings-card">
              <div class="vx-settings-card-head vx-settings-card-head--split"><div><h2 class="vx-settings-card-title">Minutenverbrauch</h2><p class="vx-settings-card-meta">Aktuelle Nutzung im laufenden Abrechnungszeitraum.</p></div><span id="abo-minutes-text" class="vx-abo-minutes-text">– / – Min</span></div>
              <div class="vx-settings-card-body">
                <progress id="abo-minutes-bar" class="vx-abo-progress" max="100" value="0" aria-label="Verbrauch des Minutenkontingents"></progress>
                <div id="abo-minutes-warning" class="vx-abo-warning" hidden>Über 80% des Kontingents verbraucht</div>
              </div>
            </section>

            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Add-ons</h2><p class="vx-settings-card-meta">Aktive Erweiterungen und verfügbare Zusatzleistungen.</p></div></div>
              <div id="abo-addons-list" class="vx-settings-card-body"></div>
            </section>

            <div class="vx-abo-primary-actions" aria-label="Abonnement-Aktionen">
              <button type="button" onclick="vxAboUpgrade()" class="btn vx-abo-btn">Plan upgraden</button>
              <button type="button" onclick="vxAboMinuten()" class="btn vx-abo-btn secondary">Zusatzminuten kaufen</button>
            </div>

            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Rechnungen</h2><p class="vx-settings-card-meta">Ihre Abrechnungsdokumente an einem Ort.</p></div></div>
              <div id="abo-invoices-list" class="vx-settings-card-body"><div class="vx-abo-empty">Rechnungen werden hier angezeigt, sobald sie verfügbar sind.</div></div>
            </section>

            <section class="vx-settings-card vx-abo-cancellation-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Vertrag kündigen</h2><p class="vx-settings-card-meta">Eine Kündigung wird unter Einhaltung der Vertragsfrist durch unser Team bearbeitet.</p></div></div>
              <div id="abo-cancellation-action" class="vx-settings-card-body"></div>
            </section>
          </div>


`;

replaceBetween(
  '          <!-- ABONNEMENT -->',
  '          <!-- RUFUMLEITUNG -->',
  subscription,
  'subscription page'
);

replaceExact(
`@media(max-width:480px){
  #abo-addons-list > div[style*="grid-template-columns:1fr 1fr"] {
    grid-template-columns: 1fr !important;
  }
}
.addon-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
@media(max-width:600px){.addon-grid{grid-template-columns:1fr;}}
`,
'',
'legacy subscription addon CSS'
);

replaceExact(
`  /* ── Mehr-Tab Hauptliste ──────────────────────────── */
  #mehr-main [onclick] {
    padding: 12px;
    border-radius: 12px;
  }

`,
'',
'legacy settings mobile CSS'
);

replaceExact(
`    if (textEl) textEl.textContent = used + ' / ' + total + ' Min';
    if (barEl) { barEl.style.width = pct + '%'; barEl.style.background = pct >= 80 ? '#D97706' : '#1A6FE8'; }
    if (warnEl) warnEl.style.display = pct >= 80 ? 'block' : 'none';
`,
`    if (textEl) textEl.textContent = used + ' / ' + total + ' Min';
    if (barEl) {
      barEl.value = pct;
      barEl.classList.toggle('warning', pct >= 80);
      barEl.setAttribute('aria-valuenow', String(pct));
    }
    if (warnEl) warnEl.hidden = pct < 80;
`,
'subscription usage state'
);

const contractFunction = `function vxRenderContractDetails() {
  const el = document.getElementById('abo-contract-details');
  if (!el) return;
  const ct = customerContractMeta || (customerContractState && (customerContractState.effectiveContract || customerContractState.latestContract)) || {};
  const durationRaw = Number(ct.duration_months);
  const durationText = (!durationRaw || durationRaw <= 1) ? 'Monatlich' : (durationRaw + ' Monate');
  const nextRenewal = vxComputeNextRenewal(ct.start_date, ct.duration_months);
  const status = String(ct.status || '').toLowerCase();
  const statusLabel = status === 'cancelled' ? 'Gekündigt' : (status === 'active' ? 'Aktiv' : (ct.status || 'Unbekannt'));
  const statusClass = status === 'cancelled' ? 'is-cancelled' : (status === 'active' ? 'is-active' : 'is-neutral');

  const warningHtml = ct.cancellation_date
    ? '<div class="vx-abo-contract-warning">Kündigung eingereicht per ' + vxFmtDate(ct.cancellation_date) + '</div>'
    : '';

  el.innerHTML =
    '<div class="vx-abo-contract-grid">' +
      '<div class="vx-abo-contract-item"><div class="vx-abo-contract-label">Vertragsbeginn</div><div class="vx-abo-contract-value">' + vxFmtDate(ct.start_date) + '</div></div>' +
      '<div class="vx-abo-contract-item"><div class="vx-abo-contract-label">Vertragsdauer</div><div class="vx-abo-contract-value">' + durationText + '</div></div>' +
      '<div class="vx-abo-contract-item"><div class="vx-abo-contract-label">Monatlicher Betrag</div><div class="vx-abo-contract-value">' + vxFmtChf(ct.recurring_amount_monthly) + '</div></div>' +
      '<div class="vx-abo-contract-item"><div class="vx-abo-contract-label">Nächste Verlängerung</div><div class="vx-abo-contract-value">' + (nextRenewal ? vxFmtDate(nextRenewal) : '–') + '</div></div>' +
      '<div class="vx-abo-contract-item"><div class="vx-abo-contract-label">Kündigungsfrist</div><div class="vx-abo-contract-value">' + (ct.cancellation_notice || '30 Tage') + '</div></div>' +
      '<div class="vx-abo-contract-item"><div class="vx-abo-contract-label">Status</div><span class="vx-abo-status ' + statusClass + '">' + statusLabel + '</span></div>' +
      warningHtml +
    '</div>';
}

`;
replaceBetween('function vxRenderContractDetails() {', 'async function vxRenderAboAddons() {', contractFunction, 'contract detail renderer');

const addonsFunction = `async function vxRenderAboAddons() {
  const listEl = document.getElementById('abo-addons-list');
  if (!listEl) return;

  try {
    const cards = [
      { addon_code: 'sms_notify_kunde', display_name: 'SMS Benachrichtigungen', price: 'CHF 9/Mt', icon: 'message-square', teaser: '' },
      { addon_code: 'sms_confirm_caller', display_name: 'SMS an Anrufer', price: 'CHF 19/Mt', icon: 'message-circle', teaser: '' },
      { addon_code: 'minutes_block', display_name: 'Zusatzminuten (+50 Min)', price: 'CHF 19', icon: 'plus-circle', teaser: 'Ihr Stripe-Link wird hier erscheinen', soonText: 'In Kürze' }
    ];
    const loadedAddons = Array.isArray(customerMeta.customerAddons) ? customerMeta.customerAddons : [];
    const activeSet = new Set(loadedAddons.filter(a => a && a.active).map(a => String(a.addon_code || '').toLowerCase()));

    listEl.innerHTML = '<div class="vx-abo-addon-grid">' + cards.map(function(a) {
      const isActive = activeSet.has(String(a.addon_code).toLowerCase());
      const usageInfo = isActive && a.addon_code === 'minutes_block'
        ? '<div class="vx-abo-addon-usage">Aktive Blöcke: ' + loadedAddons.filter(function(x){return x && x.active && String(x.addon_code||'').toLowerCase()==='minutes_block';}).length + '</div>'
        : '';
      const badge = isActive
        ? '<span class="vx-abo-status is-active">Aktiv</span>'
        : '<span class="vx-abo-status is-neutral">' + (a.soonText || 'Coming Soon') + '</span>';
      return '<article class="vx-abo-addon">'
        + '<div class="vx-abo-addon-head">'
        + '<div class="vx-abo-addon-main">'
        + '<div class="vx-abo-addon-icon"><i class="ph-bold ph-' + a.icon + '" aria-hidden="true"></i></div>'
        + '<div><div class="vx-abo-addon-name">' + a.display_name + '</div><div class="vx-abo-addon-price">' + a.price + '</div>' + usageInfo + '</div>'
        + '</div>' + badge + '</div>'
        + (a.teaser ? '<div class="vx-abo-addon-teaser">' + a.teaser + '</div>' : '')
        + '</article>';
    }).join('') + '</div>';
  } catch(e) {
    listEl.innerHTML = '<div class="vx-abo-empty">Fehler beim Laden.</div>';
  }
}

`;
replaceBetween('async function vxRenderAboAddons() {', 'function vxRenderCancellationSection() {', addonsFunction, 'addon renderer');

const cancellationFunction = `function vxRenderCancellationSection() {
  const el = document.getElementById('abo-cancellation-action');
  if (!el) return;
  const ct = customerContractMeta || (customerContractState && (customerContractState.effectiveContract || customerContractState.latestContract)) || {};
  const isActive = String(ct.status || '').toLowerCase() === 'active';
  if ((ct.cancellation_date || ct.termination_type) && isActive) {
    el.innerHTML = '<div class="vx-abo-cancellation-note">Kündigung bereits eingereicht</div>'
      + '<button type="button" onclick="vxSubmitReactivationRequest()" class="btn vx-abo-btn secondary">Kündigung zurückziehen</button>';
    return;
  }
  if (ct.cancellation_date || ct.termination_type) {
    el.innerHTML = '<div class="vx-abo-cancellation-note">Kündigung bereits eingereicht</div>';
    return;
  }
  el.innerHTML = '<button type="button" onclick="vxSubmitCancellationRequest()" class="btn vx-abo-btn danger">Kündigung einreichen</button>';
}

`;
replaceBetween('function vxRenderCancellationSection() {', 'async function vxSubmitCancellationRequest() {', cancellationFunction, 'cancellation renderer');

for (const forbidden of [
  '#mehr-main [onclick]',
  '.addon-grid{',
  '#abo-addons-list > div[style*=',
  '<div id="mehr-main" style=',
  '<div id="abo-plan-name" style=',
  'statusStyle ='
]) {
  if (source.includes(forbidden)) throw new Error(`legacy token still present: ${forbidden}`);
}

for (const required of [
  'class="vx-settings-list"',
  'class="vx-settings-entry"',
  'class="vx-abo-hero"',
  '<progress id="abo-minutes-bar"',
  'class="vx-abo-contract-grid"',
  'class="vx-abo-addon-grid"',
  "barEl.classList.toggle('warning'"
]) {
  if (!source.includes(required)) throw new Error(`required token missing: ${required}`);
}

fs.writeFileSync(path, source);
console.log('Settings and subscription markup migrated.');
