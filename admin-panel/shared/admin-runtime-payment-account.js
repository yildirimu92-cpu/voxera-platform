(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const state = { accounts: [], loaded: false, saving: false };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const maskIban = (raw) => {
    const value = String(raw || '').replace(/\s+/g, '').toUpperCase();
    if (!value) return '–';
    return `${value.slice(0, 4)} •••• •••• •••• ${value.slice(-4)}`;
  };

  function api(method, payload) {
    if (typeof w.callAdminFunction !== 'function') throw new Error('Admin API ist nicht verfügbar.');
    if (method === 'GET') return w.callAdminFunction('admin-payment-account', { action:'list' });
    return w.callAdminFunction('admin-payment-account', payload);
  }

  function shell() {
    return document.getElementById('vx-payment-account-settings');
  }

  function ensureShell() {
    const settings = document.getElementById('section-settings');
    if (!settings || shell()) return shell();
    const card = document.createElement('section');
    card.id = 'vx-payment-account-settings';
    card.className = 'card';
    card.style.marginTop = '16px';
    card.innerHTML = `
      <div class="vx-unified-head">
        <div>
          <h3>Zahlungskonto & QR-Rechnung</h3>
          <p>Empfangskonto von Voxera für Schweizer Rechnungen.</p>
        </div>
        <button class="btn btn-secondary" type="button" id="vx-payment-account-refresh">Neu laden</button>
      </div>
      <div style="padding:16px" id="vx-payment-account-content">
        <div class="vx-empty-state">Zahlungskonto wird geladen …</div>
      </div>`;
    settings.appendChild(card);
    card.querySelector('#vx-payment-account-refresh')?.addEventListener('click', load);
    return card;
  }

  function render() {
    const root = ensureShell();
    if (!root) return;
    const content = root.querySelector('#vx-payment-account-content');
    const account = state.accounts.find((a) => a.is_default && a.is_active) || state.accounts[0] || null;
    if (!account) {
      content.innerHTML = `
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.72fr);gap:18px;align-items:stretch" class="vx-payment-setup-grid">
          <div class="vx-empty-state" style="min-height:250px;align-items:flex-start;text-align:left;padding:28px">
            <span class="badge badge-amber">Einrichtung erforderlich</span>
            <strong style="font-size:18px;color:var(--vx-admin-ink)">Swiss QR-Rechnungen sind noch nicht eingerichtet</strong>
            <span>Hinterlege einmalig das Voxera-Empfangskonto. Danach können Rechnungen mit korrekten Zahlungsinformationen erstellt werden.</span>
            <button class="btn btn-primary" type="button" id="vx-payment-account-create">Zahlungskonto einrichten</button>
          </div>
          <div class="card" style="margin:0;padding:20px;box-shadow:none">
            <strong style="display:block;margin-bottom:14px">Einrichtungsfortschritt</strong>
            <div style="display:grid;gap:12px;font-size:13px">
              <div>① Unternehmensdaten</div>
              <div>② Bankverbindung</div>
              <div>③ Rechnungsstandard</div>
              <div>④ Aktivieren</div>
            </div>
            <p class="muted" style="margin-top:18px;font-size:12px">Stripe bleibt standardmässig deaktiviert. QR-Rechnung und Zahlungsfrist können im Formular festgelegt werden.</p>
          </div>
        </div>`;
      content.querySelector('#vx-payment-account-create')?.addEventListener('click', () => renderForm(null));
      return;
    }

    content.innerHTML = `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:start">
        <div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
            <strong style="font-size:15px">${esc(account.account_name || 'Voxera CHF')}</strong>
            ${account.is_default ? '<span class="badge badge-success">Standardkonto</span>' : ''}
            ${account.is_active ? '<span class="badge">Aktiv</span>' : '<span class="badge badge-danger">Inaktiv</span>'}
          </div>
          <div class="grid-2" style="gap:10px 18px">
            <div><small class="muted">Kontoinhaber</small><div>${esc(account.creditor_name)}</div></div>
            <div><small class="muted">IBAN</small><div style="font-family:monospace">${esc(maskIban(account.iban))}</div></div>
            <div><small class="muted">QR-IBAN</small><div style="font-family:monospace">${esc(maskIban(account.qr_iban))}</div></div>
            <div><small class="muted">Referenzart</small><div>${esc(account.reference_type)}</div></div>
            <div><small class="muted">Währung</small><div>${esc(account.currency)}</div></div>
            <div><small class="muted">Zahlungsfrist</small><div>${Number(account.payment_terms_days || 0)} Tage</div></div>
            <div><small class="muted">QR-Rechnung</small><div>${account.qr_enabled ? 'Aktiviert' : 'Deaktiviert'}</div></div>
            <div><small class="muted">Stripe-Link</small><div>${account.stripe_link_enabled ? 'Aktiviert' : 'Deaktiviert'}</div></div>
          </div>
        </div>
        <button class="btn btn-primary" type="button" id="vx-payment-account-edit">Bearbeiten</button>
      </div>`;
    content.querySelector('#vx-payment-account-edit')?.addEventListener('click', () => renderForm(account));
  }

  function field(name, label, value, opts = {}) {
    const type = opts.type || 'text';
    const required = opts.required ? 'required' : '';
    return `<label class="form-group"><span>${esc(label)}${opts.required ? ' *' : ''}</span><input ${required} type="${type}" name="${name}" value="${esc(value || '')}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}></label>`;
  }

  function renderForm(account) {
    const root = ensureShell();
    const content = root.querySelector('#vx-payment-account-content');
    const a = account || { currency:'CHF', reference_type:'NON', payment_terms_days:30, creditor_country:'CH', qr_enabled:true, stripe_link_enabled:false, is_default:true, is_active:true };
    content.innerHTML = `
      <form id="vx-payment-account-form">
        <input type="hidden" name="id" value="${esc(a.id || '')}">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px"><span class="badge">1 Unternehmensdaten</span><span class="badge">2 Bankkonto</span><span class="badge">3 Rechnungen</span></div>
        <div class="grid-2" style="gap:12px 16px">
          ${field('account_name','Kontobezeichnung',a.account_name || 'Voxera CHF',{required:true})}
          ${field('creditor_name','Kontoinhaber / Firma',a.creditor_name,{required:true})}
          ${field('creditor_street','Strasse',a.creditor_street,{required:true})}
          ${field('creditor_house_number','Hausnummer',a.creditor_house_number)}
          ${field('creditor_postal_code','PLZ',a.creditor_postal_code,{required:true})}
          ${field('creditor_city','Ort',a.creditor_city,{required:true})}
          ${field('creditor_country','Land (ISO)',a.creditor_country || 'CH',{required:true})}
          ${field('bank_name','Bankname',a.bank_name)}
          ${field('iban','IBAN',a.iban,{required:true,placeholder:'CH…'})}
          ${field('qr_iban','QR-IBAN',a.qr_iban,{placeholder:'Optional, für QR-Referenz'})}
          ${field('bic','BIC / SWIFT',a.bic)}
          <label class="form-group"><span>Währung *</span><select name="currency"><option value="CHF" ${a.currency==='CHF'?'selected':''}>CHF</option><option value="EUR" ${a.currency==='EUR'?'selected':''}>EUR</option></select></label>
          <label class="form-group"><span>Referenzart *</span><select name="reference_type"><option value="NON" ${a.reference_type==='NON'?'selected':''}>Ohne strukturierte Referenz</option><option value="SCOR" ${a.reference_type==='SCOR'?'selected':''}>SCOR-Referenz</option><option value="QRR" ${a.reference_type==='QRR'?'selected':''}>QR-Referenz</option></select></label>
          ${field('payment_terms_days','Zahlungsfrist in Tagen',a.payment_terms_days || 30,{type:'number',required:true})}
          ${field('billing_email','E-Mail für Rechnungsfragen',a.billing_email,{type:'email'})}
          ${field('vat_number','MWST-Nummer',a.vat_number)}
          ${field('default_message','Standard-Mitteilung',a.default_message)}
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin:14px 0">
          <label><input type="checkbox" name="qr_enabled" ${a.qr_enabled!==false?'checked':''}> QR-Rechnung aktivieren</label>
          <label><input type="checkbox" name="stripe_link_enabled" ${a.stripe_link_enabled?'checked':''}> Stripe-Link anzeigen</label>
          <label><input type="checkbox" name="is_default" ${a.is_default!==false?'checked':''}> Als Standardkonto verwenden</label>
          <label><input type="checkbox" name="is_active" ${a.is_active!==false?'checked':''}> Konto aktiv</label>
        </div>
        <div id="vx-payment-account-feedback" style="margin-bottom:10px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-secondary" type="button" id="vx-payment-account-cancel">Abbrechen</button>
          <button class="btn btn-primary" type="submit">Zahlungskonto speichern</button>
        </div>
      </form>`;

    content.querySelector('#vx-payment-account-cancel')?.addEventListener('click', render);
    content.querySelector('#vx-payment-account-form')?.addEventListener('submit', save);
  }

  async function save(event) {
    event.preventDefault();
    if (state.saving) return;
    state.saving = true;
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const feedback = form.querySelector('#vx-payment-account-feedback');
    button.disabled = true;
    button.textContent = 'Speichern …';
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.payment_terms_days = Number(payload.payment_terms_days || 30);
    ['qr_enabled','stripe_link_enabled','is_default','is_active'].forEach((key) => { payload[key] = fd.has(key); });
    try {
      const result = await api('POST', payload);
      if (!result?.success) throw new Error(result?.error || 'Speichern fehlgeschlagen.');
      state.accounts = [result.account, ...state.accounts.filter((a) => a.id !== result.account.id)];
      feedback.innerHTML = '<span style="color:var(--green)">Zahlungskonto wurde gespeichert.</span>';
      setTimeout(render, 400);
    } catch (error) {
      feedback.innerHTML = `<span style="color:var(--red)">${esc(error?.payload?.error || error?.message || 'Speichern fehlgeschlagen.')}</span>`;
    } finally {
      state.saving = false;
      button.disabled = false;
      button.textContent = 'Zahlungskonto speichern';
    }
  }

  async function load() {
    ensureShell();
    try {
      const result = await api('GET');
      state.accounts = Array.isArray(result?.accounts) ? result.accounts : [];
      state.loaded = true;
      render();
    } catch (error) {
      const content = shell()?.querySelector('#vx-payment-account-content');
      if (content) content.innerHTML = `<div class="vx-empty-state"><strong>Zahlungskonto konnte nicht geladen werden</strong><span>${esc(error?.payload?.error || error?.message || '')}</span><button class="btn btn-secondary" type="button" id="vx-payment-account-retry">Erneut versuchen</button></div>`;
      content?.querySelector('#vx-payment-account-retry')?.addEventListener('click', load);
    }
  }

  function install() {
    const style = document.createElement('style');
    style.textContent = '@media(max-width:768px){.vx-payment-setup-grid{grid-template-columns:1fr!important}}';
    document.head.appendChild(style);
    const observer = new MutationObserver(() => {
      if (document.getElementById('section-settings') && !shell()) {
        ensureShell();
        load();
      }
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
    if (document.getElementById('section-settings')) load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);
