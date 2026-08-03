import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'customer-dashboard/index.html';
const source = fs.readFileSync(path, 'utf8');
const oldScopedSelector = '#anrufe-split-left .vx-split-filters';
const newScopedSelector = '#anrufe-split-left .vx-requests-filters';
const oldClosest = ".closest('.vx-split-filters')";
const newClosest = ".closest('.vx-requests-filters')";

const scriptPattern = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
let selectorCount = 0;
let closestCount = 0;
let scriptBlocks = 0;

const updated = source.replace(scriptPattern, (block) => {
  scriptBlocks += 1;
  selectorCount += block.split(oldScopedSelector).length - 1;
  closestCount += block.split(oldClosest).length - 1;
  return block
    .split(oldScopedSelector).join(newScopedSelector)
    .split(oldClosest).join(newClosest);
});

assert.ok(scriptBlocks > 0, 'no script blocks found');
assert.equal(selectorCount, 6, `expected 6 obsolete requests selectors in JavaScript, found ${selectorCount}`);
assert.equal(closestCount, 1, `expected one obsolete closest() selector, found ${closestCount}`);
assert.notEqual(updated, source, 'filter state migration produced no change');

const updatedScriptBlocks = updated.match(scriptPattern) || [];
const updatedScripts = updatedScriptBlocks.join('\n');
assert.equal(updatedScripts.includes(oldScopedSelector), false, 'obsolete requests selector remains in JavaScript');
assert.equal(updatedScripts.includes(oldClosest), false, 'obsolete closest selector remains in JavaScript');
assert.equal(
  updatedScripts.split(newScopedSelector).length - 1,
  6,
  'canonical requests selector count mismatch in JavaScript'
);
assert.equal(
  updatedScripts.split(newClosest).length - 1,
  1,
  'canonical closest selector count mismatch in JavaScript'
);

const hostStart = updated.indexOf('<!-- ANFRAGEN TAB -->');
const hostEnd = updated.indexOf('<!-- AUSWERTUNG TAB -->', hostStart);
assert.ok(hostStart >= 0 && hostEnd > hostStart, 'requests host bounds missing');
const host = updated.slice(hostStart, hostEnd);
const mainFilterButtons = host.match(/<button[^>]+data-filter="(?:offen|geplant|abgeschlossen)"[^>]*>/g) || [];
assert.equal(mainFilterButtons.length, 3, 'requests main filter button count mismatch');
assert.equal(
  mainFilterButtons.filter((button) => button.includes('vx-chip--active')).length,
  1,
  'exactly one requests main filter must be active in initial markup'
);

fs.writeFileSync(path, updated, 'utf8');
console.log('Requests filter state migration passed.');
console.log(`Updated ${selectorCount} scoped selectors and ${closestCount} closest() selector.`);
