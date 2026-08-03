from pathlib import Path
import re

INDEX_PATH = Path('customer-dashboard/index.html')
NAV_PATH = Path('customer-dashboard/shared/customer-runtime-unified-navigation.js')
CALENDAR_PATH = Path('customer-dashboard/shared/customer-runtime-calendar-settings.js')
CSS_PATH = Path('customer-dashboard/shared/customer-assistant-components.css')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source and old not in source:
        return source
    count = source.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected one occurrence, found {count}')
    return source.replace(old, new, 1)


def regex_once(source: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise AssertionError(f'{label}: expected one match, found {count}')
    return updated


def remove_balanced_div(source: str, element_id: str) -> str:
    marker = f'id="{element_id}"'
    marker_index = source.find(marker)
    if marker_index < 0:
        return source
    start = source.rfind('<div', 0, marker_index)
    if start < 0:
        raise AssertionError(f'{element_id}: opening div missing')
    depth = 0
    end = None
    for match in re.finditer(r'<div\b|</div\s*>', source[start:], re.I):
        if match.group(0).lower().startswith('<div'):
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                end = start + match.end()
                break
    if end is None:
        raise AssertionError(f'{element_id}: closing div missing')
    line_start = source.rfind('\n', 0, start) + 1
    previous_start = source.rfind('\n', 0, max(0, line_start - 1)) + 1
    if 'ARCHIV' in source[previous_start:line_start] and 'TAB' in source[previous_start:line_start]:
        line_start = previous_start
    while end < len(source) and source[end] in ' \t':
        end += 1
    if end < len(source) and source[end] == '\n':
        end += 1
    return source[:line_start] + source[end:]


def migrate_index() -> None:
    source = INDEX_PATH.read_text(encoding='utf-8')
    source = replace_once(source, 'id="dash-content" class="vx-ap-stack"', 'id="dash-content" class="vx-ap-stack vx-report-stack"', 'dashboard card spacing')

    source = source.replace('''              <button type="button" class="vx-ap-filter" id="vx-requests-open-archive" onclick="showTab('archiv',document.getElementById('nav-anrufe'))" aria-label="Archiv öffnen">
                <i class="ph-bold ph-archive" aria-hidden="true"></i>
                <span>Archiv</span>
              </button>
''', '', 1)

    completed = '''                <button class="vx-ap-filter vx-chip" data-filter="abgeschlossen" onclick="anrufeChipFilter('abgeschlossen',this)">Erledigt</button>
'''
    source = replace_once(source, completed, completed + '''                <button class="vx-ap-filter vx-chip" data-filter="archiv" onclick="anrufeChipFilter('archiv',this)">Archiv</button>
''', 'archive request filter')
    source = remove_balanced_div(source, 'tab-archiv')

    source = replace_once(source, '''                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="today" aria-selected="false" onclick="auSetPeriod('today',this)">Heute</button>
                  <button type="button" class="vx-ap-filter vx-report-period active" data-report-period="week" aria-selected="true" onclick="auSetPeriod('week',this)">Woche</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="month" aria-selected="false" onclick="auSetPeriod('month',this)">Monat</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="all" aria-selected="false" onclick="auSetPeriod('all',this)">Gesamt</button>
''', '''                  <button type="button" class="vx-ap-filter vx-report-period active" data-report-period="week" aria-selected="true" onclick="auSetPeriod('week',this)">7 Tage</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="month" aria-selected="false" onclick="auSetPeriod('month',this)">30 Tage</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="all" aria-selected="false" onclick="auSetPeriod('all',this)">Gesamt</button>
''', 'report period controls')

    source = replace_once(source, '''  } else if (_auPeriod === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
''', '''  } else if (_auPeriod === 'month') {
    start = new Date(now.getTime() - 30 * 86400000);
''', 'rolling 30-day report filter')
    source = replace_once(source, '''  } else if (_auPeriod === 'month') {
    end = new Date(now.getFullYear(), now.getMonth(), 1);
    start = new Date(now.getFullYear(), now.getMonth()-1, 1);
''', '''  } else if (_auPeriod === 'month') {
    end = new Date(now.getTime() - 30 * 86400000);
    start = new Date(now.getTime() - 60 * 86400000);
''', 'previous 30-day report period')
    source = replace_once(source, "var periodLabel = {today:'heute', week:'diese Woche', month:'diesen Monat', all:'insgesamt'}[_auPeriod] || '';", "var periodLabel = {week:'in den letzten 7 Tagen', month:'in den letzten 30 Tagen', all:'insgesamt'}[_auPeriod] || '';", 'report period language')
    INDEX_PATH.write_text(source, encoding='utf-8')


def migrate_navigation() -> None:
    source = NAV_PATH.read_text(encoding='utf-8')
    if 'let voiceSelectionExpanded = false;' not in source:
        source = replace_once(source, '  let initialAssistantLoadDone = false;\n', '  let initialAssistantLoadDone = false;\n  let voiceSelectionExpanded = false;\n', 'voice accordion state')
    source = replace_once(source, '''    const details = document.createElement('details');
    details.className = 'vx-nav-voice-details';
''', '''    const details = document.createElement('details');
    details.className = 'vx-nav-voice-details';
    details.open = voiceSelectionExpanded;
    details.addEventListener('toggle', () => {
      voiceSelectionExpanded = details.open;
    });
''', 'persistent voice accordion')

    source = regex_once(source, r"  function simplifyCapabilities\(\) \{.*?\n  \}\n\n  function simplifyTechnicalStatus\(\)", '''  function simplifyCapabilities() {
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

  function simplifyTechnicalStatus()''', 'capability expansion owner')

    source = regex_once(source, r"  function restoreSettingsRoot\(\) \{.*?\n  \}\n", '''  function restoreSettingsRoot() {
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
''', 'settings root visibility')

    if 'function showArchiveInsideRequests()' not in source:
        source = replace_once(source, '  function installShowTabBridge() {\n', '''  function showArchiveInsideRequests() {
    const button = document.querySelector('#tab-anrufe [data-filter="archiv"]');
    if (!button) return;
    if (typeof root.anrufeChipFilter === 'function') {
      root.anrufeChipFilter('archiv', button);
      return;
    }
    button.click();
  }

  function installShowTabBridge() {
''', 'archive request bridge')

    source = regex_once(source, r"  function installShowTabBridge\(\) \{.*?\n  \}\n\n  function applyAssistantEnhancements\(\)", '''  function installShowTabBridge() {
    if (root.__vxUnifiedShowTabWrapped) return true;
    if (typeof root.showTab !== 'function') return false;
    const original = root.showTab;
    root.showTab = function unifiedShowTab(tabName) {
      const requested = String(tabName || '').toLowerCase();
      const archiveRequested = requested === 'archiv' || requested === 'archive';
      const key = archiveRequested ? 'anrufe' : ROOT_NAV.some((item) => item.key === requested) ? requested : '';
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

  function applyAssistantEnhancements()''', 'unified archive route')
    NAV_PATH.write_text(source, encoding='utf-8')


def migrate_calendar() -> None:
    source = CALENDAR_PATH.read_text(encoding='utf-8')
    source = regex_once(source, r"  function open\(\) \{.*?\n  \}\n\n  function back\(\) \{.*?\n  \}\n", '''  function setCalendarPageOpen(isOpen) {
    const main = document.getElementById('mehr-main');
    const page = document.getElementById('mehr-sub-kalender');
    if (!main || !page) return false;
    if (isOpen) page.removeAttribute('style');
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
''', 'calendar page visibility')
    CALENDAR_PATH.write_text(source, encoding='utf-8')


def migrate_css() -> None:
    source = CSS_PATH.read_text(encoding='utf-8')
    source = replace_once(source, '.vx-requests-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));', '.vx-requests-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));', 'request filter grid')
    source = replace_once(source, '.vx-report-periods{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));', '.vx-report-periods{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));', 'report filter grid')
    source = replace_once(source, '.vx-report-periods{grid-template-columns:repeat(2,minmax(0,1fr));}', '.vx-report-periods{grid-template-columns:repeat(3,minmax(0,1fr));}', 'mobile report filter grid')
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
    assert '>7 Tage</button>' in index and '>30 Tage</button>' in index
    assert 'details.open = voiceSelectionExpanded;' in nav
    assert "classList.remove('vx-as-extra-capability')" in nav
    assert 'function showArchiveInsideRequests()' in nav
    assert 'function setCalendarPageOpen(isOpen)' in calendar
    assert "page.removeAttribute('style')" in calendar
    assert '.vx-requests-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));' in css
    assert '.vx-report-periods{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));' in css


if __name__ == '__main__':
    migrate_index()
    migrate_navigation()
    migrate_calendar()
    migrate_css()
    verify()
    print('Customer feedback round applied and verified.')
