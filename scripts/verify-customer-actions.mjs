import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const manifestPath = 'customer-dashboard/customer-action-contracts.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

assert.equal(manifest.version, 1, 'unsupported customer action contract version');
assert.ok(Array.isArray(manifest.actions), 'action contracts must contain an actions array');
assert.ok(manifest.actions.length >= 25, 'customer action audit covers too few actions');

const ids = new Set();
const sources = new Map();
const areas = new Map();

function sourceFor(path) {
  if (!sources.has(path)) {
    assert.ok(fs.existsSync(path), `action source does not exist: ${path}`);
    const source = fs.readFileSync(path, 'utf8');
    if (path.endsWith('.js')) new vm.Script(source, { filename: path });
    sources.set(path, source);
  }
  return sources.get(path);
}

for (const action of manifest.actions) {
  assert.ok(action && typeof action === 'object', 'invalid action contract');
  assert.match(action.id || '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `invalid action id: ${action.id}`);
  assert.ok(!ids.has(action.id), `duplicate action id: ${action.id}`);
  ids.add(action.id);

  assert.ok(action.area, `action ${action.id} has no area`);
  assert.ok(action.source, `action ${action.id} has no source`);
  assert.ok(['click', 'change', 'input'].includes(action.event), `action ${action.id} has unsupported event`);
  assert.ok(Array.isArray(action.triggerTokens) && action.triggerTokens.length, `action ${action.id} has no trigger tokens`);
  assert.ok(Array.isArray(action.handlerTokens) && action.handlerTokens.length, `action ${action.id} has no handler tokens`);

  const source = sourceFor(action.source);
  for (const token of action.triggerTokens) {
    assert.ok(source.includes(token), `${action.id} trigger is missing: ${token}`);
  }
  for (const token of action.handlerTokens) {
    assert.ok(source.includes(token), `${action.id} handler is missing: ${token}`);
  }

  if (action.destructive) {
    assert.ok(
      Array.isArray(action.confirmationTokens) && action.confirmationTokens.length >= 2,
      `destructive action ${action.id} has no confirmation contract`
    );
    for (const token of action.confirmationTokens) {
      assert.ok(source.includes(token), `${action.id} confirmation is missing: ${token}`);
    }
  } else {
    assert.ok(!action.confirmationTokens, `non-destructive action ${action.id} declares confirmation tokens`);
  }

  areas.set(action.area, (areas.get(action.area) || 0) + 1);
}

for (const requiredArea of ['navigation', 'assistant', 'calendar', 'current-info', 'support', 'requests']) {
  assert.ok(areas.has(requiredArea), `action audit is missing area: ${requiredArea}`);
}

// Generated buttons in the audited runtimes must not default to form submission.
for (const [path, source] of sources) {
  const buttonTags = source.match(/<button\b[^>]*>/gi) || [];
  for (const tag of buttonTags) {
    assert.match(tag, /\btype=(?:\\?["'])button(?:\\?["'])/i, `${path} contains a button without type="button": ${tag}`);
  }
}

// Cross-page actions must use the canonical assistant router. A temporary
// legacy fallback may remain inside the source module, but the capture-phase
// router must prevent it from becoming the visible navigation result.
const navigation = sourceFor('customer-dashboard/shared/customer-runtime-unified-navigation.js');
assert.match(
  navigation,
  /document\.addEventListener\('click',[\s\S]*businessProfileShortcut[\s\S]*preventDefault\(\)[\s\S]*stopPropagation\(\)[\s\S]*showAssistantView\('business', false\)[\s\S]*true\)/,
  'business profile shortcut is not intercepted by the canonical assistant router'
);

const assistant = sourceFor('customer-dashboard/shared/customer-runtime-assistant-profile.js');
assert.match(assistant, /id=\"vx-open-business-profile\"/);

const calendar = sourceFor('customer-dashboard/shared/customer-runtime-calendar-settings.js');
assert.match(calendar, /async function disconnect[\s\S]*root\.confirm[\s\S]*action: 'disconnect'/);

const operational = sourceFor('customer-dashboard/shared/customer-runtime-operational-updates.js');
assert.match(operational, /async function cancel[\s\S]*root\.confirm[\s\S]*action:'cancel'/);

console.log('\nCustomer dashboard action contracts');
console.log('===================================');
for (const [area, count] of [...areas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`${area}: ${count} action(s)`);
}
console.log(`\nAction audit passed: ${manifest.actions.length} customer actions are contracted.`);
