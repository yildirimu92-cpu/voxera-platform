from pathlib import Path
import re

root = Path('.')
index_path = root / 'customer-dashboard/index.html'
source = index_path.read_text(encoding='utf-8')

old_parent = '<div id="anrufe-split" class="vx-requests-layout">'
new_parent = '<div id="anrufe-split" class="vx-split vx-requests-layout">'
if old_parent in source:
    source = source.replace(old_parent, new_parent, 1)
elif new_parent not in source:
    raise SystemExit('unexpected #anrufe-split parent markup')

old_resizer = 'var DEFAULT_W = 440, MIN_W = 390, MAX_RATIO = 0.6;'
new_resizer = 'var DEFAULT_W = 380, MIN_W = 320, MAX_RATIO = 0.6;'
if old_resizer in source:
    source = source.replace(old_resizer, new_resizer, 1)
elif new_resizer not in source:
    raise SystemExit('unexpected requests resizer constants')

source = re.sub(r'--vx-split-left-w,\s*440px', '--vx-split-left-w, 380px', source)
source = re.sub(r'--vx-anfragen-left-width,\s*440px', '--vx-anfragen-left-width, 380px', source)
source = re.sub(r'^.*customer-runtime-requests-layout-owner\.js.*\n?', '', source, flags=re.M)
source = re.sub(r'^.*customer-requests-layout\.css.*\n?', '', source, flags=re.M)

ids = ['anrufe-split-left', 'anrufe-split-resizer', 'anrufe-split-right']
for element_id in ids:
    count = len(re.findall(r'\bid=["\']' + re.escape(element_id) + r'["\']', source))
    if count != 1:
        raise SystemExit(f'expected exactly one #{element_id}, found {count}')

parent_start = source.index(new_parent)
parent_end = source.index('<!-- AUSWERTUNG TAB -->', parent_start)
fragment = source[parent_start:parent_end]
positions = [fragment.index(f'id="{element_id}"') for element_id in ids]
if positions != sorted(positions):
    raise SystemExit('split children are not ordered left/resizer/right')
if 'id="requests-detail-v2"' not in fragment:
    raise SystemExit('permanent detail host is outside split parent')
if 'vx_split_w' not in source:
    raise SystemExit('existing split width persistence missing')
if "getElementById('anrufe-split-resizer')" not in source:
    raise SystemExit('existing resizer owner missing')

index_path.write_text(source, encoding='utf-8')

design_path = root / 'customer-dashboard/shared/customer-runtime-design-foundation.js'
design = design_path.read_text(encoding='utf-8')
design = re.sub(r'^.*customer-requests-layout\.css.*\n?', '', design, flags=re.M)
design_path.write_text(design, encoding='utf-8')

for path in [
    root / 'customer-dashboard/shared/customer-runtime-requests-layout-owner.js',
    root / 'customer-dashboard/shared/customer-requests-layout.css',
]:
    if path.exists():
        path.unlink()

print('minimal requests split source repair completed')
