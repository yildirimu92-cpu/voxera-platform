from pathlib import Path
import re

INDEX_PATH = Path('customer-dashboard/index.html')
CSS_PATH = Path('customer-dashboard/shared/customer-assistant-components.css')

html = INDEX_PATH.read_text(encoding='utf-8')
css = CSS_PATH.read_text(encoding='utf-8')

notice = '''
                <div class="vx-archive-retention" role="note">
                  Aufbewahrung: vollständige Transkripte werden nach <strong>90 Tagen</strong> entfernt, Archiveinträge nach <strong>180 Tagen</strong>.
                </div>'''

if 'class="vx-archive-retention"' not in html:
    pattern = re.compile(
        r'(<button class="vx-ap-filter vx-chip" data-filter="archiv"[^>]*>Archiv</button>\s*</div>)',
        re.S,
    )
    html, count = pattern.subn(r'\1' + notice, html, count=1)
    if count != 1:
        raise AssertionError(f'archive filter anchor expected once, found {count}')

styles = '''

.vx-archive-retention{
  display:none;
  margin:0;
  padding:0 2px;
  color:var(--vx-muted);
  font-size:12px;
  line-height:1.45;
}
.vx-requests-filters:has([data-filter="archiv"].vx-chip--active) + .vx-archive-retention,
.vx-requests-filters:has([data-filter="archiv"].active) + .vx-archive-retention,
.vx-requests-filters:has([data-filter="archiv"][aria-selected="true"]) + .vx-archive-retention{
  display:block;
}
'''
if '\n.vx-archive-retention{\n' not in css:
    css = css.rstrip() + styles

assert html.count('class="vx-archive-retention"') == 1
assert 'vollständige Transkripte werden nach <strong>90 Tagen</strong>' in html
assert 'Archiveinträge nach <strong>180 Tagen</strong>' in html
assert css.count('\n.vx-archive-retention{\n') == 1
assert ':has([data-filter="archiv"].vx-chip--active)' in css

INDEX_PATH.write_text(html, encoding='utf-8')
CSS_PATH.write_text(css, encoding='utf-8')
print('Integrated archive retention notice added and verified.')
