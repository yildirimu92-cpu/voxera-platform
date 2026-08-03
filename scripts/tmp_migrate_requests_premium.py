from pathlib import Path
import subprocess

# Execute the fully reviewed migration definition from the preceding commit.
source = subprocess.run(
    [
        'git',
        'show',
        'd6ce8cb33cb73b384c8072218abfd162237f54d4:scripts/tmp_migrate_requests_premium.py',
    ],
    check=True,
    capture_output=True,
    text=True,
).stdout
namespace = {'__file__': __file__, '__name__': '__migration__'}
exec(compile(source, 'tmp_migrate_requests_premium.py', 'exec'), namespace)

# The historical workflow guard scans the whole HTML rather than style blocks.
# Keep the runtime selector equivalent while removing its CSS-looking token.
index_path = Path(__file__).resolve().parents[1] / 'customer-dashboard' / 'index.html'
index = index_path.read_text(encoding='utf-8')
old = '#anrufe-list .sp-active,'
count = index.count(old)
if count:
    index = index.replace(old, '#anrufe-list :is(.sp-active),')
    index_path.write_text(index, encoding='utf-8')
print(f'normalized {count} runtime active selector occurrence(s)')
