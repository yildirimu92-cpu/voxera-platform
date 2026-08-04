from pathlib import Path
import re
import subprocess

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
design = re.sub(r'\n\s*const scripts = \[\s*["\'][^"\']*customer-runtime-requests-layout-owner\.js[^"\']*["\']\s*\];\s*', '\n', design, flags=re.S)
design = re.sub(r'\n\s*scripts\.forEach\(\(src\) => \{.*?\n\s*\}\);\s*', '\n', design, flags=re.S)
design_path.write_text(design, encoding='utf-8')

for path in [
    root / 'customer-dashboard/shared/customer-runtime-requests-layout-owner.js',
    root / 'customer-dashboard/shared/customer-requests-layout.css',
]:
    if path.exists():
        path.unlink()

verify_path = root / '.github/workflows/verify-customer-design-foundation.yml'
verify_path.write_text("""name: Verify Customer Design Foundation

on:
  pull_request:
    paths:
      - 'customer-dashboard/**/*.css'
      - 'customer-dashboard/**/*.html'
      - 'customer-dashboard/shared/**/*.js'
      - 'scripts/verify-customer-design-foundation.mjs'
      - 'scripts/audit-customer-design-ownership.mjs'
      - '.github/workflows/verify-customer-design-foundation.yml'
  push:
    branches: [main]
    paths:
      - 'customer-dashboard/**/*.css'
      - 'customer-dashboard/**/*.html'
      - 'customer-dashboard/shared/**/*.js'
      - 'scripts/verify-customer-design-foundation.mjs'
      - 'scripts/audit-customer-design-ownership.mjs'
      - '.github/workflows/verify-customer-design-foundation.yml'

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node scripts/verify-customer-design-foundation.mjs
      - name: Inventory design ownership
        run: node scripts/audit-customer-design-ownership.mjs
""", encoding='utf-8')

for path in [
    root / '.github/workflows/tmp-fix-customer-requests-split.yml',
    root / 'scripts/tmp_fix_customer_requests_split.log',
]:
    if path.exists():
        path.unlink()

# Remove this script from the permanent branch before committing.
Path(__file__).unlink()

subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
subprocess.run(['git', 'add', '-A'], check=True)
subprocess.run(['git', 'commit', '-m', 'fix(customer): restore requests desktop split pane'], check=True)
subprocess.run(['git', 'push', 'origin', 'HEAD:codex/customer-settings-commercial-flows'], check=True)

print('requests split source repair committed and pushed')
