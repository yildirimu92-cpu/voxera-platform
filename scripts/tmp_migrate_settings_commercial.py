from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / 'customer-dashboard/index.html'
CSS_PATH = ROOT / 'customer-dashboard/shared/customer-settings-components.css'


def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start + len(start_marker))
    if start < 0 or end < 0:
        raise RuntimeError(f'missing marker range: {label}')
    return text[:start] + replacement.rstrip() + '\n\n        ' + text[end:]


def remove_function(text, name):
    match = re.search(r'(?:async\s+)?function\s+' + re.escape(name) + r'\s*\(', text)
    if not match:
        return text, False
    brace = text.find('{', match.end())
    if brace < 0:
        raise RuntimeError(f'missing function brace: {name}')
    depth = 0
    quote = None
    escape = False
    i = brace
    while i < len(text):
        ch = text[i]
        if quote:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == quote:
                quote = None
        else:
            if ch in ('\'', '"', '`'):
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    while end < len(text) and text[end] in ' \t':
                        end += 1
                    if end < len(text) and text[end] == '\n':
                        end += 1
                    return text[:match.start()] + text[end:], True
        i += 1
    raise RuntimeError(f'unclosed function: {name}')


def replace_function(text, name, replacement):
    text, removed = remove_function(text, name)
    if not removed:
        raise RuntimeError(f'function not found: {name}')
    anchor = 'function requestSupport() {'
    pos = text.find(anchor)
    if pos < 0:
        raise RuntimeError('requestSupport anchor missing')
    return text[:pos] + replacement.rstrip() + '\n\n' + text[pos:]


index = INDEX_PATH.read_text(encoding='utf-8')

profile_markup = r'''<!-- PROFIL -->
          <div id="mehr-sub-profil" class="vx-settings-subpage" hidden>
            <div class="vx-page-header vx-settings-subpage-header">
              <button type="button" onclick="vxMehrBack()" class="vx-back-btn vx-settings-back" aria-label="Zurück zu Einstellungen"><i class="ph-bold ph-arrow-left" aria-hidden="true"></i></button>
              <div class="vx-settings-header-copy"><div class="vx-page-header-title">Profil</div><div class="vx-page-header-subtitle">Persönliche Daten und Zugang verwalten.</div></div>
            </div>

            <section class="vx-settings-card">
              <div class="vx-settings-identity">
                <div id="profil-avatar-preview" class="vx-settings-avatar">U</div>
                <div><div id="profil-name-display" class="vx-settings-identity-name">–</div><div id="profil-email-display" class="vx-settings-card-meta">–</div></div>
              </div>
              <div class="vx-settings-card-body vx-settings-form">
                <label class="vx-settings-field"><span class="vx-settings-field-label">Name</span><input id="profil-name-input" type="text" autocomplete="name" placeholder="Ihr Name"></label>
                <label class="vx-settings-field"><span class="vx-settings-field-label">E-Mail</span><input id="profil-email-input" type="email" autocomplete="email" placeholder="ihre@email.ch"></label>
                <label class="vx-settings-field"><span class="vx-settings-field-label">Portalsprache</span><select id="profil-lang-select" disabled><option value="de">Deutsch</option><option value="fr">Français</option><option value="it">Italiano</option><option value="en">English</option></select><span class="vx-settings-field-help">Weitere Portalsprachen werden schrittweise freigeschaltet.</span></label>
              </div>
            </section>
            <div class="vx-settings-actions"><button type="button" onclick="vxSaveProfil()" class="btn vx-abo-btn">Profil speichern</button></div>
            <div id="fb-profil-page" class="vx-settings-feedback" role="status" aria-live="polite"></div>

            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Passwort ändern</h2><p class="vx-settings-card-meta">Verwenden Sie mindestens acht Zeichen.</p></div></div>
              <div class="vx-settings-card-body vx-settings-form">
                <label class="vx-settings-field"><span class="vx-settings-field-label">Neues Passwort</span><input id="profil-pw-new" type="password" autocomplete="new-password" placeholder="Mindestens 8 Zeichen"></label>
                <label class="vx-settings-field"><span class="vx-settings-field-label">Passwort bestätigen</span><input id="profil-pw-confirm" type="password" autocomplete="new-password" placeholder="Passwort wiederholen"></label>
              </div>
            </section>
            <div class="vx-settings-actions"><button type="button" onclick="vxSavePassword()" class="btn vx-abo-btn secondary">Passwort speichern</button></div>
            <div id="fb-password" class="vx-settings-feedback" role="status" aria-live="polite"></div>
          </div>'''

notification_markup = r'''<!-- BENACHRICHTIGUNGEN -->
          <div id="mehr-sub-benachrichtigungen" class="vx-settings-subpage" hidden>
            <div class="vx-page-header vx-settings-subpage-header">
              <button type="button" onclick="vxMehrBack()" class="vx-back-btn vx-settings-back" aria-label="Zurück zu Einstellungen"><i class="ph-bold ph-arrow-left" aria-hidden="true"></i></button>
              <div class="vx-settings-header-copy"><div class="vx-page-header-title">Benachrichtigungen</div><div class="vx-page-header-subtitle">Legen Sie fest, welche Hinweise Sie erhalten.</div></div>
            </div>

            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">E-Mail</h2><p class="vx-settings-card-meta">Wählen Sie, wann Voxera Sie per E-Mail informiert.</p></div></div>
              <div id="notif-email-options" class="vx-settings-choice-list">
                <label class="vx-settings-choice"><span class="vx-settings-choice-copy"><strong>Keine E-Mails</strong><small>Anfragen bleiben im Dashboard sichtbar.</small></span><input type="radio" name="notif-email" value="none"></label>
                <label class="vx-settings-choice"><span class="vx-settings-choice-copy"><strong>Nur bei Rückruf-Anfragen</strong><small>Für Anfragen, die eine Rückmeldung benötigen.</small></span><input type="radio" name="notif-email" value="callback_only"></label>
                <label class="vx-settings-choice"><span class="vx-settings-choice-copy"><strong>Bei jedem Anruf</strong><small>Eine E-Mail nach jedem abgeschlossenen Gespräch.</small></span><input type="radio" name="notif-email" value="all_calls"></label>
              </div>
              <div class="vx-settings-card-body vx-settings-form">
                <label class="vx-settings-field"><span class="vx-settings-field-label">Empfänger</span><input id="notif-email-address" type="email" readonly><span class="vx-settings-field-help">Die Adresse wird aus Ihrem Profil übernommen.</span></label>
              </div>
            </section>

            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Im Dashboard</h2><p class="vx-settings-card-meta">Steuern Sie die Hinweise in der Glocke.</p></div></div>
              <div class="vx-settings-switch-list">
                <label class="vx-settings-switch-row"><span><strong>Wichtige Anfragen</strong><small>Hot Leads und dringende Anliegen.</small></span><input id="inapp-setting-important-requests" type="checkbox"></label>
                <label class="vx-settings-switch-row"><span><strong>Rückrufe und Aufgaben</strong><small>Geplante Rückmeldungen und offene Aufgaben.</small></span><input id="inapp-setting-callbacks-and-tasks" type="checkbox"></label>
                <label class="vx-settings-switch-row is-locked"><span><strong>Systemhinweise</strong><small>Wichtige Meldungen zur Erreichbarkeit und Einrichtung.</small></span><input id="inapp-setting-system" type="checkbox" checked disabled></label>
              </div>
            </section>
            <div class="vx-settings-actions"><button type="button" onclick="vxSaveBenachrichtigungen()" class="btn vx-abo-btn">Benachrichtigungen speichern</button></div>
            <div id="fb-benachrichtigungen" class="vx-settings-feedback" role="status" aria-live="polite"></div>
          </div>'''

index = replace_between(index, '<!-- PROFIL -->', '<!-- BENACHRICHTIGUNGEN -->', profile_markup, 'profile')
index = replace_between(index, '<!-- BENACHRICHTIGUNGEN -->', '<!-- ABONNEMENT -->', notification_markup, 'notifications')

# Replace add-on sales placeholders and loose action buttons with one canonical options card.
addons_pattern = re.compile(
    r'\s*<section class="vx-settings-card">\s*<div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Add-ons</h2>.*?id="abo-addons-list".*?</section>\s*'
    r'<div class="vx-abo-primary-actions".*?</div>',
    re.S,
)
commercial_card = r'''
            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Plan & Optionen</h2><p class="vx-settings-card-meta">Planwechsel und zusätzliches Gesprächsvolumen zentral anfragen.</p></div></div>
              <div class="vx-commercial-entry-list">
                <button type="button" class="vx-commercial-entry" onclick="vxAboUpgrade()"><span class="vx-commercial-entry-icon"><i class="ph-bold ph-trend-up" aria-hidden="true"></i></span><span><strong>Plan wechseln</strong><small>Verfügbare höhere Pläne vergleichen und verbindlich anfragen.</small></span><i class="ph-bold ph-caret-right" aria-hidden="true"></i></button>
                <button type="button" class="vx-commercial-entry" onclick="vxAboMinuten()"><span class="vx-commercial-entry-icon"><i class="ph-bold ph-plus-circle" aria-hidden="true"></i></span><span><strong>Zusatzminuten</strong><small>Ein einmaliges Minutenpaket für Spitzenzeiten anfragen.</small></span><i class="ph-bold ph-caret-right" aria-hidden="true"></i></button>
              </div>
            </section>'''
index, count = addons_pattern.subn(commercial_card, index, count=1)
if count != 1:
    raise RuntimeError(f'commercial card replacement count={count}')

help_markup = r'''<!-- HILFE TAB -->
        <div class="tab-page" id="tab-hilfe">
          <div class="vx-page-header vx-settings-subpage-header">
            <button type="button" onclick="showTab('mehr',document.getElementById('nav-mehr'))" class="vx-back-btn vx-settings-back" aria-label="Zurück zu Einstellungen"><i class="ph-bold ph-arrow-left" aria-hidden="true"></i></button>
            <div class="vx-settings-header-copy"><div class="vx-page-header-title">Hilfe & Support</div><div class="vx-page-header-subtitle">Schnelle Antworten und direkter Kontakt.</div></div>
          </div>

          <section class="vx-settings-card">
            <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Direkte Hilfe</h2><p class="vx-settings-card-meta">Wählen Sie den passenden nächsten Schritt.</p></div></div>
            <div class="vx-help-action-grid">
              <button type="button" class="vx-help-action" onclick="requestSupport()"><span><i class="ph-bold ph-envelope-simple" aria-hidden="true"></i></span><strong>E-Mail</strong><small>Support kontaktieren</small></button>
              <button type="button" class="vx-help-action" onclick="window.open('https://voxera.ch','_blank','noopener')"><span><i class="ph-bold ph-globe" aria-hidden="true"></i></span><strong>Website</strong><small>Informationen öffnen</small></button>
              <button type="button" class="vx-help-action" onclick="vxOnboardingRestart()"><span><i class="ph-bold ph-play-circle" aria-hidden="true"></i></span><strong>Einrichtung</strong><small>Assistent erneut starten</small></button>
            </div>
          </section>

          <section class="vx-settings-card">
            <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Erste Schritte</h2><p class="vx-settings-card-meta">Die wichtigsten Punkte für einen zuverlässigen Betrieb.</p></div></div>
            <ol class="vx-help-step-list">
              <li class="vx-help-step"><span>1</span><div><strong>Rufumleitung einrichten</strong><small>Ihre Geschäftsnummer wird sicher mit Voxera verbunden.</small></div></li>
              <li class="vx-help-step"><span>2</span><div><strong>Assistent konfigurieren</strong><small>Name, Stimme und Geschäftswissen im Bereich Assistent prüfen.</small></div></li>
              <li class="vx-help-step"><span>3</span><div><strong>Testanruf durchführen</strong><small>Die Geschäftsnummer anrufen und den Eintrag unter Anfragen kontrollieren.</small></div></li>
            </ol>
          </section>

          <section class="vx-settings-card">
            <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Häufige Fragen</h2></div></div>
            <div class="vx-help-faq">
              <details><summary>Wie schnell sind Änderungen aktiv?</summary><p>Gespeicherte Assistenten-Einstellungen werden normalerweise innerhalb weniger Sekunden synchronisiert.</p></details>
              <details><summary>Welche Sprachen erkennt Lara?</summary><p>Deutsch, Französisch, Italienisch und Englisch werden automatisch erkannt.</p></details>
              <details><summary>Was mache ich bei Ferien oder Schliesszeiten?</summary><p>Temporäre Änderungen können im Assistenten unter „Aktuelle Infos“ erfasst werden.</p></details>
              <details><summary>Wo finde ich gebuchte Termine?</summary><p>Durch Voxera erstellte Termine erscheinen unter Anfragen im Status „Geplant“.</p></details>
            </div>
          </section>
        </div>'''
index = replace_between(index, '<!-- HILFE TAB -->', '<!-- ── BENACHRICHTIGUNGEN — Mobile Vollseite ── -->', help_markup, 'help')

commercial_modal = r'''<!-- COMMERCIAL REQUEST MODAL -->
    <div class="overlay overlay--sheet vx-commercial-overlay" id="vx-commercial-overlay" aria-hidden="true">
      <div class="modal modal--wide vx-commercial-modal" role="dialog" aria-modal="true" aria-labelledby="vx-commercial-title">
        <div class="modal-shell">
          <div class="modal-head">
            <div><div id="vx-commercial-title" class="modal-title">Plan & Optionen</div><div id="vx-commercial-subtitle" class="modal-sub">Auswahl prüfen und verbindlich übermitteln.</div></div>
            <button type="button" class="modal-close" onclick="vxCommercialClose()" aria-label="Schliessen"><i class="ph-bold ph-x" aria-hidden="true"></i></button>
          </div>
          <div id="vx-commercial-body" class="vx-commercial-body"></div>
          <div class="modal-actions vx-commercial-actions">
            <button type="button" class="modal-btn modal-btn-s" onclick="vxCommercialClose()">Abbrechen</button>
            <button type="button" class="modal-btn modal-btn-p" id="vx-commercial-submit" onclick="vxCommercialSubmit()" disabled>Anfrage übermitteln</button>
          </div>
        </div>
      </div>
    </div>'''
index = replace_between(index, '<!-- PLAN UPGRADE MODAL -->', '<!-- ONBOARDING MODAL -->', commercial_modal, 'first commercial modals')
index = replace_between(index, '<!-- UPGRADE MODAL -->', '<!-- TOAST -->', '<!-- COMMERCIAL LEGACY MODALS REMOVED -->', 'legacy commercial modals')

# Remove unavailable add-on render owner.
index = index.replace('  // Add-ons laden\n  vxRenderAboAddons();\n', '')
index, removed = remove_function(index, 'vxRenderAboAddons')
if not removed:
    raise RuntimeError('vxRenderAboAddons not found')

# Replace notifications init/save while preserving email and in-app functionality.
new_notification_functions = r'''function vxInitBenachrichtigungen() {
  const mode = customerMeta.notificationMode || 'none';
  document.querySelectorAll('input[name="notif-email"]').forEach(function(radio) {
    radio.checked = radio.value === mode;
  });
  const emailAddr = document.getElementById('notif-email-address');
  if (emailAddr) emailAddr.value = customerMeta.customerEmail || '';

  const inAppSettings = vxNormalizeInAppNotificationSettings(customerMeta.inAppNotificationSettings || VX_IN_APP_NOTIFICATION_SETTINGS_DEFAULTS);
  customerMeta.inAppNotificationSettings = inAppSettings;
  const importantToggle = document.getElementById('inapp-setting-important-requests');
  const callbacksToggle = document.getElementById('inapp-setting-callbacks-and-tasks');
  const systemToggle = document.getElementById('inapp-setting-system');
  if (importantToggle) importantToggle.checked = inAppSettings.important_requests === true;
  if (callbacksToggle) callbacksToggle.checked = inAppSettings.callbacks_and_tasks === true;
  if (systemToggle) systemToggle.checked = true;
}

async function vxSaveBenachrichtigungen() {
  const feedback = document.getElementById('fb-benachrichtigungen');
  if (feedback) { feedback.textContent = 'Wird gespeichert …'; feedback.dataset.state = 'loading'; }
  try {
    const client = getSupabaseAuthClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error('Sitzung abgelaufen. Bitte melden Sie sich erneut an.');

    const selected = document.querySelector('input[name="notif-email"]:checked');
    const mode = selected ? selected.value : 'none';
    const settingsResponse = await fetch('/.netlify/functions/customer-update-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ notification_mode: mode })
    });
    const settingsJson = await settingsResponse.json().catch(function(){ return {}; });
    if (!settingsResponse.ok) throw new Error(settingsJson.error || 'E-Mail-Benachrichtigungen konnten nicht gespeichert werden.');

    const inAppSettings = vxNormalizeInAppNotificationSettings({
      important_requests: !!document.getElementById('inapp-setting-important-requests')?.checked,
      callbacks_and_tasks: !!document.getElementById('inapp-setting-callbacks-and-tasks')?.checked,
      system: true
    });
    const { error: inAppError } = await client.from('customers').update({ in_app_notification_settings: inAppSettings }).eq('id', customerMeta.customerId);
    if (inAppError) throw new Error(inAppError.message || 'Dashboard-Hinweise konnten nicht gespeichert werden.');

    customerMeta.notificationMode = mode;
    customerMeta.inAppNotificationSettings = inAppSettings;
    vxBellUpdateBadge();
    vxBellRender();
    vxBellPageRender();
    if (feedback) { feedback.textContent = 'Benachrichtigungen gespeichert.'; feedback.dataset.state = 'success'; }
  } catch (error) {
    if (feedback) { feedback.textContent = error.message || 'Speichern fehlgeschlagen.'; feedback.dataset.state = 'error'; }
  }
}'''
index, removed = remove_function(index, 'vxInitBenachrichtigungen')
if not removed:
    raise RuntimeError('vxInitBenachrichtigungen not found')
index, removed = remove_function(index, 'vxSaveBenachrichtigungen')
if not removed:
    raise RuntimeError('vxSaveBenachrichtigungen not found')
anchor = '// ── Benachrichtigungen ────────────────────────────────────────────────────────'
anchor_pos = index.find(anchor)
if anchor_pos < 0:
    raise RuntimeError('notification section anchor missing')
insert_pos = anchor_pos + len(anchor)
index = index[:insert_pos] + '\n' + new_notification_functions + '\n' + index[insert_pos:]

# Remove old commercial implementations and hard-coded checkout links.
index = re.sub(
    r'// ── Stripe Links aus plan_config ─+\s*var VX_PLAN_LINKS = \{.*?var _vxSelectedMinutes = null;\s*',
    '',
    index,
    count=1,
    flags=re.S,
)
index = re.sub(r'var selectedUpgradePlan = [^;]*;\s*var selectedMinutesPkg = [^;]*;\s*', '', index, count=1)
for function_name in [
    'vxAboUpgrade', 'vxCloseUpgradeModal', 'vxSetBilling', 'vxSelectUpgradePlan', 'vxConfirmUpgrade',
    'vxAboMinuten', 'vxCloseMinutesModal', 'vxSelectMinutesPkg', 'vxConfirmMinutes',
    'requestUpgrade', 'sendUpgradeRequest', 'requestExtraMinutes', 'sendMinutesRequest'
]:
    index, _ = remove_function(index, function_name)

commercial_functions = r'''var vxCommercialState = { type: '', selected: '', options: [], estimatedAmount: null, submitting: false };

function vxCommercialPlanLabel(value) {
  const labels = { starter: 'Starter', business: 'Business', professional: 'Professional' };
  return labels[String(value || '').toLowerCase()] || String(value || '–');
}

function vxCommercialOpen() {
  const overlay = document.getElementById('vx-commercial-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  syncOverlayScrollLock();
}

function vxCommercialClose() {
  const overlay = document.getElementById('vx-commercial-overlay');
  if (overlay) { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); }
  vxCommercialState = { type: '', selected: '', options: [], estimatedAmount: null, submitting: false };
  syncOverlayScrollLock();
}

function vxCommercialRender() {
  const body = document.getElementById('vx-commercial-body');
  const title = document.getElementById('vx-commercial-title');
  const subtitle = document.getElementById('vx-commercial-subtitle');
  const submit = document.getElementById('vx-commercial-submit');
  if (!body || !title || !subtitle || !submit) return;

  const isPlan = vxCommercialState.type === 'plan_upgrade';
  title.textContent = isPlan ? 'Plan wechseln' : 'Zusatzminuten';
  subtitle.textContent = isPlan
    ? 'Wählen Sie den gewünschten höheren Plan.'
    : 'Wählen Sie ein einmaliges Minutenpaket.';

  body.innerHTML = '<div class="vx-commercial-choice-grid">' + vxCommercialState.options.map(function(option) {
    const selected = String(vxCommercialState.selected) === String(option.value);
    return '<button type="button" class="vx-commercial-choice' + (selected ? ' is-selected' : '') + '" onclick="vxCommercialSelect(\'' + option.value + '\')">'
      + '<span><strong>' + option.title + '</strong><small>' + option.meta + '</small></span>'
      + '<span class="vx-commercial-radio" aria-hidden="true"></span>'
      + '</button>';
  }).join('') + '</div>'
    + '<div class="vx-commercial-summary">'
    + '<strong>So funktioniert es</strong>'
    + '<p>Nach Ihrer Bestätigung wird eine verbindliche Änderungsanfrage mit Referenznummer erstellt. Voxera prüft Vertrags- und Abrechnungsdaten und bestätigt die Umsetzung separat. Es wird kein zweites Abonnement angelegt.</p>'
    + '</div>'
    + '<div id="vx-commercial-status" class="vx-commercial-status" role="status" aria-live="polite"></div>';
  submit.disabled = !vxCommercialState.selected || vxCommercialState.submitting;
  submit.textContent = vxCommercialState.submitting ? 'Wird übermittelt …' : 'Anfrage verbindlich übermitteln';
}

function vxCommercialSelect(value) {
  vxCommercialState.selected = String(value || '');
  const option = vxCommercialState.options.find(function(item){ return String(item.value) === vxCommercialState.selected; });
  vxCommercialState.estimatedAmount = option && Number.isFinite(Number(option.estimatedAmount)) ? Number(option.estimatedAmount) : null;
  vxCommercialRender();
}

function vxAboUpgrade() {
  const state = typeof getUpgradeModalState === 'function' ? getUpgradeModalState() : { upgrades: [] };
  const options = (state.upgrades || []).map(function(plan) {
    const price = Number(plan.monthlyPrice || 0);
    const minutes = Number(plan.minutes || 0);
    return {
      value: String(plan.key || '').toLowerCase(),
      title: plan.label || vxCommercialPlanLabel(plan.key),
      meta: (price > 0 ? ('CHF ' + price + ' / Mt') : 'Preis wird geprüft') + (minutes > 0 ? (' · ' + minutes + ' Min. inklusive') : '')
    };
  });
  if (!options.length) { toast('Für Ihren aktuellen Plan ist kein höherer Plan verfügbar.'); return; }
  vxCommercialState = { type: 'plan_upgrade', selected: '', options, estimatedAmount: null, submitting: false };
  vxCommercialRender();
  vxCommercialOpen();
}

function vxAboMinuten() {
  const config = getPlanConfigEntryForPlan(customerMeta.plan) || { extraRate: 0 };
  const rate = Number(config.extraRate || 0);
  const options = [50, 100, 250, 500].map(function(minutes) {
    const estimate = rate > 0 ? Math.round(rate * minutes * 100) / 100 : null;
    return {
      value: String(minutes),
      title: minutes + ' Minuten',
      meta: estimate != null ? ('Voraussichtlich CHF ' + estimate.toFixed(2)) : 'Betrag gemäss Vertrag',
      estimatedAmount: estimate
    };
  });
  vxCommercialState = { type: 'extra_minutes', selected: '', options, estimatedAmount: null, submitting: false };
  vxCommercialRender();
  vxCommercialOpen();
}

async function vxCommercialSubmit() {
  if (!vxCommercialState.type || !vxCommercialState.selected || vxCommercialState.submitting) return;
  const submit = document.getElementById('vx-commercial-submit');
  const status = document.getElementById('vx-commercial-status');
  vxCommercialState.submitting = true;
  if (submit) { submit.disabled = true; submit.textContent = 'Wird übermittelt …'; }
  if (status) { status.textContent = ''; status.dataset.state = 'loading'; }

  try {
    const client = getSupabaseAuthClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error('Sitzung abgelaufen. Bitte melden Sie sich erneut an.');
    const requestId = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : ('commercial-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    const payload = {
      type: vxCommercialState.type,
      request_id: requestId,
      current_plan: String(customerMeta.plan || '').toLowerCase(),
      keep_billing_cycle: true
    };
    if (vxCommercialState.type === 'plan_upgrade') payload.target_plan = vxCommercialState.selected;
    if (vxCommercialState.type === 'extra_minutes') {
      payload.minutes = Number(vxCommercialState.selected);
      payload.estimated_amount = vxCommercialState.estimatedAmount;
    }

    const response = await fetch('/.netlify/functions/customer-commercial-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(function(){ return {}; });
    if (!response.ok) throw new Error(json.error || 'Anfrage konnte nicht übermittelt werden.');

    const reference = json.reference || json.request_id || requestId;
    if (status) {
      status.dataset.state = 'success';
      status.innerHTML = '<strong>Anfrage übermittelt</strong><span>Referenz: ' + reference + '</span><small>Voxera bestätigt die Vertrags- oder Abrechnungsänderung separat.</small>';
    }
    if (submit) { submit.textContent = 'Übermittelt'; submit.disabled = true; }
    toast('Anfrage verbindlich übermittelt.');
  } catch (error) {
    vxCommercialState.submitting = false;
    if (status) { status.dataset.state = 'error'; status.textContent = error.message || 'Übermittlung fehlgeschlagen.'; }
    if (submit) { submit.textContent = 'Erneut versuchen'; submit.disabled = false; }
  }
}

function requestUpgrade() { vxAboUpgrade(); }
function requestExtraMinutes() { vxAboMinuten(); }
function sendUpgradeRequest() { vxCommercialSubmit(); }
function sendMinutesRequest() { vxCommercialSubmit(); }'''
request_support_pos = index.find('function requestSupport() {')
if request_support_pos < 0:
    raise RuntimeError('requestSupport anchor missing')
index = index[:request_support_pos] + commercial_functions + '\n\n' + index[request_support_pos:]

# Add bearer authentication and server error details to cancellation and reactivation requests.
def add_auth_to_fetch(function_name, text):
    match = re.search(r'(?:async\s+)?function\s+' + re.escape(function_name) + r'\s*\(', text)
    if not match:
        raise RuntimeError(f'missing cancellation function: {function_name}')
    next_fn = re.search(r'\n(?:async\s+)?function\s+', text[match.end():])
    end = match.end() + next_fn.start() if next_fn else len(text)
    block = text[match.start():end]
    if 'Authorization' not in block:
        fetch_pos = block.find("const res = await fetch('/.netlify/functions/customer-cancel-contract'")
        if fetch_pos < 0:
            fetch_pos = block.find("const cancelRes = await fetch('/.netlify/functions/customer-cancel-contract'")
        if fetch_pos < 0:
            raise RuntimeError(f'cancel fetch missing: {function_name}')
        block = block[:fetch_pos] + "const _sb = getSupabaseAuthClient();\n      const { data: { session } } = await _sb.auth.getSession();\n      if (!session?.access_token) throw new Error('Sitzung abgelaufen. Bitte melden Sie sich erneut an.');\n      " + block[fetch_pos:]
        block = block.replace("headers: { 'Content-Type': 'application/json' },", "headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },")
    block = block.replace("if (!res.ok) throw new Error('Kündigung konnte nicht zurückgezogen werden.');", "const responseJson = await res.json().catch(function(){ return {}; });\n      if (!res.ok) throw new Error(responseJson.error || 'Kündigung konnte nicht zurückgezogen werden.');")
    block = block.replace("if (!cancelRes.ok) throw new Error('Kündigung konnte nicht eingereicht werden.');", "const cancelJson = await cancelRes.json().catch(function(){ return {}; });\n      if (!cancelRes.ok) throw new Error(cancelJson.error || 'Kündigung konnte nicht eingereicht werden.');")
    return text[:match.start()] + block + text[end:]

index = add_auth_to_fetch('vxSubmitCancellationRequest', index)
index = add_auth_to_fetch('vxSubmitReactivationRequest', index)

# Remove unused SMS UI helper functions when no visible SMS controls remain.
for function_name in ['vxSetToggle2', 'vxToggleNotifSms', 'vxRequestAddon']:
    remaining_without_definition = index
    definition_match = re.search(r'(?:async\s+)?function\s+' + re.escape(function_name) + r'\s*\(', remaining_without_definition)
    if definition_match:
        # Delete only when there are no calls outside the definition itself.
        call_count = len(re.findall(r'\b' + re.escape(function_name) + r'\s*\(', remaining_without_definition))
        if call_count == 1:
            index, _ = remove_function(index, function_name)

INDEX_PATH.write_text(index, encoding='utf-8')

css = CSS_PATH.read_text(encoding='utf-8')
css_additions = r'''

/* Consolidated customer settings forms and commercial flows. */
body.vx-customer-design-foundation .vx-settings-identity{display:flex;align-items:center;gap:14px;padding:18px 20px;border-bottom:1px solid var(--vx-line);background:var(--vx-brand-dark);color:#fff;}
body.vx-customer-design-foundation .vx-settings-avatar{display:grid;place-items:center;width:48px;height:48px;border-radius:15px;background:var(--vx-brand);color:#fff;font-size:18px;font-weight:800;}
body.vx-customer-design-foundation .vx-settings-identity-name{font-size:17px;font-weight:750;}
body.vx-customer-design-foundation .vx-settings-identity .vx-settings-card-meta{color:rgba(255,255,255,.58);}
body.vx-customer-design-foundation .vx-settings-form{display:grid;gap:16px;}
body.vx-customer-design-foundation .vx-settings-field{display:grid;gap:7px;}
body.vx-customer-design-foundation .vx-settings-field-label{color:var(--vx-muted);font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;}
body.vx-customer-design-foundation .vx-settings-field-help{color:var(--vx-subtle);font-size:12px;line-height:1.45;}
body.vx-customer-design-foundation .vx-settings-field :where(input,select,textarea){width:100%;}
body.vx-customer-design-foundation .vx-settings-actions{display:flex;gap:10px;margin:12px 0;}
body.vx-customer-design-foundation .vx-settings-actions .btn{flex:1;}
body.vx-customer-design-foundation .vx-settings-feedback{min-height:22px;margin:0 2px 14px;color:var(--vx-muted);font-size:13px;text-align:center;}
body.vx-customer-design-foundation .vx-settings-feedback[data-state="success"]{color:#247c5b;}
body.vx-customer-design-foundation .vx-settings-feedback[data-state="error"]{color:#b42318;}
body.vx-customer-design-foundation .vx-settings-choice-list{display:grid;}
body.vx-customer-design-foundation .vx-settings-choice{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--vx-line);cursor:pointer;}
body.vx-customer-design-foundation .vx-settings-choice:last-child{border-bottom:0;}
body.vx-customer-design-foundation .vx-settings-choice-copy{display:grid;gap:3px;}
body.vx-customer-design-foundation .vx-settings-choice-copy strong{color:var(--vx-ink);font-size:15px;}
body.vx-customer-design-foundation .vx-settings-choice-copy small{color:var(--vx-muted);font-size:13px;line-height:1.4;}
body.vx-customer-design-foundation .vx-settings-choice input[type="radio"]{width:22px;height:22px;min-height:0;accent-color:var(--vx-brand);}
body.vx-customer-design-foundation .vx-settings-switch-list{display:grid;}
body.vx-customer-design-foundation .vx-settings-switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--vx-line);}
body.vx-customer-design-foundation .vx-settings-switch-row:last-child{border-bottom:0;}
body.vx-customer-design-foundation .vx-settings-switch-row>span{display:grid;gap:3px;}
body.vx-customer-design-foundation .vx-settings-switch-row strong{font-size:15px;}
body.vx-customer-design-foundation .vx-settings-switch-row small{color:var(--vx-muted);font-size:13px;}
body.vx-customer-design-foundation .vx-settings-switch-row input{width:22px;height:22px;min-height:0;accent-color:var(--vx-brand);}
body.vx-customer-design-foundation .vx-settings-switch-row.is-locked{opacity:.62;}
body.vx-customer-design-foundation .vx-commercial-entry-list{display:grid;}
body.vx-customer-design-foundation .vx-commercial-entry{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:14px;width:100%;padding:18px 20px;border:0;border-bottom:1px solid var(--vx-line);background:#fff;color:var(--vx-ink);text-align:left;cursor:pointer;}
body.vx-customer-design-foundation .vx-commercial-entry:last-child{border-bottom:0;}
body.vx-customer-design-foundation .vx-commercial-entry>span:nth-child(2){display:grid;gap:4px;}
body.vx-customer-design-foundation .vx-commercial-entry strong{font-size:16px;}
body.vx-customer-design-foundation .vx-commercial-entry small{color:var(--vx-muted);font-size:13px;line-height:1.45;}
body.vx-customer-design-foundation .vx-commercial-entry-icon{display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:#eef4ff;color:var(--vx-brand);font-size:21px;}
body.vx-customer-design-foundation .vx-commercial-overlay .modal{max-width:620px;}
body.vx-customer-design-foundation .vx-commercial-body{display:grid;gap:16px;padding:18px 20px;}
body.vx-customer-design-foundation .vx-commercial-choice-grid{display:grid;gap:10px;}
body.vx-customer-design-foundation .vx-commercial-choice{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding:16px;border:1px solid var(--vx-line);border-radius:14px;background:#fff;color:var(--vx-ink);text-align:left;cursor:pointer;}
body.vx-customer-design-foundation .vx-commercial-choice>span:first-child{display:grid;gap:4px;}
body.vx-customer-design-foundation .vx-commercial-choice strong{font-size:16px;}
body.vx-customer-design-foundation .vx-commercial-choice small{color:var(--vx-muted);font-size:13px;}
body.vx-customer-design-foundation .vx-commercial-choice.is-selected{border-color:var(--vx-brand);background:#f3f7ff;box-shadow:0 0 0 2px rgba(52,120,237,.1);}
body.vx-customer-design-foundation .vx-commercial-radio{width:20px;height:20px;border:2px solid #c5cfdd;border-radius:50%;}
body.vx-customer-design-foundation .vx-commercial-choice.is-selected .vx-commercial-radio{border:6px solid var(--vx-brand);}
body.vx-customer-design-foundation .vx-commercial-summary{padding:15px 16px;border-radius:14px;background:#f7f9fc;color:var(--vx-muted);}
body.vx-customer-design-foundation .vx-commercial-summary strong{display:block;margin-bottom:4px;color:var(--vx-ink);}
body.vx-customer-design-foundation .vx-commercial-summary p{margin:0;font-size:13px;line-height:1.55;}
body.vx-customer-design-foundation .vx-commercial-status{display:grid;gap:4px;min-height:20px;color:var(--vx-muted);font-size:13px;}
body.vx-customer-design-foundation .vx-commercial-status[data-state="success"]{padding:14px;border-radius:12px;background:#ecfdf3;color:#247c5b;}
body.vx-customer-design-foundation .vx-commercial-status[data-state="error"]{color:#b42318;}
body.vx-customer-design-foundation .vx-commercial-status span,body.vx-customer-design-foundation .vx-commercial-status small{display:block;}
body.vx-customer-design-foundation .vx-help-action-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:20px;}
body.vx-customer-design-foundation .vx-help-action{display:grid;justify-items:center;gap:7px;padding:17px 10px;border:1px solid var(--vx-line);border-radius:15px;background:#fff;color:var(--vx-ink);text-align:center;cursor:pointer;}
body.vx-customer-design-foundation .vx-help-action>span{display:grid;place-items:center;width:44px;height:44px;border-radius:13px;background:#eef4ff;color:var(--vx-brand);font-size:20px;}
body.vx-customer-design-foundation .vx-help-action strong{font-size:14px;}
body.vx-customer-design-foundation .vx-help-action small{color:var(--vx-muted);font-size:12px;}
body.vx-customer-design-foundation .vx-help-step-list{display:grid;gap:16px;margin:0;padding:20px;list-style:none;}
body.vx-customer-design-foundation .vx-help-step{display:grid;grid-template-columns:34px minmax(0,1fr);gap:13px;align-items:start;}
body.vx-customer-design-foundation .vx-help-step>span{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--vx-brand-dark);color:#fff;font-weight:750;}
body.vx-customer-design-foundation .vx-help-step div{display:grid;gap:3px;}
body.vx-customer-design-foundation .vx-help-step small{color:var(--vx-muted);font-size:13px;line-height:1.45;}
body.vx-customer-design-foundation .vx-help-faq{display:grid;}
body.vx-customer-design-foundation .vx-help-faq details{padding:16px 20px;border-bottom:1px solid var(--vx-line);}
body.vx-customer-design-foundation .vx-help-faq details:last-child{border-bottom:0;}
body.vx-customer-design-foundation .vx-help-faq summary{color:var(--vx-ink);font-weight:700;cursor:pointer;}
body.vx-customer-design-foundation .vx-help-faq p{margin:9px 0 0;color:var(--vx-muted);font-size:13px;line-height:1.55;}
@media(max-width:600px){body.vx-customer-design-foundation .vx-help-action-grid{grid-template-columns:1fr;padding:16px;}body.vx-customer-design-foundation .vx-help-action{grid-template-columns:44px minmax(0,1fr);justify-items:start;text-align:left;}body.vx-customer-design-foundation .vx-help-action small{grid-column:2;}body.vx-customer-design-foundation .vx-commercial-entry{grid-template-columns:42px minmax(0,1fr) auto;padding:16px;}body.vx-customer-design-foundation .vx-commercial-entry-icon{width:42px;height:42px;}}
'''
if 'Consolidated customer settings forms and commercial flows.' not in css:
    css = css.rstrip() + css_additions + '\n'
CSS_PATH.write_text(css, encoding='utf-8')

print('settings commercial migration applied')
