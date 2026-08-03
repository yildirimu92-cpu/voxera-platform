from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'customer-dashboard/index.html'
lines = path.read_text(encoding='utf-8').splitlines()
tokens = [
    '#anrufe-list .sp-active .dpr-row,',
    '#anrufe-list .dpr-card.sp-active .dpr-row{',
]
for token in tokens:
    hits = [i for i, line in enumerate(lines) if token in line]
    print(f'## {token} hits={len(hits)}')
    for i in hits:
        lo = max(0, i - 12)
        hi = min(len(lines), i + 18)
        print(f'-- lines {lo + 1}-{hi} --')
        for n in range(lo, hi):
            print(f'{n + 1}: {lines[n]}')
raise SystemExit('inspection complete')
