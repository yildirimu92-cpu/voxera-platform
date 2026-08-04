from pathlib import Path
import re
import subprocess

root = Path('.')
index_path = root / 'customer-dashboard/index.html'
source = index_path.read_text(encoding='utf-8')
source = source.replace(
    '<div id="anrufe-split" class="vx-requests-layout">',
    '<div id="anrufe-split" class="vx-split vx-requests-layout">',
    1,
)
source = source.replace(
    'var DEFAULT_W = 440, MIN_W = 390, MAX_RATIO = 0.6;',
    'var DEFAULT_W = 380, MIN_W = 320, MAX_RATIO = 0.6;',
    1,
)
source = re.sub(r'--vx-split-left-w,\s*440px', '--vx-split-left-w, 380px', source)
source = re.sub(r'--vx-anfragen-left-width,\s*440px', '--vx-anfragen-left-width, 380px', source)
source = re.sub(r'^.*customer-runtime-requests-layout-owner\.js.*\n?', '', source, flags=re.M)
source = re.sub(r'^.*customer-requests-layout\.css.*\n?', '', source, flags=re.M)
index_path.write_text(source, encoding='utf-8')

for path in [
    root / 'customer-dashboard/shared/customer-runtime-requests-layout-owner.js',
    root / 'customer-dashboard/shared/customer-requests-layout.css',
]:
    if path.exists():
        path.unlink()

(root / '.github/workflows/verify-customer-design-foundation.yml').write_text("""name: Verify Customer Design Foundation

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
Path(__file__).unlink()

subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
subprocess.run(['git', 'add', '-A'], check=True)
subprocess.run(['git', 'commit', '-m', 'fix(customer): restore requests desktop split pane'], check=True)
subprocess.run(['git', 'push', 'origin', 'HEAD:codex/customer-settings-commercial-flows'], check=True)
