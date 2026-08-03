from pathlib import Path
import subprocess

CORE_COMMIT = 'fa137886a742f73c3b0e65084c4ae7bf3a2d290b'
CORE_PATH = 'scripts/tmp_apply_customer_feedback_round.py'
CALENDAR_PATH = Path('customer-dashboard/shared/customer-runtime-calendar-settings.js')

# Reuse the already verified feedback migration from the previous commit,
# then make the calendar page state explicit for repeated navigation.
core = subprocess.check_output(
    ['git', 'show', f'{CORE_COMMIT}:{CORE_PATH}'],
    text=True,
)
exec(compile(core, f'{CORE_COMMIT}:{CORE_PATH}', 'exec'), {'__name__': '__main__'})

source = CALENDAR_PATH.read_text(encoding='utf-8')
old = '''  function setCalendarPageOpen(isOpen) {
    const main = document.getElementById('mehr-main');
    const page = document.getElementById('mehr-sub-kalender');
    if (!main || !page) return false;
    if (isOpen) page.removeAttribute('style');
    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => {
      const active = isOpen && node === page;
      node.hidden = !active;
      node.style.display = active ? 'block' : 'none';
    });
    main.hidden = isOpen;
    main.style.display = isOpen ? 'none' : '';
    return true;
  }
'''
new = '''  function setCalendarPageOpen(isOpen) {
    const main = document.getElementById('mehr-main');
    const page = document.getElementById('mehr-sub-kalender');
    if (!main || !page) return false;

    document.querySelectorAll('#tab-mehr [id^="mehr-sub-"]').forEach((node) => {
      node.hidden = true;
      node.style.display = 'none';
    });

    if (isOpen) {
      page.removeAttribute('style');
      main.hidden = true;
      main.style.display = 'none';
      page.hidden = false;
      page.style.display = 'block';
    } else {
      page.hidden = true;
      page.style.display = 'none';
      main.hidden = false;
      main.style.display = '';
    }
    return true;
  }
'''

if old not in source:
    raise AssertionError('generated calendar visibility owner not found')
source = source.replace(old, new, 1)

for token in (
    "page.removeAttribute('style')",
    'main.hidden = true',
    'page.hidden = false',
    'main.hidden = false',
    'page.hidden = true',
):
    if token not in source:
        raise AssertionError(f'calendar visibility token missing: {token}')

CALENDAR_PATH.write_text(source, encoding='utf-8')
print('Customer feedback migration applied with explicit calendar visibility state.')
