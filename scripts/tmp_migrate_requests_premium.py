from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
index_path = root / 'customer-dashboard/index.html'
css_path = root / 'customer-dashboard/shared/customer-assistant-components.css'
index = index_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1, found {count}')
    return text.replace(old, new, 1)


start_marker = '/* PR-FIX 2026-05-23 — Anfragen Inbox nach Mockup: Mail-like Split-View.'
end_marker = '''@media(max-width:1099px){
  #tab-anrufe .vx-split-left,
  #anrufe-split-left{
    width:100% !important;
    min-width:0 !important;
    max-width:none !important;
    border-radius:10px !important;
  }
}
'''
if index.count(start_marker) != 1:
    raise SystemExit(f'legacy split-view start mismatch: {index.count(start_marker)}')
start = index.index(start_marker)
end = index.find(end_marker, start)
if end < 0:
    raise SystemExit('legacy split-view end missing')
index = index[:start] + index[end + len(end_marker):]

legacy_blocks = [
    (
        '''#dash-priority-list,
#anrufe-list.dpr-command-center,
#anrufe-list{
  background:var(--surface)!important;
  border-color:var(--line)!important;
}''',
        '''#dash-priority-list{
  background:var(--surface)!important;
  border-color:var(--line)!important;
}''',
        'legacy list owner',
    ),
    (
        '''#anrufe-list .dpr-card.sp-active,
#dash-priority-list .dpr-card.sp-active,
#anrufe-list .sp-active,
#dash-priority-list .sp-active {
  border-left: 3px solid var(--blue) !important;
}''',
        '''#dash-priority-list .dpr-card.sp-active,
#dash-priority-list .sp-active {
  border-left: 3px solid var(--blue) !important;
}''',
        'legacy active rail',
    ),
    (
        '''#anrufe-list .dpr-card.sp-active .vx-anf-row,
#dash-priority-list .dpr-card.sp-active .vx-heute-row {
  background: rgba(26,111,232,.06) !important;
}''',
        '''#dash-priority-list .dpr-card.sp-active .vx-heute-row {
  background: rgba(26,111,232,.06) !important;
}''',
        'legacy active fill',
    ),
    (
        '''#dash-priority-list .sp-active .dpr-row,
#anrufe-list .sp-active .dpr-row,
#dash-priority-list .dpr-card.sp-active .dpr-row,
#anrufe-list .dpr-card.sp-active .dpr-row{
  background:rgba(26,111,232,.05) !important;
}''',
        '''#dash-priority-list .sp-active .dpr-row,
#dash-priority-list .dpr-card.sp-active .dpr-row{
  background:rgba(26,111,232,.05) !important;
}''',
        'legacy secondary fill',
    ),
    (
        '''#dash-priority-list .sp-active,
#anrufe-list .sp-active,
#dash-priority-list .dpr-card.sp-active,
#anrufe-list .dpr-card.sp-active{
  border-left:3px solid var(--blue) !important;
}''',
        '''#dash-priority-list .sp-active,
#dash-priority-list .dpr-card.sp-active{
  border-left:3px solid var(--blue) !important;
}''',
        'legacy secondary rail',
    ),
    (
        '''#dash-priority-list .dpr-card.sp-active,
#anrufe-list .dpr-card.sp-active,
#anrufe-split-left .dpr-card.sp-active,
#dash-priority-list .sp-active,
#anrufe-list .sp-active{
  border-left:none !important;
  box-shadow:none !important;
}''',
        '''#dash-priority-list .dpr-card.sp-active,
#dash-priority-list .sp-active{
  border-left:none !important;
  box-shadow:none !important;
}''',
        'apple selection shell',
    ),
    (
        '''#dash-priority-list .dpr-card.sp-active .dpr-row,
#anrufe-list .dpr-card.sp-active .dpr-row,
#dash-priority-list .sp-active .dpr-row,
#anrufe-list .sp-active .dpr-row,
#dash-priority-list .dpr-card.sp-active .vx-heute-row,
#anrufe-list .dpr-card.sp-active .vx-heute-row,
#anrufe-list .dpr-card.sp-active .vx-anf-row,
#anrufe-list .sp-active .vx-heute-row,
#anrufe-list .sp-active .vx-anf-row,
.vx-anf-row.is-active{
  background:rgba(26,111,232,0.08) !important;
  border-left:none !important;
}''',
        '''#dash-priority-list .dpr-card.sp-active .dpr-row,
#dash-priority-list .sp-active .dpr-row,
#dash-priority-list .dpr-card.sp-active .vx-heute-row{
  background:rgba(26,111,232,0.08) !important;
  border-left:none !important;
}''',
        'apple selection fill',
    ),
    (
        '''#dash-priority-list .dpr-card.sp-active .dpr-row:hover,
#anrufe-list .dpr-card.sp-active .dpr-row:hover,
#dash-priority-list .dpr-card.sp-active .vx-heute-row:hover,
#anrufe-list .dpr-card.sp-active .vx-heute-row:hover,
#anrufe-list .dpr-card.sp-active .vx-anf-row:hover{
  background:rgba(26,111,232,0.12) !important;
}''',
        '''#dash-priority-list .dpr-card.sp-active .dpr-row:hover,
#dash-priority-list .dpr-card.sp-active .vx-heute-row:hover{
  background:rgba(26,111,232,0.12) !important;
}''',
        'apple selection hover',
    ),
]

for old, new, label in legacy_blocks:
    index = replace_once(index, old, new, label)

rules = [
    (
        'body.vx-customer-design-foundation .vx-requests-layout{display:grid;grid-template-columns:minmax(360px,0.92fr) minmax(0,1.08fr);align-items:stretch;gap:16px;min-width:0;min-height:560px;}',
        'body.vx-customer-design-foundation #tab-anrufe{background:var(--vx-canvas);}\nbody.vx-customer-design-foundation .vx-requests-layout{display:grid;grid-template-columns:minmax(360px,0.92fr) minmax(0,1.08fr);align-items:stretch;gap:16px;min-width:0;min-height:560px;background:transparent;}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-panel,body.vx-customer-design-foundation .vx-requests-detail-panel{min-width:0;padding:0;overflow:hidden;}',
        'body.vx-customer-design-foundation .vx-requests-panel,body.vx-customer-design-foundation .vx-requests-detail-panel{min-width:0;padding:0;overflow:hidden;border:1px solid #dfe6ef;background:#f1f5f9;box-shadow:0 10px 28px rgba(15,35,71,.05);}',
    ),
    (
        'body.vx-customer-design-foundation #tab-anrufe .vx-ap-filter.vx-chip.vx-chip--active{border-color:var(--vx-brand);background:var(--vx-brand);color:#ffffff;}',
        'body.vx-customer-design-foundation #tab-anrufe .vx-ap-filter.vx-chip.vx-chip--active{border-color:#b7cff5;background:#e4efff;color:var(--vx-brand-dark);box-shadow:inset 0 0 0 1px rgba(52,120,237,.08);}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-search-box{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;box-sizing:border-box;min-height:48px;padding:0 12px;border:1px solid var(--vx-line);border-radius:var(--vx-radius-control);background:#ffffff;}',
        'body.vx-customer-design-foundation .vx-requests-search-box{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;box-sizing:border-box;min-height:48px;padding:0 12px;border:1px solid #d5e2f5;border-radius:var(--vx-radius-control);background:#ffffff;box-shadow:0 1px 2px rgba(15,35,71,.035);}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-scroll{min-height:0;max-height:720px;overflow:auto;border-top:1px solid var(--vx-line);overscroll-behavior:contain;}',
        'body.vx-customer-design-foundation .vx-requests-scroll{min-height:0;max-height:720px;overflow:auto;border-top:1px solid #dfe6ef;background:#e9eef5;overscroll-behavior:contain;}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-list{gap:0;margin-top:0;}',
        'body.vx-customer-design-foundation .vx-requests-list{display:grid;gap:8px;margin:0;padding:10px;}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-date{display:flex;align-items:center;gap:7px;margin:0;padding:10px 16px;border-bottom:1px solid var(--vx-line);background:#f8fafc;font-weight:700;}',
        'body.vx-customer-design-foundation .vx-requests-date{display:flex;align-items:center;gap:7px;margin:4px 0 0;padding:8px 6px;border:0;background:transparent;color:var(--vx-muted);font-weight:700;}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-item{padding:0;border:0;border-bottom:1px solid var(--vx-line);border-radius:0;background:#ffffff;box-shadow:none;transition:background 120ms ease,box-shadow 120ms ease;}',
        'body.vx-customer-design-foundation .vx-requests-item{padding:0;border:1px solid #dfe6ef;border-radius:14px;background:#f8fafc;box-shadow:0 1px 2px rgba(15,35,71,.035);overflow:hidden;transition:background 120ms ease,border-color 120ms ease,box-shadow 120ms ease,transform 120ms ease;}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-item:last-child{border-bottom:0;}',
        'body.vx-customer-design-foundation .vx-requests-item:last-child{border-bottom:1px solid #dfe6ef;}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-item:hover,body.vx-customer-design-foundation .vx-requests-item.sp-active{background:#f5f8ff;}',
        'body.vx-customer-design-foundation .vx-requests-item:hover{border-color:#c7d9f4;background:#eef4ff;transform:translateY(-1px);}\nbody.vx-customer-design-foundation .vx-requests-item.sp-active{border-color:#a9c7f5;background:#e3edff;}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-item.sp-active{box-shadow:inset 3px 0 0 var(--vx-brand);}',
        'body.vx-customer-design-foundation .vx-requests-item.sp-active{box-shadow:0 8px 20px rgba(52,120,237,.11);}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-item.is-unread{background:#fbfdff;}',
        'body.vx-customer-design-foundation .vx-requests-item.is-unread{background:#f5f8ff;}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-detail-panel{display:flex;flex-direction:column;}',
        'body.vx-customer-design-foundation .vx-requests-detail-panel{display:flex;flex-direction:column;background:#eef2f7;}',
    ),
    (
        'body.vx-customer-design-foundation .vx-requests-detail{min-width:0;}',
        'body.vx-customer-design-foundation .vx-requests-detail{min-width:0;background:#f8fafc;}',
    ),
]

for number, (old, new) in enumerate(rules, 1):
    css = replace_once(css, old, new, f'canonical rule {number}')

required_index = [
    'id="anrufe-split" class="vx-requests-layout"',
    'id="anrufe-split-left" class="vx-ops-card vx-requests-panel"',
    'id="anrufe-split-right" class="vx-ops-card vx-requests-detail-panel"',
    "el.classList.add('vx-ops-list', 'vx-requests-list')",
    "el.classList.toggle('sp-active'",
]
missing = [token for token in required_index if token not in index]
if missing:
    raise SystemExit('request behavior contract missing: ' + ', '.join(missing))

style_text = '\n'.join(
    match.group(1)
    for match in re.finditer(r'<style\b[^>]*>(.*?)</style>', index, flags=re.I | re.S)
)
forbidden_styles = [
    start_marker,
    '#anrufe-split-left{',
    '#anrufe-list .sp-active .dpr-row,',
    '#anrufe-list .dpr-card.sp-active .dpr-row{',
    '#anrufe-list .dpr-card.sp-active .vx-anf-row',
    '#anrufe-list .sp-active .vx-anf-row',
    '#anrufe-split-left .dpr-card.sp-active',
    '#anrufe-list{\n  background:var(--surface)!important;',
]
remaining = [token for token in forbidden_styles if token in style_text]
if remaining:
    raise SystemExit('legacy requests presentation remains: ' + ', '.join(remaining))

required_css = [
    'body.vx-customer-design-foundation #tab-anrufe{background:var(--vx-canvas);}',
    'background:#e9eef5;',
    'background:#e4efff;color:var(--vx-brand-dark);',
    'background:#e3edff;',
    'border-radius:14px;',
    'box-shadow:0 8px 20px rgba(52,120,237,.11);',
]
missing_css = [token for token in required_css if token not in css]
if missing_css:
    raise SystemExit('premium request styles missing: ' + ', '.join(missing_css))
if '!important' in css:
    raise SystemExit('assistant owner contains important overrides')
if len(css.splitlines()) > 800:
    raise SystemExit(f'assistant owner size budget exceeded: {len(css.splitlines())}')

index_path.write_text(index, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
print('requests premium migration applied')
