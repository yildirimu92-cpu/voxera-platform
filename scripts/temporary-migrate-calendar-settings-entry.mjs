import fs from 'node:fs';

const path = 'customer-dashboard/shared/customer-runtime-calendar-settings.js';
let source = fs.readFileSync(path, 'utf8');

const replacements = [
  ["entry.className = 'vx-cal-entry';", "entry.className = 'vx-settings-entry vx-settings-entry--calendar';"],
  ['<span class="vx-cal-entry-icon">', '<span class="vx-settings-entry-icon">'],
  ['<span class="vx-cal-entry-copy">', '<span class="vx-settings-entry-copy">'],
  ['<span class="vx-cal-entry-title">', '<span class="vx-settings-entry-title">'],
  ['class="vx-cal-entry-subtitle"', 'class="vx-settings-entry-subtitle"'],
  ['class="ph-bold ph-caret-right vx-cal-entry-caret"', 'class="ph-bold ph-caret-right vx-settings-entry-caret"']
];

let changed = false;
for (const [before, after] of replacements) {
  if (source.includes(before)) {
    source = source.replace(before, after);
    changed = true;
  }
}

for (const forbidden of ['vx-cal-entry', 'vx-cal-entry-icon', 'vx-cal-entry-copy', 'vx-cal-entry-title', 'vx-cal-entry-subtitle', 'vx-cal-entry-caret']) {
  if (source.includes(forbidden)) throw new Error(`calendar runtime still contains legacy settings entry class: ${forbidden}`);
}

for (const required of ['vx-settings-entry vx-settings-entry--calendar', 'vx-settings-entry-icon', 'vx-settings-entry-copy', 'vx-settings-entry-title', 'vx-settings-entry-subtitle', 'vx-settings-entry-caret']) {
  if (!source.includes(required)) throw new Error(`calendar runtime missing canonical settings entry class: ${required}`);
}

if (changed) fs.writeFileSync(path, source);
console.log(changed ? 'Calendar settings entry migrated.' : 'Calendar settings entry already migrated.');
