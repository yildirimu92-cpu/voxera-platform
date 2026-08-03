from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / 'customer-dashboard' / 'index.html'
CSS_PATH = ROOT / 'customer-dashboard' / 'shared' / 'customer-assistant-components.css'

index = INDEX_PATH.read_text(encoding='utf-8')
css = CSS_PATH.read_text(encoding='utf-8')

# Delete the obsolete mail-like split-view patch. It still owns the current
# #anrufe-split-left and chip selectors through !important declarations.
legacy_start = '/* PR-FIX 2026-05-23 — Anfragen Inbox nach Mockup: Mail-like Split-View.'
legacy_end = '@media (hover:none), (max-width:1099px){\n}\n'
if index.count(legacy_start) != 1:
    raise SystemExit(f'legacy requests split marker mismatch: {index.count(legacy_start)}')
start = index.index(legacy_start)
end = index.find(legacy_end, start)
if end < 0:
    raise SystemExit('legacy requests split end marker missing')
index = index[:start] + index[end + len(legacy_end):]

# Remove the active bare #anrufe-list legacy owner while preserving the Today owner.
old_list_owner = '''#dash-priority-list,
#anrufe-list.dpr-command-center,
#anrufe-list{
  background:var(--surface)!important;
  border-color:var(--line)!important;
}'''
new_list_owner = '''#dash-priority-list{
  background:var(--surface)!important;
  border-color:var(--line)!important;
}'''
if index.count(old_list_owner) != 1:
    raise SystemExit(f'legacy list owner mismatch: {index.count(old_list_owner)}')
index = index.replace(old_list_owner, new_list_owner, 1)

# Remove generic Requests selection overrides. The canonical owner already uses sp-active.
old_active_rail = '''#anrufe-list .dpr-card.sp-active,
#dash-priority-list .dpr-card.sp-active,
#anrufe-list .sp-active,
#dash-priority-list .sp-active {
  border-left: 3px solid var(--blue) !important;
}'''
new_active_rail = '''#dash-priority-list .dpr-card.sp-active,
#dash-priority-list .sp-active {
  border-left: 3px solid var(--blue) !important;
}'''
if index.count(old_active_rail) != 1:
    raise SystemExit(f'legacy active rail mismatch: {index.count(old_active_rail)}')
index = index.replace(old_active_rail, new_active_rail, 1)

old_active_fill = '''#anrufe-list .dpr-card.sp-active .vx-anf-row,
#dash-priority-list .dpr-card.sp-active .vx-heute-row {
  background: rgba(26,111,232,.06) !important;
}'''
new_active_fill = '''#dash-priority-list .dpr-card.sp-active .vx-heute-row {
  background: rgba(26,111,232,.06) !important;
}'''
if index.count(old_active_fill) != 1:
    raise SystemExit(f'legacy active fill mismatch: {index.count(old_active_fill)}')
index = index.replace(old_active_fill, new_active_fill, 1)

replacements = {
    'body.vx-customer-design-foundation .vx-requests-layout{display:grid;grid-template-columns:minmax(360px,0.92fr) minmax(0,1.08fr);align-items:stretch;gap:16px;min-width:0;min-height:560px;}':
    'body.vx-customer-design-foundation #tab-anrufe{background:var(--vx-canvas);}\nbody.vx-customer-design-foundation .vx-requests-layout{display:grid;grid-template-columns:minmax(360px,0.92fr) minmax(0,1.08fr);align-items:stretch;gap:16px;min-width:0;min-height:560px;background:transparent;}',

    'body.vx-customer-design-foundation .vx-requests-panel,body.vx-customer-design-foundation .vx-requests-detail-panel{min-width:0;padding:0;overflow:hidden;}':
    'body.vx-customer-design-foundation .vx-requests-panel,body.vx-customer-design-foundation .vx-requests-detail-panel{min-width:0;padding:0;overflow:hidden;border:1px solid #dfe6ef;background:#f1f5f9;box-shadow:0 10px 28px rgba(15,35,71,.05);}',

    'body.vx-customer-design-foundation #tab-anrufe .vx-ap-filter.vx-chip.vx-chip--active{border-color:var(--vx-brand);background:var(--vx-brand);color:#ffffff;}':
    'body.vx-customer-design-foundation #tab-anrufe .vx-ap-filter.vx-chip.vx-chip--active{border-color:#b7cff5;background:#e4efff;color:var(--vx-brand-dark);box-shadow:inset 0 0 0 1px rgba(52,120,237,.08);}',

    'body.vx-customer-design-foundation .vx-requests-search-box{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;box-sizing:border-box;min-height:48px;padding:0 12px;border:1px solid var(--vx-line);border-radius:var(--vx-radius-control);background:#ffffff;}':
    'body.vx-customer-design-foundation .vx-requests-search-box{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;box-sizing:border-box;min-height:48px;padding:0 12px;border:1px solid #d5e2f5;border-radius:var(--vx-radius-control);background:#ffffff;box-shadow:0 1px 2px rgba(15,35,71,.035);}',

    'body.vx-customer-design-foundation .vx-requests-scroll{min-height:0;max-height:720px;overflow:auto;border-top:1px solid var(--vx-line);overscroll-behavior:contain;}':
    'body.vx-customer-design-foundation .vx-requests-scroll{min-height:0;max-height:720px;overflow:auto;border-top:1px solid #dfe6ef;background:#e9eef5;overscroll-behavior:contain;}',

    'body.vx-customer-design-foundation .vx-requests-list{gap:0;margin-top:0;}':
    'body.vx-customer-design-foundation .vx-requests-list{display:grid;gap:8px;margin:0;padding:10px;}',

    'body.vx-customer-design-foundation .vx-requests-date{display:flex;align-items:center;gap:7px;margin:0;padding:10px 16px;border-bottom:1px solid var(--vx-line);background:#f8fafc;font-weight:700;}':
    'body.vx-customer-design-foundation .vx-requests-date{display:flex;align-items:center;gap:7px;margin:4px 0 0;padding:8px 6px;border:0;background:transparent;color:var(--vx-muted);font-weight:700;}',

    'body.vx-customer-design-foundation .vx-requests-item{padding:0;border:0;border-bottom:1px solid var(--vx-line);border-radius:0;background:#ffffff;box-shadow:none;transition:background 120ms ease,box-shadow 120ms ease;}':
    'body.vx-customer-design-foundation .vx-requests-item{padding:0;border:1px solid #dfe6ef;border-radius:14px;background:#f8fafc;box-shadow:0 1px 2px rgba(15,35,71,.035);overflow:hidden;transition:background 120ms ease,border-color 120ms ease,box-shadow 120ms ease,transform 120ms ease;}',

    'body.vx-customer-design-foundation .vx-requests-item:last-child{border-bottom:0;}':
    'body.vx-customer-design-foundation .vx-requests-item:last-child{border-bottom:1px solid #dfe6ef;}',

    'body.vx-customer-design-foundation .vx-requests-item:hover,body.vx-customer-design-foundation .vx-requests-item.sp-active{background:#f5f8ff;}':
    'body.vx-customer-design-foundation .vx-requests-item:hover{border-color:#c7d9f4;background:#eef4ff;transform:translateY(-1px);}\nbody.vx-customer-design-foundation .vx-requests-item.sp-active{border-color:#a9c7f5;background:#e3edff;}',

    'body.vx-customer-design-foundation .vx-requests-item.sp-active{box-shadow:inset 3px 0 0 var(--vx-brand);}':
    'body.vx-customer-design-foundation .vx-requests-item.sp-active{box-shadow:0 8px 20px rgba(52,120,237,.11);}',

    'body.vx-customer-design-foundation .vx-requests-item.is-unread{background:#fbfdff;}':
    'body.vx-customer-design-foundation .vx-requests-item.is-unread{background:#f5f8ff;}',

    'body.vx-customer-design-foundation .vx-requests-detail-panel{display:flex;flex-direction:column;}':
    'body.vx-customer-design-foundation .vx-requests-detail-panel{display:flex;flex-direction:column;background:#eef2f7;}',

    'body.vx-customer-design-foundation .vx-requests-detail{min-width:0;}':
    'body.vx-customer-design-foundation .vx-requests-detail{min-width:0;background:#f8fafc;}',
}

for old, new in replacements.items():
    count = css.count(old)
    if count != 1:
        raise SystemExit(f'canonical requests rule mismatch ({count}): {old[:100]}')
    css = css.replace(old, new, 1)

# Keep the canonical Requests owner within its established constraints.
if '!important' in css:
    raise SystemExit('canonical assistant owner contains important overrides')
if len(css.splitlines()) > 800:
    raise SystemExit(f'assistant owner size exceeded: {len(css.splitlines())}')

required_index = [
    'id="anrufe-split" class="vx-requests-layout"',
    'id="anrufe-split-left" class="vx-ops-card vx-requests-panel"',
    'id="anrufe-split-right" class="vx-ops-card vx-requests-detail-panel"',
    "el.classList.add('vx-ops-list', 'vx-requests-list')",
    "el.classList.toggle('sp-active'",
]
missing = [token for token in required_index if token not in index]
if missing:
    raise SystemExit('request behavior markers missing: ' + ', '.join(missing))

forbidden_index = [
    legacy_start,
    '#anrufe-split-left{',
    '#anrufe-list .sp-active,',
    '#anrufe-list{\n  background:var(--surface)!important;',
]
present = [token for token in forbidden_index if token in index]
if present:
    raise SystemExit('legacy request owners remain: ' + ', '.join(present))

required_css = [
    'body.vx-customer-design-foundation #tab-anrufe{background:var(--vx-canvas);}',
    'background:#e9eef5;',
    'background:#e4efff;color:var(--vx-brand-dark);',
    'background:#e3edff;',
    'border-radius:14px;',
    'box-shadow:0 8px 20px rgba(52,120,237,.11);',
]
missing = [token for token in required_css if token not in css]
if missing:
    raise SystemExit('premium request styles missing: ' + ', '.join(missing))

INDEX_PATH.write_text(index, encoding='utf-8')
CSS_PATH.write_text(css, encoding='utf-8')
print('requests premium migration applied')
