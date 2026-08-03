from pathlib import Path
import re

INDEX_PATH = Path('customer-dashboard/index.html')
NAV_PATH = Path('customer-dashboard/shared/customer-runtime-unified-navigation.js')
CALENDAR_PATH = Path('customer-dashboard/shared/customer-runtime-calendar-settings.js')
CSS_PATH = Path('customer-dashboard/shared/customer-assistant-components.css')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count == 0 and new in source:
        return source
    if count != 1:
        raise AssertionError(f'{label}: expected one occurrence, found {count}')
    return source.replace(old, new, 1)


def remove_balanced_div(source: str, element_id: str) -> str:
    marker = f'id="{element_id}"'
    marker_index = source.find(marker)
    if marker_index < 0:
        return source
    start = source.rfind('<div', 0, marker_index)
    if start < 0:
        raise AssertionError(f'{element_id}: opening div missing')
    token_pattern = re.compile(r'<div\b|</div\s*>', re.I)
    depth = 0
    end = None
    for match in token_pattern.finditer(source, start):
        if match.group(0).lower().startswith('<div'):
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                end = match.end()
                break
    if end is None:
        raise AssertionError(f'{element_id}: closing div missing')
    line_start = source.rfind('\n', 0, start) + 1
    previous_line_start = source.rfind('\n', 0, max(0, line_start - 1)) + 1
    previous_line = source[previous_line_start:line_start]
    if 'ARCHIV' in previous_line and 'TAB' in previous_line:
        line_start = previous_line_start
    while end < len(source) and source[end] in ' \t':
        end += 1
    if end < len(source) and source[end] == '\n':
        end += 1
    return source[:line_start] + source[end:]


def migrate_index() -> None:
    source = INDEX_PATH.read_text(encoding='utf-8')

    source = replace_once(
        source,
        'id="dash-content" class="vx-ap-stack"',
        'id="dash-content" class="vx-ap-stack vx-report-stack"',
        'dashboard report spacing',
    )

    archive_header = '''              <button type="button" class="vx-ap-filter" id="vx-requests-open-archive" onclick="showTab('archiv',document.getElementById('nav-anrufe'))" aria-label="Archiv öffnen">
                <i class="ph-bold ph-archive" aria-hidden="true"></i>
                <span>Archiv</span>
              </button>
'''
    if archive_header in source:
        source = source.replace(archive_header, '', 1)

    completed_filter = '''                <button class="vx-ap-filter vx-chip" data-filter="abgeschlossen" onclick="anrufeChipFilter('abgeschlossen',this)">Erledigt</button>
'''
    archive_filter = completed_filter + '''                <button class="vx-ap-filter vx-chip" data-filter="archiv" onclick="anrufeChipFilter('archiv',this)">Archiv</button>
'''
    source = replace_once(source, completed_filter, archive_filter, 'archive request filter')

    report_buttons = '''                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="today" aria-selected="false" onclick="auSetPeriod('today',this)">Heute</button>
                  <button type="button" class="vx-ap-filter vx-report-period active" data-report-period="week" aria-selected="true" onclick="auSetPeriod('week',this)">Woche</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="month" aria-selected="false" onclick="auSetPeriod('month',this)">Monat</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="all" aria-selected="false" onclick="auSetPeriod('all',this)">Gesamt</button>
'''
    simplified_report_buttons = '''                  <button type="button" class="vx-ap-filter vx-report-period active" data-report-period="week" aria-selected="true" onclick="auSetPeriod('week',this)">7 Tage</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="month" aria-selected="false" onclick="auSetPeriod('month',this)">30 Tage</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="all" aria-selected="false" onclick="auSetPeriod('all',this)">Gesamt</button>
'''
    source = replace_once(source, report_buttons, simplified_report_buttons, 'report period buttons')

    source = remove_balanced_div(source, 'tab-archiv')

    source, month_filter_count = re.subn(
        r"else if \(_auPeriod === 'month'\) start = new Date\(now\.getFullYear\(\), now\.getMonth\(\), 1\);",
        "else if (_auPeriod === 'month') start = new Date(now.getTime() - 30*86400000);",
        source,
        count=1,
    )
    if month_filter_count == 0 and "else if (_auPeriod === 'month') start = new Date(now.getTime() - 30*86400000);" not in source:
        raise AssertionError('rolling 30-day report filter anchor missing')

    previous_month = '''  } else if (_auPeriod === 'month') {
    end = new Date(now.getFullYear(), now.getMonth(), 1);
    start = new Date(now.getFullYear(), now.getMonth()-1, 1);
'''
    previous_30_days = '''  } else if (_auPeriod === 'month') {
    end = new Date(now.getTime() - 30*86400000);
    start = new Date(now.getTime() - 60*86400000);
'''
    source = replace_once(source, previous_month, previous_30_days, 'previous 30-day report period')

    old_period_labels = "var periodLabel = {today:'heute', week:'diese Woche', month:'diesen Monat', all:'insgesamt'}[_auPeriod] || '';"
    new_period_labels = "var periodLabel = {week:'in den letzten 7 Tagen', month:'in den letzten 30 Tagen', all:'insgesamt'}[_auPeriod] || '';"
    source = replace_once(source, old_period_labels, new_period_labels, 'report period language')

    INDEX_PATH.write_text(source, encoding='utf-8')


def migrate_navigation() -> None:
    source = NAV_PATH.read_text(encoding='utf-8')

    state_anchor = '  let initialAssistantLoadDone = false;\n'
    if 'let voiceSelectionExpanded = false;' not in source:
        source = replace_once(
            source,
            state_anchor,
            state_anchor + '  let voiceSelectionExpanded = false;\n',
            'voice selection state',
        )

    details_anchor = '''    const details = document.createElement('details');
    details.className = 'vx-nav-voice-details';
'''
    details_state = '''    const details = document.createElement('details');
    details.className = 'vx-nav-voice-details';
    details.open = voiceSelectionExpanded;
    details.addEventListener('toggle', () => {
      voiceSelectionExpanded = details.open;
    });
'''
    source = replace_once(source, details_anchor, details_state, 'persistent voice details')

    capability_pattern = re.compile(
        r"  function simplifyCapabilities\(\) \{.*?\n  \}\n\n  function simplifyTechnicalStatus\(\)",
        re.S,
    )
    capability_replacement = '''  function simplifyCapabilities() {
    const card = document.getElementById('vx-assistant-capabilities-card');
    if (!card) return;
    const title = card.querySelector('.vx-ap-title');
    const meta = card.querySelector('.vx-ap-meta');
    if (title && textLabel(title) !== 'Fähigkeiten') title.textContent = 'Fähigkeiten';
    if (meta) meta.textContent = 'Die wichtigsten Aufgaben, die Ihr Assistent aktuell übernimmt.';
    card.classList.remove('vx-as-capabilities-simple', 'is-expanded');
    card.querySelectorAll('.vx-as-cap').forEach((item) => item.classList.remove('vx-as-extra-capability'));
    card.querySelector('.vx-as-capability-toggle')?.remove();
  }

  function simplifyTechnicalStatus()'''
    source, capability_count = capability_pattern.subn(capability_replacement, source, count=1)
    if capability_count != 1:
        raise AssertionError(f'capability simplification: expected one function, found {capability_count}')

    restore_pattern = re.compile(
        r"  function restoreSettingsRoot\(\) \{.*?\n  \}\n",
        re.S,
    )
    restore_replacement = '''  function restoreSettingsRoot() {
    const main = document.getElementById('mehr-main');
    if (main) {
      main.hidden = false;
      main.style.display = '';
    }
    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => {
      node.hidden = true;
      node.style.display = 'none';
    });
  }
'''
    source, restore_count = restore_pattern.subn(restore_replacement, source, count=1)
    if restore_count != 1:
        raise AssertionError(f'settings restore: expected one function, found {restore_count}')

    helper_anchor = '  function installShowTabBridge() {\n'
    archive_helper = '''  function showArchiveInsideRequests() {
    const button = document.querySelector('#tab-anrufe [data-filter="archiv"]');
    if (!button) return;
    if (typeof root.anrufeChipFilter === 'function') {
      root.anrufeChipFilter('archiv', button);
      return;
    }
    button.click();
  }

'''
    if 'function showArchiveInsideRequests()' not in source:
        source = replace_once(source, helper_anchor, archive_helper + helper_anchor, 'archive requests helper')

    bridge_pattern = re.compile(
        r"  function installShowTabBridge\(\) \{.*?\n  \}\n\n  function applyAssistantEnhancements\(\)",
        re.S,
    )
    bridge_replacement = '''  function installShowTabBridge() {
    if (root.__vxUnifiedShowTabWrapped) return true;
    if (typeof root.showTab !== 'function') return false;
    const original = root.showTab;
    root.showTab = function unifiedShowTab(tabName) {
      const requested = String(tabName || '').toLowerCase();
      const archiveRequested = requested === 'archiv' || requested === 'archive';
      const key = archiveRequested
        ? 'anrufe'
        : ROOT_NAV.some((item) => item.key === requested) ? requested : '';
      if (key) setStableRootActive(key);

      let result;
      if (archiveRequested) {
        const args = Array.from(arguments);
        args[0] = 'anrufe';
        args[1] = document.getElementById('nav-anrufe');
        result = original.apply(this, args);
        showArchiveInsideRequests();
      } else {
        result = original.apply(this, arguments);
      }

      if (key === 'assistent') showAssistantView('profile', true);
      if (key === 'mehr') restoreSettingsRoot();
      if (key) setStableRootActive(key);
      return result;
    };
    root.__vxUnifiedShowTabWrapped = true;
    return true;
  }

  function applyAssistantEnhancements()'''
    source, bridge_count = bridge_pattern.subn(bridge_replacement, source, count=1)
    if bridge_count != 1:
        raise AssertionError(f'showTab bridge: expected one function, found {bridge_count}')

    NAV_PATH.write_text(source, encoding='utf-8')


def migrate_calendar() -> None:
    source = CALENDAR_PATH.read_text(encoding='utf-8')

    open_pattern = re.compile(
        r"  function open\(\) \{.*?\n  \}\n\n  function back\(\) \{.*?\n  \}\n",
        re.S,
    )
    replacement = '''  function setCalendarPageOpen(isOpen) {
    const main = document.getElementById('mehr-main');
    const page = document.getElementById('mehr-sub-kalender');
    if (!main || !page) return false;

    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => {
      const active = isOpen && node === page;
      node.hidden = !active;
      node.style.display = active ? 'block' : 'none';
    });
    main.hidden = isOpen;
    main.style.display = isOpen ? 'none' : '';
    return true;
  }

  function open() {
    if (!inject() || !setCalendarPageOpen(true)) return;
    render();
    load();
  }

  function back() {
    setCalendarPageOpen(false);
  }
'''
    source, count = open_pattern.subn(replacement, source, count=1)
    if count != 1:
        raise AssertionError(f'calendar visibility owner: expected one open/back block, found {count}')

    CALENDAR_PATH.write_text(source, encoding='utf-8')


def migrate_css() -> None:
    source = CSS_PATH.read_text(encoding='utf-8')
    source = replace_once(
        source,
        '.vx-requests-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));',
        '.vx-requests-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));',
        'mobile request filter columns',
    )
    source = replace_once(
        source,
        '.vx-report-periods{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));',
        '.vx-report-periods{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));',
        'desktop report period columns',
    )
    source = replace_once(
        source,
        '.vx-report-periods{grid-template-columns:repeat(2,minmax(0,1fr));}',
        '.vx-report-periods{grid-template-columns:repeat(3,minmax(0,1fr));}',
        'mobile report period columns',
    )
    CSS_PATH.write_text(source, encoding='utf-8')


def verify() -> None:
    index = INDEX_PATH.read_text(encoding='utf-8')
    nav = NAV_PATH.read_text(encoding='utf-8')
    calendar = CALENDAR_PATH.read_text(encoding='utf-8')
    css = CSS_PATH.read_text(encoding='utf-8')

    assert 'id="dash-content" class="vx-ap-stack vx-report-stack"' in index
    assert 'id="vx-requests-open-archive"' not in index
    assert index.count('data-filter="archiv"') == 1
    assert 'id="tab-archiv"' not in index
    assert 'data-report-period="today"' not in index
    assert '>7 Tage</button>' in index
    assert '>30 Tage</button>' in index
    assert "start = new Date(now.getTime() - 30*86400000);" in index
    assert "start = new Date(now.getTime() - 60*86400000);" in index

    assert 'let voiceSelectionExpanded = false;' in nav
    assert 'details.open = voiceSelectionExpanded;' in nav
    assert 'voiceSelectionExpanded = details.open;' in nav
    assert "classList.remove('vx-as-extra-capability')" in nav
    assert "querySelector('.vx-as-capability-toggle')?.remove()" in nav
    assert 'function showArchiveInsideRequests()' in nav
    assert "root.anrufeChipFilter('archiv', button)" in nav
    assert "args[0] = 'anrufe';" in nav
    assert "main.hidden = false;" in nav

    assert 'function setCalendarPageOpen(isOpen)' in calendar
    assert "main.style.display = isOpen ? 'none' : '';" in calendar
    assert "node.style.display = active ? 'block' : 'none';" in calendar

    assert '.vx-requests-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));' in css
    assert '.vx-report-periods{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));' in css
    assert '.vx-report-periods{grid-template-columns:repeat(3,minmax(0,1fr));}' in css


if __name__ == '__main__':
    migrate_index()
    migrate_navigation()
    migrate_calendar()
    migrate_css()
    verify()
    print('Customer feedback round applied and verified.')
