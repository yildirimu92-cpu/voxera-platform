from pathlib import Path

path = Path('customer-dashboard/shared/customer-runtime-unified-navigation.js')
source = path.read_text(encoding='utf-8')

function_block = '''
  // Delete stale archive root buttons that may survive in cached or injected legacy markup.
  function hideArchiveRootNavigation() {
    [
      document.getElementById('nav-archiv'),
      document.getElementById('mnav-archiv')
    ].filter(Boolean).forEach((node) => node.remove());
  }
'''

anchor = '''  function normalizeRootNavigation() {
    ROOT_NAV.forEach((item) => {
'''
replacement = '''  function normalizeRootNavigation() {
    hideArchiveRootNavigation();
    ROOT_NAV.forEach((item) => {
'''

if 'function hideArchiveRootNavigation()' not in source:
    if source.count(anchor) != 1:
        raise AssertionError('normalizeRootNavigation anchor missing or duplicated')
    source = source.replace(anchor, function_block + '\n' + replacement, 1)
elif '    hideArchiveRootNavigation();\n    ROOT_NAV.forEach' not in source:
    if source.count(anchor) != 1:
        raise AssertionError('normalizeRootNavigation anchor missing or duplicated')
    source = source.replace(anchor, replacement, 1)

assert 'function hideArchiveRootNavigation()' in source
assert "document.getElementById('nav-archiv')" in source
assert "document.getElementById('mnav-archiv')" in source
assert '.forEach((node) => node.remove())' in source
assert '    hideArchiveRootNavigation();\n    ROOT_NAV.forEach' in source
assert "node.dataset.vxHiddenRootNav = 'archive'" not in source

path.write_text(source, encoding='utf-8')
print('Navigation compatibility cleanup added without restoring legacy roots.')
