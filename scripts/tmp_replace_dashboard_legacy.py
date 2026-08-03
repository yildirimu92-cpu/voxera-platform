from __future__ import annotations

from pathlib import Path
import re

PATH = Path('customer-dashboard/index.html')
source = PATH.read_text(encoding='utf-8')
original = source

OBSOLETE_SELECTORS = (
    '.vx-greeting-',
    '.vx-kpi-',
    '.vx-jetzt-',
    '.vx-work-section',
    '.vx-activity-',
    '.vx-group-',
    '.dpr-command-center',
    '#dash-priority-list',
    '#dash-greeting',
    '#dash-kpi',
    '#kpi-cell-',
    '#kpi-callbacks',
    '#kpi-today',
    '#kpi-done',
    '#kpi-reach',
    '.dash-top',
    '.dash-status-',
    '.dash-focus-',
    '.dash-kpi',
    '.dash-cb-',
    '.dash-glass',
    '.dash-side-',
    '.dash-empty',
    '.dash-activation-',
    '.fse-',
)


def matching_brace(text: str, opening: int) -> int:
    depth = 0
    quote = ''
    in_comment = False
    i = opening
    while i < len(text):
        if in_comment:
            if text.startswith('*/', i):
                in_comment = False
                i += 2
                continue
            i += 1
            continue
        if quote:
            if text[i] == '\\':
                i += 2
                continue
            if text[i] == quote:
                quote = ''
            i += 1
            continue
        if text.startswith('/*', i):
            in_comment = True
            i += 2
            continue
        if text[i] in ('"', "'"):
            quote = text[i]
            i += 1
            continue
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError('Unbalanced CSS braces')


def split_selectors(value: str) -> list[str]:
    result: list[str] = []
    start = 0
    round_depth = 0
    square_depth = 0
    quote = ''
    i = 0
    while i < len(value):
        ch = value[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = ''
            i += 1
            continue
        if ch in ('"', "'"):
            quote = ch
        elif ch == '(':
            round_depth += 1
        elif ch == ')':
            round_depth = max(0, round_depth - 1)
        elif ch == '[':
            square_depth += 1
        elif ch == ']':
            square_depth = max(0, square_depth - 1)
        elif ch == ',' and round_depth == 0 and square_depth == 0:
            result.append(value[start:i].strip())
            start = i + 1
        i += 1
    result.append(value[start:].strip())
    return [item for item in result if item]


def obsolete_selector(selector: str) -> bool:
    return any(token in selector for token in OBSOLETE_SELECTORS)


def filter_css(css: str) -> tuple[str, int]:
    output: list[str] = []
    removed = 0
    i = 0
    n = len(css)
    while i < n:
        trivia_start = i
        while i < n:
            if css[i].isspace():
                i += 1
                continue
            if css.startswith('/*', i):
                end = css.find('*/', i + 2)
                if end < 0:
                    i = n
                    break
                i = end + 2
                continue
            break
        output.append(css[trivia_start:i])
        if i >= n:
            break

        prelude_start = i
        quote = ''
        paren = 0
        bracket = 0
        in_comment = False
        terminator = ''
        while i < n:
            if in_comment:
                if css.startswith('*/', i):
                    in_comment = False
                    i += 2
                    continue
                i += 1
                continue
            ch = css[i]
            if quote:
                if ch == '\\':
                    i += 2
                    continue
                if ch == quote:
                    quote = ''
                i += 1
                continue
            if css.startswith('/*', i):
                in_comment = True
                i += 2
                continue
            if ch in ('"', "'"):
                quote = ch
            elif ch == '(':
                paren += 1
            elif ch == ')':
                paren = max(0, paren - 1)
            elif ch == '[':
                bracket += 1
            elif ch == ']':
                bracket = max(0, bracket - 1)
            elif paren == 0 and bracket == 0 and ch in '{;':
                terminator = ch
                break
            i += 1

        if not terminator:
            output.append(css[prelude_start:])
            break
        if terminator == ';':
            output.append(css[prelude_start:i + 1])
            i += 1
            continue

        opening = i
        closing = matching_brace(css, opening)
        raw_prelude = css[prelude_start:opening]
        prelude = raw_prelude.strip()
        body = css[opening + 1:closing]
        lower = prelude.lower()

        if lower.startswith(('@media', '@supports', '@container', '@layer', '@document')):
            filtered_body, nested_removed = filter_css(body)
            removed += nested_removed
            if '{' in filtered_body or re.search(r'[^\s/\*]', filtered_body):
                output.append(raw_prelude + '{' + filtered_body + '}')
        elif lower.startswith('@'):
            output.append(css[prelude_start:closing + 1])
        else:
            selectors = split_selectors(prelude)
            kept = [selector for selector in selectors if not obsolete_selector(selector)]
            removed += len(selectors) - len(kept)
            if kept:
                indentation = raw_prelude[:len(raw_prelude) - len(raw_prelude.lstrip())]
                output.append(indentation + ',\n'.join(kept) + '{' + body + '}')
        i = closing + 1
    return ''.join(output), removed


def filter_style(match: re.Match[str]) -> str:
    global css_selectors_removed
    opening, css, closing = match.groups()
    filtered, removed = filter_css(css)
    css_selectors_removed += removed
    meaningful = re.sub(r'/\*.*?\*/', '', filtered, flags=re.S).strip()
    if not meaningful:
        return ''
    return opening + filtered + closing


css_selectors_removed = 0
source = re.sub(r'(<style\b[^>]*>)(.*?)(</style>)', filter_style, source, flags=re.S | re.I)

# Replace the visible dashboard shell with the already-canonical assistant components.
dash_start = source.index('<div class="tab-page active" id="tab-dashboard">')
dash_end = source.index('<!-- ANFRAGEN TAB -->', dash_start)
dash = source[dash_start:dash_end]
dash = dash.replace('<div id="dash-content" style="display:none">', '<div id="dash-content" class="vx-ap-stack" style="display:none">', 1)

block_start = dash.index('<!-- ── GREETING + KPI BLOCK v3.0 ── -->')
block_end = dash.index('<!-- Tagesbericht entfernt:', block_start)
new_dashboard_header = '''<!-- GREETING + KPI — canonical assistant design -->
            <div id="dash-greeting-block" class="vx-page-header">
              <div class="vx-ap-head">
                <div class="vx-ap-current-copy">
                  <div id="dash-greeting-title" class="vx-page-header-title"></div>
                  <div id="dash-greeting-sub" class="vx-page-header-subtitle"></div>
                </div>
                <div id="dash-datetime-label" class="vx-page-header-subtitle"></div>
              </div>
            </div>

            <div id="dash-kpi-strip" class="vx-ap-grid">
              <div class="vx-ap-card" id="kpi-cell-callbacks">
                <div id="kpi-callbacks-label" class="vx-ap-meta">Neue Anfragen</div>
                <div id="kpi-callbacks-new" class="vx-ap-title">–</div>
                <div id="kpi-callbacks-note" class="vx-ap-meta">ungeprüft</div>
              </div>
              <div class="vx-ap-card" id="kpi-cell-today">
                <div id="kpi-today-label" class="vx-ap-meta">Offene Anfragen</div>
                <div id="kpi-today-new" class="vx-ap-title">–</div>
                <div id="kpi-today-note" class="vx-ap-meta">zu erledigen</div>
              </div>
              <div class="vx-ap-card" id="kpi-cell-due">
                <div id="kpi-due-bar-new" hidden></div>
                <div id="kpi-done-label" class="vx-ap-meta">Heute fällig</div>
                <div id="kpi-done-new" class="vx-ap-title">–</div>
                <div id="kpi-done-note" class="vx-ap-meta">Anfragen</div>
              </div>
              <div class="vx-ap-card" id="kpi-cell-completed">
                <div id="kpi-reach-bar-new" hidden></div>
                <div class="vx-ap-meta">Erledigt heute</div>
                <div id="kpi-reach-val" class="vx-ap-title">–</div>
                <div id="kpi-reach-label" class="vx-ap-meta"></div>
              </div>
            </div>

            '''
dash = dash[:block_start] + new_dashboard_header + dash[block_end:]

section_start = dash.index('<!-- JETZT WICHTIG')
section_end = dash.index('<!-- HEUTE: Anrufe heute', section_start)
new_dashboard_sections = '''<!-- PRIORITY + ACTIVITY — canonical assistant design -->
            <div id="dash-priority-section" class="vx-ops-card">
              <div class="vx-ap-head">
                <div>
                  <div class="vx-ops-title">Aufmerksamkeit</div>
                  <div class="vx-ops-sub">Einmalig priorisiert</div>
                </div>
                <button type="button" class="vx-ap-btn ghost" onclick="vxDashShowAllImportant(event);">Alle</button>
              </div>
              <div id="dash-priority-list" class="vx-ops-list"></div>
              <button id="dash-recent-more" type="button" onclick="vxDashShowAllImportant(event);" class="vx-ap-btn ghost" hidden>Alle offenen Punkte anzeigen</button>
            </div>

            <div id="dash-activity-section" class="vx-ops-card">
              <div class="vx-ap-head">
                <div>
                  <div class="vx-ops-title">Heute passiert</div>
                  <div class="vx-ops-sub">Chronologischer Verlauf</div>
                </div>
                <span id="dash-activity-count" class="vx-ap-pill">0</span>
              </div>
              <div id="dash-activity-list" class="vx-ops-list"></div>
              <div class="vx-ops-note">Die Arbeitsentscheidung passiert oben unter Aufmerksamkeit.</div>
            </div>

            '''
dash = dash[:section_start] + new_dashboard_sections + dash[section_end:]

# Hidden compatibility sections use the same existing assistant components as well.
dash = dash.replace('class="vx-jetzt-section"', 'class="vx-ops-card"')
dash = dash.replace('class="vx-jetzt-header"', 'class="vx-ap-head"')
dash = dash.replace('class="vx-jetzt-title"', 'class="vx-ops-title"')
dash = dash.replace('class="vx-jetzt-link"', 'class="vx-ap-pill"')
dash = dash.replace('class="vx-jetzt-list"', 'class="vx-ops-list"')
dash = dash.replace('class="dash-glass"', 'class="vx-ops-card"')
dash = dash.replace('class="vx-report-card"', 'class="vx-ops-card"')
dash = dash.replace('class="vx-report-text"', 'class="vx-ops-sub"')
source = source[:dash_start] + dash + source[dash_end:]

# Replace the featured priority card's complete inline design with assistant components.
featured_start = source.index("  var html = '<div style=\"border-radius:16px;overflow:hidden;border:0.5px solid '")
featured_end_marker = '  el.innerHTML = html;'
featured_end = source.index(featured_end_marker, featured_start) + len(featured_end_marker)
featured_replacement = '''  var html = '<div class="vx-ops-item">';
  html += '<div class="vx-ops-head"><div class="vx-ap-current-copy">';
  html += '<div class="vx-ops-title">' + _esc(name) + '</div>';
  html += '<div class="vx-ops-sub">' + (company ? _esc(company) + ' · ' : '') + _esc(phone) + '</div>';
  html += '</div><span class="vx-ops-pill">' + _esc(badgeLbl) + '</span></div>';
  html += '<div class="vx-ops-rules">';
  html += '<div class="vx-ops-rule"><b>' + _esc(dueMeta.label || 'Offen seit') + '</b><span>' + _esc(dueMeta.value || '–') + '</span></div>';
  html += '<div class="vx-ops-rule"><b>Typ</b><span>' + _esc(typeMeta.label || '–') + '</span></div>';
  html += '<div class="vx-ops-rule"><b>Lead</b><span>' + _esc(lqLabel) + '</span></div>';
  html += '</div>';
  if (summary) html += '<div class="vx-ops-message">' + _esc(summary.length > 280 ? summary.slice(0,277) + '…' : summary) + '</div>';
  html += '<div class="vx-ops-actions">';
  if (isCallback && phone && !isDone) {
    html += '<button type="button" class="vx-ops-btn" data-action="call" data-rec-id="' + id + '" data-phone="' + ph + '"><i class="ph-bold ph-phone-call" aria-hidden="true"></i>Jetzt anrufen</button>';
  } else {
    html += '<button type="button" class="vx-ops-btn" data-action="fulldetail" data-rec-id="' + id + '" data-phone="' + ph + '"><i class="ph-bold ph-sidebar-simple" aria-hidden="true"></i>Details</button>';
  }
  if (!isDone) {
    html += '<button type="button" class="vx-ops-btn secondary" data-action="followup" data-rec-id="' + id + '" data-phone="' + ph + '"><i class="ph-bold ph-calendar" aria-hidden="true"></i>Fälligkeit</button>';
    html += '<button type="button" class="vx-ops-btn secondary" data-action="done" data-rec-id="' + id + '" data-phone="' + ph + '"><i class="ph-bold ph-check" aria-hidden="true"></i>Erledigt</button>';
  }
  html += '</div></div>';

  el.innerHTML = html;'''
source = source[:featured_start] + featured_replacement + source[featured_end:]

# Delete no-longer-used visual variables from the featured renderer.
source = re.sub(
    r"\n  var initials = \(function\(\) \{.*?\n  var badgeLbl  =",
    "\n  var badgeLbl  =",
    source,
    count=1,
    flags=re.S,
)
source = re.sub(r"\n  var lqColor\s*=.*?;", '', source, count=1)

# Convert the priority-list renderer to the assistant list/card/action components.
priority_start = source.index('function renderDashPriorityList() {')
priority_end = source.index('\nfunction vxOpenFloatingRowMenu(', priority_start)
priority = source[priority_start:priority_end]
priority = priority.replace("el.classList.add('dpr-command-center');", "el.classList.remove('dpr-command-center');\n  el.classList.add('vx-ops-list');")
priority = re.sub(
    r"vxSetHtmlIfChanged\(el, '<div style=\"padding:24px 20px;text-align:center;color:var\(--slate2\);font-size:13px;background:#fff;\">' \+\s*'<i class=\"ph-bold ph-check-circle\" style=\"color:#059669;margin-bottom:8px;\"></i><br>' \+\s*'Alles erledigt &mdash; ' \+ getAssistantName\(\) \+ ' nimmt neue Anrufe entgegen\.</div>'\);",
    "vxSetHtmlIfChanged(el, '<div class=\"vx-ap-empty\">Alles erledigt &mdash; ' + getAssistantName() + ' nimmt neue Anrufe entgegen.</div>');",
    priority,
    count=1,
    flags=re.S,
)
priority = priority.replace('class="dpr-group dpr-group-calls"', 'class="vx-ap-stack"')
priority = priority.replace("class=\"dpr-group dpr-group-' + groupKey + '\"", 'class="vx-ap-stack"')
priority = priority.replace('class="vx-group-head"', 'class="vx-ap-head"')
priority = priority.replace('class="vx-group-label"', 'class="vx-ops-title"')
priority = priority.replace('class="vx-group-count"', 'class="vx-ap-pill"')
priority = priority.replace('class="dpr-card"', 'class="dpr-card vx-ops-item"')
priority = priority.replace('class="vx-heute-row rail-today"', 'class="vx-ops-head"')
priority = priority.replace('class="vx-row-icon is-call"', 'class="vx-ap-avatar"')
priority = priority.replace('class="vx-row-body"', 'class="vx-ap-current-copy"')
priority = priority.replace('class="vx-row-name"', 'class="vx-ops-title"')
priority = priority.replace('class="vx-row-pill"', 'class="vx-ops-pill"')
priority = priority.replace('class="vx-row-summary"', 'class="vx-ops-sub"')
priority = priority.replace("html += '<div style=\"padding:8px 14px;font-size:12px;color:var(--slate2);background:#fff;\">+' + (tempRecords.length - 3) + ' weitere laufende Anrufe</div>';", "html += '<div class=\"vx-ops-note\">+' + (tempRecords.length - 3) + ' weitere laufende Anrufe</div>';" )
priority = re.sub(
    r"var _railClass = 'vx-heute-row';\n\s*if \(_railVal === 'urgent'\) _railClass \+= ' rail-overdue';\n\s*else if \(_railVal === 'planned'\) _railClass \+= ' rail-planned';\n\s*else _railClass \+= ' rail-today';",
    "var _railClass = 'vx-ops-head';",
    priority,
    count=1,
)
priority = priority.replace("var _iconClass = _isCallType ? 'vx-row-icon is-call' : 'vx-row-icon';", "var _iconClass = 'vx-ap-avatar';")
new_identity_lines = "      html += '<div class=\"vx-ops-head\"><div class=\"vx-ops-title\">'+_esc(name)+'</div><span class=\"vx-ops-pill'+(_isUnreadCall?' active':'')+'\">'+_esc(typeMeta.label)+'</span></div>';\n      var _identityMeta = [company, (phone && name !== phone ? phone : '')].filter(Boolean).join(' · ');\n      if (_identityMeta) html += '<div class=\"vx-ops-meta\">'+_esc(_identityMeta)+'</div>';"
identity_pattern = re.compile(
    r'^\s*html \+= \'<div class="vx-ops-title" style=.*?</div>\';$',
    re.MULTILINE,
)
priority, identity_count = identity_pattern.subn(new_identity_lines, priority, count=1)
if identity_count != 1:
    raise AssertionError('Priority identity line not found')
priority = priority.replace('class="vx-row-time"', 'class="vx-ops-meta"')
priority = priority.replace('class="vx-row-summary"', 'class="vx-ops-message"')
priority = priority.replace("var _primaryClass = 'vx-ibtn vx-ibtn-main ' + (_primaryAction === 'call' ? (_isTopAttention ? 'is-call' : 'is-ghost-call') : 'is-open');", "var _primaryClass = 'vx-ops-btn' + (_primaryAction === 'call' && _isTopAttention ? '' : ' secondary');")
priority = priority.replace('class="vx-row-btns vx-row-btns--single"', 'class="vx-ops-actions"')
priority = priority.replace('class="vx-ibtn is-overflow"', 'class="vx-ops-btn secondary is-overflow"')
source = source[:priority_start] + priority + source[priority_end:]

# Convert activity and scoped rows to the same assistant list/card vocabulary.
activity_start = source.index('function vxHeuteRenderActivityList(records) {')
activity_end = source.index('// ═══════════════════════════════════════════\n//  RENDER DASHBOARD', activity_start)
activity = source[activity_start:activity_end]
activity = activity.replace('<div class="dash-empty">', '<div class="vx-ap-empty">')
activity = activity.replace("var iconClass = isDone ? 'vx-activity-icon is-done' : (!vxHeuteIsManualTask(rec) ? 'vx-activity-icon is-call' : 'vx-activity-icon');", "var iconClass = 'vx-ap-avatar';")
activity = activity.replace('class="vx-activity-row"', 'class="vx-ops-item"')
activity = activity.replace('class="vx-activity-time"', 'class="vx-ap-pill"')
activity = activity.replace('style="min-width:0;"', 'class="vx-ap-current-copy"')
activity = activity.replace('class="vx-activity-title"', 'class="vx-ops-title"')
activity = activity.replace('class="vx-activity-sub"', 'class="vx-ops-sub"')
activity = activity.replace("list.querySelectorAll('.vx-activity-row')", "list.querySelectorAll('.vx-ops-item[data-record-id]')")
activity = activity.replace('class="dpr-card"', 'class="dpr-card vx-ops-item"')
activity = activity.replace('class="vx-heute-row rail-today"', 'class="vx-ops-head"')
activity = activity.replace("var iconClass = vxHeuteIsManualTask(rec) ? 'vx-row-icon' : 'vx-row-icon is-call';", "var iconClass = 'vx-ap-avatar';")
activity = activity.replace('class="vx-row-body"', 'class="vx-ap-current-copy"')
activity = activity.replace('class="vx-row-name"', 'class="vx-ops-title"')
activity = activity.replace('class="vx-row-pill"', 'class="vx-ops-pill"')
activity = activity.replace('class="vx-row-time"', 'class="vx-ops-meta"')
activity = activity.replace('class="vx-row-summary"', 'class="vx-ops-message"')
activity = activity.replace('class="vx-row-btns"', 'class="vx-ops-actions"')
activity = activity.replace('class="vx-ibtn is-call"', 'class="vx-ops-btn secondary"')
activity = activity.replace('class="vx-ibtn"', 'class="vx-ops-btn secondary"')
source = source[:activity_start] + activity + source[activity_end:]

# Remove now-empty legacy style tags and repeated empty lines.
source = re.sub(r'<style\b[^>]*>\s*(?:/\*.*?\*/\s*)*</style>', '', source, flags=re.S | re.I)
source = re.sub(r'\n{5,}', '\n\n\n', source)

# Safety checks: canonical assistant classes exist; old dashboard presentation is gone.
style_text = '\n'.join(re.findall(r'<style\b[^>]*>(.*?)</style>', source, flags=re.S | re.I))
for token in OBSOLETE_SELECTORS:
    if token in style_text:
        raise AssertionError(f'Legacy dashboard selector remains in CSS: {token}')

for required in (
    'id="dash-greeting-block" class="vx-page-header"',
    'id="dash-kpi-strip" class="vx-ap-grid"',
    'id="dash-priority-section" class="vx-ops-card"',
    'id="dash-activity-section" class="vx-ops-card"',
    'class="dpr-card vx-ops-item"',
    'class="vx-ops-actions"',
    'class="vx-ap-empty"',
):
    if required not in source:
        raise AssertionError(f'Canonical assistant component missing: {required}')

for required_id in (
    'dash-status-hero', 'dash-focus-card', 'dash-priority-list', 'dash-activity-list',
    'kpi-callbacks-new', 'kpi-today-new', 'kpi-done-new', 'kpi-reach-val',
):
    if source.count(f'id="{required_id}"') != 1:
        raise AssertionError(f'Compatibility id count changed: {required_id}')

for function_name, next_marker in (
    ('function renderDashPriorityList() {', '\nfunction vxOpenFloatingRowMenu('),
    ('function vxHeuteRenderActivityList(records) {', '// ═══════════════════════════════════════════\n//  RENDER DASHBOARD'),
):
    start = source.index(function_name)
    end = source.index(next_marker, start)
    if 'style="' in source[start:end]:
        raise AssertionError(f'Inline presentation remains in {function_name}')

if source == original:
    raise AssertionError('No dashboard migration changes were produced')

PATH.write_text(source, encoding='utf-8')
print(f'Removed {css_selectors_removed} legacy dashboard CSS selectors.')
print(f'index.html lines: {original.count(chr(10)) + 1} -> {source.count(chr(10)) + 1}')
print(f'index.html bytes: {len(original.encode("utf-8"))} -> {len(source.encode("utf-8"))}')
