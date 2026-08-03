from pathlib import Path
import re

INDEX_PATH = Path('customer-dashboard/index.html')
html = INDEX_PATH.read_text(encoding='utf-8')

notice = '''
                <div class="vx-ap-meta vx-archive-retention" role="note">
                  Aufbewahrung: vollständige Transkripte werden nach <strong>90 Tagen</strong> entfernt, Archiveinträge nach <strong>180 Tagen</strong>.
                </div>'''

if 'class="vx-ap-meta vx-archive-retention"' not in html:
    pattern = re.compile(
        r'(<button class="vx-ap-filter vx-chip" data-filter="archiv"[^>]*>Archiv</button>\s*</div>)',
        re.S,
    )
    html, count = pattern.subn(r'\1' + notice, html, count=1)
    if count != 1:
        raise AssertionError(f'archive filter anchor expected once, found {count}')

assert html.count('class="vx-ap-meta vx-archive-retention"') == 1
assert 'vollständige Transkripte werden nach <strong>90 Tagen</strong>' in html
assert 'Archiveinträge nach <strong>180 Tagen</strong>' in html

INDEX_PATH.write_text(html, encoding='utf-8')
print('Integrated archive retention notice added with an existing text component.')
