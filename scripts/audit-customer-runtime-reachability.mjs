import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dashboardRoot = 'customer-dashboard';
const sharedRoot = path.join(dashboardRoot, 'shared');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

const sourceFiles = walk(dashboardRoot).filter((file) => /\.(?:html|js|mjs|toml)$/i.test(file));
const runtimeFiles = fs.readdirSync(sharedRoot)
  .filter((name) => /^customer-runtime-.+\.js$/i.test(name))
  .map((name) => path.join(sharedRoot, name))
  .sort();

const references = new Map();
for (const runtimeFile of runtimeFiles) {
  const basename = path.basename(runtimeFile);
  const referrers = sourceFiles.filter((candidate) => {
    if (candidate === runtimeFile) return false;
    return fs.readFileSync(candidate, 'utf8').includes(basename);
  });
  references.set(runtimeFile, referrers);
}

console.log('\nCustomer runtime reachability');
console.log('=============================');
for (const [runtimeFile, referrers] of references) {
  console.log(`${runtimeFile}: ${referrers.length} reference(s)`);
  referrers.forEach((file) => console.log(`  - ${file}`));
}

const orphaned = Array.from(references)
  .filter(([, referrers]) => referrers.length === 0)
  .map(([runtimeFile]) => runtimeFile);

assert.deepEqual(
  orphaned,
  [],
  `Unreferenced customer runtime files found:\n${orphaned.map((file) => `- ${file}`).join('\n')}`
);

const designRuntimes = [
  path.join(sharedRoot, 'customer-runtime-assistant-profile.js'),
  path.join(sharedRoot, 'customer-runtime-assistant-status.js'),
  path.join(sharedRoot, 'customer-runtime-case-intake.js'),
  path.join(sharedRoot, 'customer-runtime-design-foundation.js')
];

for (const file of designRuntimes) {
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(!source.includes("createElement('style')"), `${file} creates a style element`);
  assert.ok(!source.includes('style.textContent'), `${file} injects CSS through JavaScript`);
}

console.log(`\nRuntime audit passed: ${runtimeFiles.length} runtime files are referenced.`);
