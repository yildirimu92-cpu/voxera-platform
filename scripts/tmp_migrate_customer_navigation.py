from pathlib import Path
import re

HTML_PATH = Path('customer-dashboard/index.html')
RUNTIME_PATH = Path('customer-dashboard/shared/customer-runtime-unified-navigation.js')


def remove_once(value: str, block: str, label: str) -> str:
    count = value.count(block)
    if count == 0:
        return value
    if count != 1:
        raise AssertionError(f'{label}: expected one legacy block, found {count}')
    return value.replace(block, '', 1)


def migrate() -> None:
    html = HTML_PATH.read_text(encoding='utf-8')
    runtime = RUNTIME_PATH.read_text(encoding='utf-8')

    desktop_archive = '''        <div class="nav-item" id="nav-archiv" onclick="showTab('archiv',this)">
          <i class="ph-light ph-archive nav-icon" aria-hidden="true"></i>
          Archiv
        </div>
'''
    mobile_archive = '''      <button class="mobile-nav-btn" id="mnav-archiv" onclick="showTab('archiv',this)">
        <span class="mobile-nav-icon-wrap">
          <i class="ph-bold ph-archive" aria-hidden="true"></i>
        </span>
        Archiv
      </button>
'''
    settings_report = '''              <button type="button" class="vx-settings-entry" onclick="showTab('auswertung')">
                <span class="vx-settings-entry-icon"><i class="ph-bold ph-chart-bar" aria-hidden="true"></i></span>
                <span class="vx-settings-entry-copy"><span class="vx-settings-entry-title">Bericht</span><span class="vx-settings-entry-subtitle">Anrufstatistiken &amp; Auswertung</span></span>
                <i class="ph-bold ph-caret-right vx-settings-entry-caret" aria-hidden="true"></i>
              </button>
'''

    html = remove_once(html, desktop_archive, 'desktop archive root')
    html = remove_once(html, mobile_archive, 'mobile archive root')
    html = remove_once(html, settings_report, 'duplicate report settings entry')

    html = html.replace(
        'id="nav-assistent" onclick="showTab(\'assistent\',this)" style="display:none;"',
        'id="nav-assistent" onclick="showTab(\'assistent\',this)"',
    )
    html = html.replace(
        'id="mnav-assistent" onclick="showTab(\'assistent\',this)" style="display:none;"',
        'id="mnav-assistent" onclick="showTab(\'assistent\',this)"',
    )
    html = html.replace(
        'id="mnav-auswertung" onclick="showTab(\'auswertung\',this)" style="display:none;"',
        'id="mnav-auswertung" onclick="showTab(\'auswertung\',this)"',
    )
    html = html.replace(
        '<i class="ph-bold ph-dots-three" aria-hidden="true"></i>',
        '<i class="ph-bold ph-gear" aria-hidden="true"></i>',
        1,
    )
    html = html.replace(
        '''        Mehr
      </button>
      <!-- Hidden compat -->''',
        '''        Einstellungen
      </button>
      <!-- Hidden compat -->''',
        1,
    )

    archive_action = '''              <button type="button" class="vx-ap-filter" id="vx-requests-open-archive" onclick="showTab('archiv',document.getElementById('nav-anrufe'))" aria-label="Archiv öffnen">
                <i class="ph-bold ph-archive" aria-hidden="true"></i>
                <span>Archiv</span>
              </button>
'''
    header_anchor = '''              <div>
                <div class="vx-page-header-title">Anfragen</div>
                <div id="anrufe-split-count" class="vx-page-header-subtitle">–</div>
              </div>
'''
    if 'id="vx-requests-open-archive"' not in html:
        if html.count(header_anchor) != 1:
            raise AssertionError('Anfragen header anchor missing or duplicated')
        html = html.replace(header_anchor, header_anchor + archive_action, 1)

    if 'function hideArchiveRootNavigation()' in runtime:
        runtime, count = re.subn(
            r'\n  function hideArchiveRootNavigation\(\) \{.*?\n  \}\n',
            '\n',
            runtime,
            count=1,
            flags=re.S,
        )
        if count != 1:
            raise AssertionError('archive hide function could not be removed safely')

    legacy_visibility = '''      if (item.key === 'assistent') {
        [desktop, mobile].filter(Boolean).forEach((node) => {
          node.hidden = false;
          node.removeAttribute('aria-hidden');
          node.style.removeProperty('display');
        });
      }
'''
    canonical_visibility = '''      [desktop, mobile].filter(Boolean).forEach((node) => {
        node.hidden = false;
        node.removeAttribute('aria-hidden');
        node.removeAttribute('tabindex');
        node.style.removeProperty('display');
      });
'''
    if legacy_visibility in runtime:
        runtime = runtime.replace(legacy_visibility, canonical_visibility, 1)
    runtime = runtime.replace('    hideArchiveRootNavigation();\n', '', 1)

    legacy_initial = '''    const query = new URLSearchParams(root.location?.search || '');
    const raw = String(query.get('tab') || '').toLowerCase();
    const aliases = { today: 'dashboard', requests: 'anrufe', assistant: 'assistent', report: 'auswertung', more: 'mehr' };
    return ROOT_NAV.some((item) => item.key === raw) ? raw : aliases[raw] || 'dashboard';
'''
    canonical_initial = '''    const query = new URLSearchParams(root.location?.search || '');
    const queryTab = String(query.get('tab') || '').toLowerCase();
    const hashTab = String(root.location?.hash || '').replace(/^#(?:tab-)?/, '').toLowerCase();
    const raw = queryTab || hashTab;
    const aliases = {
      today: 'dashboard',
      requests: 'anrufe',
      assistant: 'assistent',
      report: 'auswertung',
      more: 'mehr',
      archiv: 'anrufe',
      archive: 'anrufe'
    };
    return ROOT_NAV.some((item) => item.key === raw) ? raw : aliases[raw] || 'dashboard';
'''
    if legacy_initial in runtime:
        runtime = runtime.replace(legacy_initial, canonical_initial, 1)

    legacy_bridge = '''    root.showTab = function unifiedShowTab(tabName) {
      const key = ROOT_NAV.some((item) => item.key === tabName) ? tabName : '';
      if (key) setStableRootActive(key);
      const result = original.apply(this, arguments);
'''
    canonical_bridge = '''    root.showTab = function unifiedShowTab(tabName) {
      const requested = String(tabName || '').toLowerCase();
      const key = requested === 'archiv'
        ? 'anrufe'
        : ROOT_NAV.some((item) => item.key === requested) ? requested : '';
      if (key) setStableRootActive(key);
      const result = original.apply(this, arguments);
'''
    if legacy_bridge in runtime:
        runtime = runtime.replace(legacy_bridge, canonical_bridge, 1)

    HTML_PATH.write_text(html, encoding='utf-8')
    RUNTIME_PATH.write_text(runtime, encoding='utf-8')


def verify() -> None:
    html = HTML_PATH.read_text(encoding='utf-8')
    runtime = RUNTIME_PATH.read_text(encoding='utf-8')

    desktop_ids = re.findall(r'id="(nav-(?:dashboard|anrufe|assistent|auswertung|mehr))"', html)
    mobile_ids = re.findall(r'id="(mnav-(?:dashboard|anrufe|assistent|auswertung|mehr))"', html)
    assert sorted(desktop_ids) == sorted(['nav-dashboard', 'nav-anrufe', 'nav-assistent', 'nav-auswertung', 'nav-mehr']), desktop_ids
    assert sorted(mobile_ids) == sorted(['mnav-dashboard', 'mnav-anrufe', 'mnav-assistent', 'mnav-auswertung', 'mnav-mehr']), mobile_ids
    assert 'id="nav-archiv"' not in html
    assert 'id="mnav-archiv"' not in html
    assert html.count('id="vx-requests-open-archive"') == 1
    assert 'onclick="showTab(\'auswertung\')"' not in html
    assert 'id="tab-archiv"' in html
    assert "showTab('archiv',document.getElementById('nav-anrufe'))" in html
    assert 'id="nav-assistent" onclick="showTab(\'assistent\',this)" style=' not in html
    assert 'id="mnav-assistent" onclick="showTab(\'assistent\',this)" style=' not in html
    assert 'id="mnav-auswertung" onclick="showTab(\'auswertung\',this)" style=' not in html
    assert 'function hideArchiveRootNavigation()' not in runtime
    assert "requested === 'archiv'" in runtime
    assert "archiv: 'anrufe'" in runtime
    assert "archive: 'anrufe'" in runtime
    for key in ('dashboard', 'anrufe', 'assistent', 'auswertung', 'mehr'):
        assert runtime.count(f"{{ key: '{key}'") == 1, key


if __name__ == '__main__':
    migrate()
    verify()
    print('Five-root customer navigation migration verified.')
