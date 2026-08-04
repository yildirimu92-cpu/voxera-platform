from pathlib import Path
import re

root = Path('.')
index_path = root / 'customer-dashboard/index.html'
source = index_path.read_text(encoding='utf-8')


def div_range_by_id(text, element_id):
    start_match = re.search(
        r'<div\b[^>]*\bid=["\']' + re.escape(element_id) + r'["\'][^>]*>',
        text,
        flags=re.I,
    )
    if not start_match:
        raise SystemExit(f'missing div #{element_id}')
    token_re = re.compile(r'<div\b[^>]*>|</div\s*>', re.I)
    depth = 0
    for token in token_re.finditer(text, start_match.start()):
        if token.group(0).lower().startswith('</div'):
            depth -= 1
            if depth == 0:
                return start_match.start(), token.end()
        else:
            depth += 1
    raise SystemExit(f'unclosed div #{element_id}')


def containing_split_range(text, marker_pos):
    token_re = re.compile(r'<div\b[^>]*>|</div\s*>', re.I)
    stack = []
    for token in token_re.finditer(text):
        if token.start() >= marker_pos:
            break
        raw = token.group(0)
        if raw.lower().startswith('</div'):
            if stack:
                stack.pop()
        else:
            stack.append((token.start(), token.end(), raw))
    for open_start, open_end, raw in reversed(stack):
        if re.search(r'\bclass=["\'][^"\']*\bvx-split\b', raw, re.I) or re.search(r'\bid=["\']anrufe-split["\']', raw, re.I):
            depth = 0
            for token in token_re.finditer(text, open_start):
                if token.group(0).lower().startswith('</div'):
                    depth -= 1
                    if depth == 0:
                        return open_start, open_end, token.start(), token.end()
                else:
                    depth += 1
    raise SystemExit('missing source-owned .vx-split ancestor')


ids = ['anrufe-split-left', 'anrufe-split-resizer', 'anrufe-split-right']
ranges = {element_id: div_range_by_id(source, element_id) for element_id in ids}
snippets = {element_id: source[a:b] for element_id, (a, b) in ranges.items()}

markers = {
    'anrufe-split-left': '__VX_REQUESTS_LEFT__',
    'anrufe-split-resizer': '__VX_REQUESTS_RESIZER__',
    'anrufe-split-right': '__VX_REQUESTS_RIGHT__',
}
marked = source
for element_id, (start, end) in sorted(ranges.items(), key=lambda item: item[1][0], reverse=True):
    marked = marked[:start] + markers[element_id] + marked[end:]

left_marker_pos = marked.find(markers['anrufe-split-left'])
if left_marker_pos < 0:
    raise SystemExit('left marker placement failed')
split_start, split_open_end, _, split_end = containing_split_range(marked, left_marker_pos)
split_open = marked[split_start:split_open_end]
replacement = (
    split_open + '\n'
    + snippets['anrufe-split-left'] + '\n'
    + snippets['anrufe-split-resizer'] + '\n'
    + snippets['anrufe-split-right'] + '\n'
    + '</div>'
)
marked = marked[:split_start] + replacement + marked[split_end:]
for marker in markers.values():
    marked = marked.replace(marker, '')
source = marked

# Reuse the existing resize implementation and persistence owner.
source = re.sub(
    r'var\s+DEFAULT_W\s*=\s*\d+\s*,\s*MIN_W\s*=\s*\d+\s*,\s*MAX_RATIO\s*=\s*0?\.\d+\s*;',
    'var DEFAULT_W = 380, MIN_W = 320, MAX_RATIO = 0.6;',
    source,
    count=1,
)
source = source.replace(
    'var MIN_W = 220, MAX_RATIO = 0.6;',
    'var DEFAULT_W = 380, MIN_W = 320, MAX_RATIO = 0.6;',
    1,
)
source = re.sub(r'--vx-split-left-w,\s*(?:440|300)px', '--vx-split-left-w, 380px', source)
source = re.sub(r'--vx-anfragen-left-width,\s*(?:440|360)px', '--vx-anfragen-left-width, 380px', source)

# Remove orphan loading indicators only from the source-owned right pane.
right_start, right_end = div_range_by_id(source, 'anrufe-split-right')
right = source[right_start:right_end]
for pattern in [
    r'<div\b[^>]*(?:class=["\'][^"\']*(?:loader|loading|spinner)[^"\']*["\']|data-vx-loader\b|aria-busy=["\']true["\'])[^>]*>\s*</div>',
    r'<span\b[^>]*(?:class=["\'][^"\']*(?:loader|loading|spinner)[^"\']*["\']|data-vx-loader\b|aria-busy=["\']true["\'])[^>]*>\s*</span>',
]:
    right = re.sub(pattern, '', right, flags=re.I | re.S)
source = source[:right_start] + right + source[right_end:]

# Remove failed parallel workaround references.
source = re.sub(r'^.*customer-runtime-requests-layout-owner\.js.*\n?', '', source, flags=re.M)
source = re.sub(r'^.*customer-requests-layout\.css.*\n?', '', source, flags=re.M)

for element_id in ids:
    count = len(re.findall(r'\bid=["\']' + re.escape(element_id) + r'["\']', source))
    if count != 1:
        raise SystemExit(f'expected exactly one #{element_id}, found {count}')
if 'vx_split_w' not in source:
    raise SystemExit('existing vx_split_w persistence owner missing')
if "getElementById('anrufe-split-resizer')" not in source and 'getElementById("anrufe-split-resizer")' not in source:
    raise SystemExit('existing resizer owner missing')

left_start, _ = div_range_by_id(source, 'anrufe-split-left')
split_start, _, _, split_end = containing_split_range(source, left_start)
split_fragment = source[split_start:split_end]
for element_id in ids:
    if f'id="{element_id}"' not in split_fragment and f"id='{element_id}'" not in split_fragment:
        raise SystemExit('list, resizer and detail are not in the same source parent')

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

print('guarded requests split source repair completed')
