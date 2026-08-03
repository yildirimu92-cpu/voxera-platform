from pathlib import Path
import re

INDEX_PATH = Path('customer-dashboard/index.html')
FOUNDATION_PATH = Path('customer-dashboard/shared/customer-design-system.css')
NAV_CSS_PATH = Path('customer-dashboard/shared/customer-navigation-components.css')
NAV_RUNTIME_PATH = Path('customer-dashboard/shared/customer-runtime-unified-navigation.js')
CALENDAR_PATH = Path('customer-dashboard/shared/customer-runtime-calendar-settings.js')

index = INDEX_PATH.read_text(encoding='utf-8')
foundation = FOUNDATION_PATH.read_text(encoding='utf-8')
nav_css = NAV_CSS_PATH.read_text(encoding='utf-8')
nav_runtime = NAV_RUNTIME_PATH.read_text(encoding='utf-8')
calendar = CALENDAR_PATH.read_text(encoding='utf-8')

# Heute: remove the misapplied report/grid classes. Runtime owns visibility;
# the canonical design CSS owns the explicit card separation.
old_dashboard_shell = '<div id="dash-content" class="vx-ap-stack vx-report-stack" style="display:none">'
new_dashboard_shell = '<div id="dash-content" style="display:none">'
if old_dashboard_shell not in index:
    raise AssertionError('dashboard content shell anchor missing')
index = index.replace(old_dashboard_shell, new_dashboard_shell, 1)

# Archiv: the retention explanation remains in the archive empty state only.
retention_pattern = re.compile(
    r'\n\s*<div class="vx-ap-meta vx-archive-retention" role="note">\s*'
    r'Aufbewahrung: vollständige Transkripte werden nach <strong>90 Tagen</strong> entfernt, '
    r'Archiveinträge nach <strong>180 Tagen</strong>\.\s*</div>',
    re.S,
)
index, retention_count = retention_pattern.subn('', index, count=1)
if retention_count != 1:
    raise AssertionError(f'archive header retention note expected once, found {retention_count}')

# Settings: delete competing style.display navigation and use one semantic state owner.
settings_pattern = re.compile(
    r'function vxMehrShow\(sub\) \{.*?\n\}\n\nfunction vxMehrBack\(\) \{.*?\n\}',
    re.S,
)
settings_replacement = '''function vxSetSettingsView(sub) {
  const main = document.getElementById('mehr-main');
  if (!main) return null;

  document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach(function(el) {
    el.hidden = true;
    el.style.removeProperty('display');
  });
  main.style.removeProperty('display');

  if (!sub) {
    main.hidden = false;
    return main;
  }

  const el = document.getElementById('mehr-sub-' + sub);
  if (!el) {
    main.hidden = false;
    return null;
  }

  main.hidden = true;
  el.hidden = false;
  el.style.removeProperty('display');
  return el;
}

function vxMehrShow(sub) {
  const el = vxSetSettingsView(sub);
  if (el) {
    if (sub === 'profil') vxInitProfil();
    if (sub === 'benachrichtigungen') vxInitBenachrichtigungen();
    if (sub === 'abonnement') vxInitAbonnement();
    if (sub === 'rufumleitung') vxInitRufumleitung();
    if (sub === 'darstellung') { /* theme picker removed */ }
    if (typeof refreshLucideIcons === 'function') setTimeout(refreshLucideIcons, 50);
  }
}

function vxMehrBack() {
  vxSetSettingsView('');
}'''
index, settings_count = settings_pattern.subn(settings_replacement, index, count=1)
if settings_count != 1:
    raise AssertionError(f'settings navigation block expected once, found {settings_count}')

# Delete the old animated active pill. The existing navigation component is the sole owner.
legacy_active_pattern = re.compile(
    r'/\* Pill hinter aktivem Icon \*/\s*'
    r'\.mobile-nav-btn\.active \.mobile-nav-icon-wrap::before\{.*?\}\s*'
    r'@keyframes navPillIn\{\s*from\{[^}]*\}\s*to\{[^}]*\}\s*\}\s*'
    r'/\* Icon leicht größer wenn aktiv \*/\s*'
    r'\.mobile-nav-btn\.active svg,\s*\.mobile-nav-btn\.active \.lucide\{.*?\}\s*',
    re.S,
)
index, active_count = legacy_active_pattern.subn('', index, count=1)
if active_count != 1:
    raise AssertionError(f'legacy mobile active pill block expected once, found {active_count}')

# Existing foundation owner: explicit separation survives display changes by runtime.
spacing_rule = 'body.vx-customer-design-foundation #dash-priority-section + #dash-activity-section { margin-top: 16px; }\n\n'
if spacing_rule.strip() not in foundation:
    anchor = '/* Native hidden state wins over component display declarations by specificity. */'
    if anchor not in foundation:
        raise AssertionError('foundation insertion anchor missing')
    foundation = foundation.replace(anchor, spacing_rule + anchor, 1)

# Existing navigation component owner: quiet, consistent five-item mobile navigation.
old_mobile_owner = '''body.vx-customer-design-foundation .mobile-nav-btn.vx-root-nav-active {
  color: #1a6fe8;
}

body.vx-customer-design-foundation .mobile-nav-btn.vx-root-nav-active .mobile-nav-icon-wrap {
  background: #eef4ff;
  color: #1a6fe8;
}
'''
new_mobile_owner = '''body.vx-customer-design-foundation .mobile-nav-inner{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));align-items:center;padding:0 6px;}
body.vx-customer-design-foundation .mobile-nav-btn{gap:5px;min-width:0;min-height:64px;padding:6px 2px 5px;color:rgba(255,255,255,.48);font-family:var(--vx-font-ui);font-size:11px;font-weight:600;}
body.vx-customer-design-foundation .mobile-nav-btn .mobile-nav-icon-wrap{display:inline-flex;align-items:center;justify-content:center;width:34px;height:30px;border:0;border-radius:10px;background:transparent!important;box-shadow:none!important;color:inherit;}
body.vx-customer-design-foundation .mobile-nav-btn :where(i,svg,.lucide){color:currentColor!important;stroke:currentColor!important;}
body.vx-customer-design-foundation .mobile-nav-btn:is(.active,.vx-root-nav-active){color:#72a5ff;font-weight:700;}
body.vx-customer-design-foundation .mobile-nav-btn:is(.active,.vx-root-nav-active) .mobile-nav-icon-wrap{background:rgba(52,120,237,.18)!important;color:#72a5ff;}
body.vx-customer-design-foundation .mobile-nav-btn:is(.active,.vx-root-nav-active) .mobile-nav-icon-wrap::before{display:none!important;content:none!important;animation:none!important;}
body.vx-customer-design-foundation .mobile-nav-btn .vx-root-nav-label{color:inherit;font-size:11px;line-height:1.15;white-space:nowrap;}
'''
if old_mobile_owner not in nav_css:
    raise AssertionError('canonical mobile navigation owner anchor missing')
nav_css = nav_css.replace(old_mobile_owner, new_mobile_owner, 1)

# Unified navigation delegates Settings root restoration to the same canonical helper.
restore_pattern = re.compile(
    r'  function restoreSettingsRoot\(\) \{.*?\n  \}\n\n  function simplifyVoiceSelection',
    re.S,
)
restore_replacement = '''  function restoreSettingsRoot() {
    if (typeof root.vxSetSettingsView === 'function') {
      root.vxSetSettingsView('');
      return;
    }
    const main = document.getElementById('mehr-main');
    if (main) {
      main.hidden = false;
      main.style.removeProperty('display');
    }
    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => {
      node.hidden = true;
      node.style.removeProperty('display');
    });
  }

  function simplifyVoiceSelection'''
nav_runtime, restore_count = restore_pattern.subn(restore_replacement, nav_runtime, count=1)
if restore_count != 1:
    raise AssertionError(f'unified settings restore block expected once, found {restore_count}')

# Calendar: remove the redundant success banner and present notice as human choices.
notice_helper = '''
  const noticeChoices = [
    [0, 'Kein Vorlauf'],
    [60, '1 Stunde'],
    [120, '2 Stunden'],
    [240, '4 Stunden'],
    [480, '8 Stunden'],
    [720, '12 Stunden'],
    [1440, '24 Stunden'],
    [2880, '2 Tage'],
    [4320, '3 Tage'],
    [5760, '4 Tage'],
    [10080, '7 Tage']
  ];

  function noticeOptions(value) {
    const selectedValue = Number(value ?? 120);
    const choices = noticeChoices.slice();
    if (!choices.some(([minutes]) => minutes === selectedValue)) {
      choices.push([selectedValue, selectedValue + ' Minuten']);
      choices.sort((left, right) => left[0] - right[0]);
    }
    return choices.map(([minutes, label]) => '<option value="' + minutes + '"' + (minutes === selectedValue ? ' selected' : '') + '>' + label + '</option>').join('');
  }
'''
if 'function noticeOptions(value)' not in calendar:
    anchor = '\n\n  function inject() {'
    if anchor not in calendar:
        raise AssertionError('calendar helper insertion anchor missing')
    calendar = calendar.replace(anchor, notice_helper + anchor, 1)

old_banner = '''    body.innerHTML =
      '<div class="vx-cal-banner ' + (state.enabled ? 'ok' : '') + '">' +
      (state.enabled ? 'Kalenderintegration ist freigeschaltet. Verbindungen bleiben kundenspezifisch.' : 'Sicher vorbereitet, aber noch nicht produktiv aktiviert. Verbindungen und Buchungen sind gesperrt.') +
      '</div><div id="vx-calendar-status" class="vx-cal-status" role="status" aria-live="polite"></div>' +
'''
new_banner = '''    const availabilityBanner = state.enabled
      ? ''
      : '<div class="vx-cal-banner">Sicher vorbereitet, aber noch nicht produktiv aktiviert. Verbindungen und Buchungen sind gesperrt.</div>';

    body.innerHTML =
      availabilityBanner + '<div id="vx-calendar-status" class="vx-cal-status" role="status" aria-live="polite"></div>' +
'''
if old_banner not in calendar:
    raise AssertionError('calendar availability banner anchor missing')
calendar = calendar.replace(old_banner, new_banner, 1)

old_notice_field = '''      '<div class="vx-cal-field"><label>Mindestvorlauf (Min.)</label><input id="vx-cal-notice" type="number" min="0" max="10080" value="' + esc(settings.minimum_notice_minutes || 120) + '"></div>' +
'''
new_notice_field = '''      '<div class="vx-cal-field"><label>Mindestvorlauf</label><select id="vx-cal-notice">' + noticeOptions(settings.minimum_notice_minutes ?? 120) + '</select></div>' +
'''
if old_notice_field not in calendar:
    raise AssertionError('calendar minimum notice field anchor missing')
calendar = calendar.replace(old_notice_field, new_notice_field, 1)

calendar_state_pattern = re.compile(
    r'  function setCalendarPageOpen\(isOpen\) \{.*?\n  \}\n\n  function open\(\)',
    re.S,
)
calendar_state_replacement = '''  function setCalendarPageOpen(isOpen) {
    const main = document.getElementById('mehr-main');
    const page = document.getElementById('mehr-sub-kalender');
    if (!main || !page) return false;

    if (typeof root.vxSetSettingsView === 'function') {
      root.vxSetSettingsView(isOpen ? 'kalender' : '');
    } else {
      document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => {
        node.hidden = true;
        node.style.removeProperty('display');
      });
      main.style.removeProperty('display');
    }

    if (isOpen) {
      page.removeAttribute('style');
      main.hidden = true;
      page.hidden = false;
    } else {
      page.hidden = true;
      main.hidden = false;
    }
    return true;
  }

  function open()'''
calendar, calendar_state_count = calendar_state_pattern.subn(calendar_state_replacement, calendar, count=1)
if calendar_state_count != 1:
    raise AssertionError(f'calendar page state block expected once, found {calendar_state_count}')

# Product assertions.
assert 'class="vx-ap-stack vx-report-stack"' not in index
assert 'vx-archive-retention' not in index
assert 'Audio und vollständige Transkripte werden nach <strong>90 Tagen</strong>' in index
assert "function vxSetSettingsView(sub)" in index
assert "document.getElementById('mehr-main').style.display" not in index
assert '.mobile-nav-btn.active .mobile-nav-icon-wrap::before' not in index
assert '#dash-priority-section + #dash-activity-section' in foundation
assert '.mobile-nav-btn:is(.active,.vx-root-nav-active)' in nav_css
assert 'root.vxSetSettingsView' in nav_runtime
assert "node.style.display = 'none'" not in nav_runtime
assert 'Kalenderintegration ist freigeschaltet. Verbindungen bleiben kundenspezifisch.' not in calendar
assert '<label>Mindestvorlauf</label><select id="vx-cal-notice">' in calendar
assert "[1440, '24 Stunden']" in calendar and "[5760, '4 Tage']" in calendar
assert '.style.display' not in calendar

INDEX_PATH.write_text(index, encoding='utf-8')
FOUNDATION_PATH.write_text(foundation, encoding='utf-8')
NAV_CSS_PATH.write_text(nav_css, encoding='utf-8')
NAV_RUNTIME_PATH.write_text(nav_runtime, encoding='utf-8')
CALENDAR_PATH.write_text(calendar, encoding='utf-8')

print('Applied mobile acceptance polish and verified structural invariants.')
