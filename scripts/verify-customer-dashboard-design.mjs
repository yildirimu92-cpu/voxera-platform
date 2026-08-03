import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  runtime: 'customer-dashboard/shared/customer-runtime-design-foundation.js',
  dashboardCss: 'customer-dashboard/shared/customer-dashboard-components.css',
  dashboard: 'customer-dashboard/index.html'
};

const runtime = fs.readFileSync(paths.runtime, 'utf8');
const dashboardCss = fs.readFileSync(paths.dashboardCss, 'utf8');
const dashboard = fs.readFileSync(paths.dashboard, 'utf8');

new vm.Script(runtime, { filename: paths.runtime });

const lineCount = (value) => value.split(/\r?\n/).length;
assert.ok(lineCount(runtime) <= 55, `design runtime is too large: ${lineCount(runtime)} lines`);
assert.ok(lineCount(dashboardCss) <= 450, `dashboard CSS is too large: ${lineCount(dashboardCss)} lines`);

for (const token of [
  '/shared/customer-dashboard-components.css?v=20260803-1',
  "document.getElementById('tab-dashboard')",
  "page.dataset.customerSurface = 'dashboard'",
  "node.dataset.customerTitle = 'dashboard'",
  "node.dataset.customerCard = 'dashboard'",
  "node.dataset.customerAction = 'dashboard'"
]) {
  assert.ok(runtime.includes(token), `dashboard design runtime missing: ${token}`);
}

for (const token of [
  '#tab-dashboard[data-customer-surface="dashboard"]',
  '.dash-status-hero',
  '.dash-kpi-row',
  '.dash-kpi',
  '.dash-focus-card',
  '.dash-grid',
  '.dash-glass',
  '.vx-jetzt-section',
  '.vx-activity-note',
  '@media (max-width: 980px)',
  '@media (max-width: 720px)',
  '@media (max-width: 390px)',
  'prefers-reduced-motion'
]) {
  assert.ok(dashboardCss.includes(token), `dashboard CSS missing canonical selector: ${token}`);
}

for (const token of [
  'id="tab-dashboard"',
  'class="dash-status-hero"',
  'class="dash-kpi-row"',
  'class="dash-kpi"',
  'class="dash-focus-card"',
  'class="dash-grid"',
  'class="dash-glass"',
  'class="vx-jetzt-section'
]) {
  assert.ok(dashboard.includes(token), `dashboard markup hook missing: ${token}`);
}

for (const forbidden of [
  '!important',
  '<style',
  'createElement(\'style\')',
  'style.textContent',
  'localStorage',
  'sessionStorage',
  'fetch(',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ELEVENLABS_API_KEY'
]) {
  assert.ok(!dashboardCss.includes(forbidden), `dashboard CSS contains forbidden token: ${forbidden}`);
}

console.log('Customer dashboard canonical design verification passed.');
