import fs from 'node:fs';

function update(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`${path}: already updated`);
    return;
  }
  fs.writeFileSync(path, after);
  console.log(`${path}: updated`);
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`${label}: source token not found`);
  return source.replace(before, after);
}

update('scripts/verify-calendar-integrations.mjs', (input) => {
  let source = input;
  source = replaceRequired(source, "  'vx-cal-entry',", "  'vx-settings-entry vx-settings-entry--calendar',", 'calendar runtime class');
  source = replaceRequired(source, "  '.vx-cal-entry',", "  '.vx-settings-entry',", 'calendar CSS class');
  source = replaceRequired(source, "/shared/customer-runtime-calendar-settings.js?v=20260803-1", "/shared/customer-runtime-calendar-settings.js?v=20260803-2", 'calendar runtime cache');
  source = replaceRequired(source, "/shared/customer-settings-components.css?v=20260803-1", "/shared/customer-settings-components.css?v=20260803-2", 'settings CSS cache');
  return source;
});

update('scripts/verify-customer-navigation-unified.mjs', (input) => {
  let source = input;
  source = replaceRequired(source, 'customer-runtime-calendar-settings\\.js\\?v=20260803-1', 'customer-runtime-calendar-settings\\.js\\?v=20260803-2', 'navigation calendar cache');
  source = replaceRequired(source, 'customer-runtime-design-foundation\\.js\\?v=20260803-3', 'customer-runtime-design-foundation\\.js\\?v=20260803-4', 'navigation design cache');
  return source;
});

update('scripts/verify-customer-design-foundation.mjs', (input) => {
  let source = input;
  source = replaceRequired(
    source,
    "  loader: 'customer-dashboard/shared/offer-brand.js'\n};",
    "  loader: 'customer-dashboard/shared/offer-brand.js',\n  dashboard: 'customer-dashboard/index.html'\n};",
    'design verifier dashboard path'
  );
  source = replaceRequired(
    source,
    "const loader = fs.readFileSync(paths.loader, 'utf8');",
    "const loader = fs.readFileSync(paths.loader, 'utf8');\nconst dashboard = fs.readFileSync(paths.dashboard, 'utf8');",
    'design verifier dashboard source'
  );
  source = replaceRequired(
    source,
    "assert.ok(lineCount(settingsCss) <= 360, 'settings component CSS exceeded its initial size budget');",
    "assert.ok(lineCount(settingsCss) <= 740, 'settings component CSS exceeded its consolidated size budget');",
    'settings CSS budget'
  );
  source = replaceRequired(source, '/shared/customer-settings-components.css?v=20260803-1', '/shared/customer-settings-components.css?v=20260803-2', 'design settings CSS cache');
  source = replaceRequired(
    source,
`for (const token of [
  '.vx-cal-entry',
  '.vx-cal-entry-icon',
  '.vx-cal-page-header',
  '.vx-cal-back',
  '#vx-calendar-page-body',
  '.vx-cal-grid',
  '.vx-cal-card',
  '.vx-cal-provider',
  '.vx-cal-pill.ok',
  '.vx-cal-banner.ok',
  '.vx-cal-status.loading',
  '.vx-cal-form',
  '.vx-cal-checkbox',
  '.vx-cal-actions > .vx-cal-btn',
  '@media (max-width: 720px)',
  '@media (max-width: 390px)'
]) {
  assert.ok(settingsCss.includes(token), \`settings CSS missing calendar component: \${token}\`);
}`,
`for (const token of [
  '.vx-settings-list',
  '.vx-settings-entry',
  '.vx-settings-entry-icon',
  '.vx-settings-entry-title',
  '.vx-settings-entry-subtitle',
  '.vx-cal-page-header',
  '.vx-cal-back',
  '#vx-calendar-page-body',
  '.vx-cal-grid',
  '.vx-cal-card',
  '.vx-cal-provider',
  '.vx-cal-pill.ok',
  '.vx-cal-banner.ok',
  '.vx-cal-status.loading',
  '.vx-cal-form',
  '.vx-cal-checkbox',
  '.vx-cal-actions > .vx-cal-btn',
  '.vx-abo-hero',
  '.vx-settings-card',
  '.vx-abo-progress',
  '.vx-abo-contract-grid',
  '.vx-abo-addon-grid',
  '.vx-abo-btn.danger',
  '@media (max-width: 720px)',
  '@media (max-width: 390px)'
]) {
  assert.ok(settingsCss.includes(token), \`settings CSS missing canonical component: \${token}\`);
}`,
    'canonical settings CSS tokens'
  );
  source = replaceRequired(source, "  'vx-cal-entry',", "  'vx-settings-entry vx-settings-entry--calendar',", 'design calendar runtime class');
  source = replaceRequired(source, 'customer-runtime-calendar-settings\\.js\\?v=20260803-1', 'customer-runtime-calendar-settings\\.js\\?v=20260803-2', 'design calendar cache');
  source = replaceRequired(source, 'customer-runtime-design-foundation\\.js\\?v=20260803-3', 'customer-runtime-design-foundation\\.js\\?v=20260803-4', 'design loader cache');

  const insertionPoint = "for (const [name, css] of [";
  if (!source.includes("dashboard missing canonical settings markup")) {
    if (!source.includes(insertionPoint)) throw new Error('design verifier insertion point missing');
    const checks = `for (const token of [
  'class="vx-settings-list"',
  'class="vx-settings-entry"',
  'class="vx-abo-hero"',
  '<progress id="abo-minutes-bar"',
  'class="vx-abo-contract-grid"',
  'class="vx-abo-addon-grid"',
  "barEl.classList.toggle('warning'",
  "onclick=\"vxMehrShow('abonnement')\"",
  'onclick="vxAboUpgrade()"',
  'onclick="vxAboMinuten()"',
  'onclick="vxSubmitCancellationRequest()"'
]) {
  assert.ok(dashboard.includes(token), \`dashboard missing canonical settings markup: \${token}\`);
}

for (const forbidden of [
  '#mehr-main [onclick]',
  '.addon-grid{',
  '#abo-addons-list > div[style*="grid-template-columns:1fr 1fr"]',
  '<div id="mehr-main" style=',
  '<div id="abo-plan-name" style=',
  'barEl.style.width',
  'statusStyle ='
]) {
  assert.ok(!dashboard.includes(forbidden), \`dashboard still contains legacy settings presentation: \${forbidden}\`);
}

`;
    source = source.replace(insertionPoint, checks + insertionPoint);
  }
  return source;
});

for (const path of [
  'scripts/verify-calendar-integrations.mjs',
  'scripts/verify-customer-navigation-unified.mjs',
  'scripts/verify-customer-design-foundation.mjs'
]) {
  const source = fs.readFileSync(path, 'utf8');
  if (source.includes('20260803-1') && /calendar-settings|settings-components/.test(source)) {
    throw new Error(`${path}: stale calendar/settings cache token remains`);
  }
}

console.log('Settings and subscription verifiers migrated.');
