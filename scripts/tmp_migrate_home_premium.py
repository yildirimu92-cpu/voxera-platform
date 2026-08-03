from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / 'customer-dashboard' / 'index.html'
CSS_PATH = ROOT / 'customer-dashboard' / 'shared' / 'customer-assistant-components.css'

index = INDEX_PATH.read_text(encoding='utf-8')
css = CSS_PATH.read_text(encoding='utf-8')

note_replacements = {
    '<div id="kpi-callbacks-note" class="vx-ap-meta">Eingänge seit Tagesbeginn</div>': '<div id="kpi-callbacks-note" class="vx-ap-meta" hidden></div>',
    '<div id="kpi-today-note" class="vx-ap-meta">Nicht bearbeitet</div>': '<div id="kpi-today-note" class="vx-ap-meta" hidden></div>',
    '<div id="kpi-done-note" class="vx-ap-meta">Priorisiert oder überfällig</div>': '<div id="kpi-done-note" class="vx-ap-meta" hidden></div>',
    '<div id="kpi-reach-label" class="vx-ap-meta">Heute abgeschlossen</div>': '<div id="kpi-reach-label" class="vx-ap-meta" hidden></div>',
}
for old, new in note_replacements.items():
    if index.count(old) != 1:
        raise SystemExit(f'expected one KPI note markup: {old!r}; found {index.count(old)}')
    index = index.replace(old, new, 1)

assignment_replacements = {
    "if (kpiCallbacksNote) kpiCallbacksNote.textContent = 'Eingänge seit Tagesbeginn';": "if (kpiCallbacksNote) { kpiCallbacksNote.textContent = ''; kpiCallbacksNote.hidden = true; }",
    "if (kpiTodayNote) kpiTodayNote.textContent = 'Nicht bearbeitet';": "if (kpiTodayNote) { kpiTodayNote.textContent = ''; kpiTodayNote.hidden = true; }",
    "if (kpiDoneNote) kpiDoneNote.textContent = 'Priorisiert oder überfällig';": "if (kpiDoneNote) { kpiDoneNote.textContent = ''; kpiDoneNote.hidden = true; }",
    "if (kpiReachLabel) kpiReachLabel.textContent = 'Heute abgeschlossen';": "if (kpiReachLabel) { kpiReachLabel.textContent = ''; kpiReachLabel.hidden = true; }",
}
for old, new in assignment_replacements.items():
    if index.count(old) != 1:
        raise SystemExit(f'expected one KPI note assignment: {old!r}; found {index.count(old)}')
    index = index.replace(old, new, 1)

old_interaction = '''function vxSetHeuteKpiCell(cell, interactive, handlerName) {
  if (!cell) return;
  cell.classList.toggle('is-interactive', !!interactive);
  cell.classList.toggle('is-static', !interactive);
  cell.style.cursor = interactive ? 'pointer' : 'default';
  cell.onclick = interactive && handlerName ? function(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (typeof window[handlerName] === 'function') window[handlerName]();
  } : null;
}'''
new_interaction = '''function vxSetHeuteKpiCell(cell, interactive, handlerName) {
  if (!cell) return;
  var canOpen = !!interactive && !!handlerName;
  var activate = canOpen ? function(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (typeof window[handlerName] === 'function') window[handlerName]();
  } : null;
  cell.classList.toggle('is-interactive', canOpen);
  cell.classList.toggle('is-static', !canOpen);
  cell.setAttribute('role', canOpen ? 'button' : 'group');
  cell.setAttribute('aria-disabled', canOpen ? 'false' : 'true');
  cell.tabIndex = canOpen ? 0 : -1;
  cell.onclick = activate;
  cell.onkeydown = canOpen ? function(ev) {
    if (ev && (ev.key === 'Enter' || ev.key === ' ')) activate(ev);
  } : null;
}'''
if index.count(old_interaction) != 1:
    raise SystemExit(f'expected one KPI interaction function, found {index.count(old_interaction)}')
index = index.replace(old_interaction, new_interaction, 1)

marker = '/* Customer home: premium assistant-aligned workspace. */'
if marker in css:
    raise SystemExit('home premium CSS marker already exists')

home_css = r'''

/* Customer home: premium assistant-aligned workspace. */
body.vx-customer-design-foundation #tab-dashboard {
  background: var(--vx-canvas);
}

body.vx-customer-design-foundation #tab-dashboard #dash-content {
  display: grid;
  min-width: 0;
}

body.vx-customer-design-foundation #dash-kpi-strip {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

body.vx-customer-design-foundation #dash-kpi-strip > .vx-ap-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 118px;
  padding: 18px;
  overflow: hidden;
  border: 1px solid #dbe7fb;
  background: #eef4ff;
  box-shadow: 0 8px 22px rgba(15, 35, 71, 0.055);
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}

body.vx-customer-design-foundation #dash-kpi-strip > .vx-ap-card.is-interactive {
  cursor: pointer;
}

body.vx-customer-design-foundation #dash-kpi-strip > .vx-ap-card.is-interactive:hover {
  transform: translateY(-1px);
  border-color: #bcd2f7;
  background: #e4efff;
  box-shadow: 0 12px 28px rgba(15, 35, 71, 0.08);
}

body.vx-customer-design-foundation #dash-kpi-strip > .vx-ap-card.is-interactive:focus-visible {
  border-color: var(--vx-brand);
  background: #e4efff;
  outline: 3px solid rgba(52, 120, 237, 0.22);
  outline-offset: 2px;
}

body.vx-customer-design-foundation #dash-kpi-strip > .vx-ap-card.is-static {
  border-color: var(--vx-line);
  background: #f8fafc;
  box-shadow: none;
}

body.vx-customer-design-foundation #dash-kpi-strip :where(
  #kpi-callbacks-label,
  #kpi-today-label,
  #kpi-done-label,
  #kpi-completed-label
) {
  margin: 0;
  color: #52657d;
  font-size: 13px;
  font-weight: 720;
  line-height: 1.3;
}

body.vx-customer-design-foundation #dash-kpi-strip :where(
  #kpi-callbacks-new,
  #kpi-today-new,
  #kpi-done-new,
  #kpi-reach-val
) {
  margin-top: 12px;
  color: var(--vx-brand);
  font-size: 32px;
  font-weight: 780;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

body.vx-customer-design-foundation #dash-priority-section {
  margin-top: 0;
}

body.vx-customer-design-foundation #tab-dashboard .vx-ops-card {
  border-color: #dfe6ef;
}

body.vx-customer-design-foundation #tab-dashboard .vx-ops-item {
  border-color: #e2e8f0;
  background: #f8fafc;
  box-shadow: none;
}

body.vx-customer-design-foundation #dash-priority-section .vx-ops-item {
  border-color: #dbe7fb;
  background: #f5f8ff;
}

@media (max-width: 768px) {
  body.vx-customer-design-foundation #dash-kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 10px !important;
    margin-bottom: 18px;
  }

  body.vx-customer-design-foundation #dash-kpi-strip > .vx-ap-card {
    min-height: 108px;
    padding: 16px !important;
    border: 1px solid #dbe7fb !important;
    border-radius: 16px;
  }

  body.vx-customer-design-foundation #dash-kpi-strip > .vx-ap-card.is-static {
    border-color: var(--vx-line) !important;
  }

  body.vx-customer-design-foundation #dash-kpi-strip :where(
    #kpi-callbacks-new,
    #kpi-today-new,
    #kpi-done-new,
    #kpi-reach-val
  ) {
    margin-top: 10px !important;
    font-size: 28px !important;
  }
}

@media (max-width: 390px) {
  body.vx-customer-design-foundation #dash-kpi-strip {
    gap: 8px !important;
  }

  body.vx-customer-design-foundation #dash-kpi-strip > .vx-ap-card {
    min-height: 102px;
    padding: 14px !important;
  }
}
'''
css = css.rstrip() + home_css + '\n'

for token, expected in {
    'id="kpi-callbacks-note" class="vx-ap-meta" hidden': 1,
    'id="kpi-today-note" class="vx-ap-meta" hidden': 1,
    'id="kpi-done-note" class="vx-ap-meta" hidden': 1,
    'id="kpi-reach-label" class="vx-ap-meta" hidden': 1,
    "kpiTodayNote.textContent = 'Nicht bearbeitet'": 0,
    "kpiCallbacksNote.textContent = 'Eingänge seit Tagesbeginn'": 0,
    "kpiDoneNote.textContent = 'Priorisiert oder überfällig'": 0,
    "kpiReachLabel.textContent = 'Heute abgeschlossen'": 0,
    "cell.setAttribute('role', canOpen ? 'button' : 'group')": 1,
}.items():
    actual = index.count(token)
    if actual != expected:
        raise SystemExit(f'{token!r}: expected {expected}, found {actual}')

if css.count(marker) != 1:
    raise SystemExit(f'expected one home CSS marker, found {css.count(marker)}')
if '#dash-kpi-strip' not in css or '#dash-priority-section' not in css:
    raise SystemExit('home CSS ownership incomplete')

INDEX_PATH.write_text(index, encoding='utf-8')
CSS_PATH.write_text(css, encoding='utf-8')
print('home premium migration applied')
