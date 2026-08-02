import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  navigation: 'customer-dashboard/shared/customer-runtime-unified-navigation.js',
  loader: 'customer-dashboard/shared/offer-brand.js',
  assistant: 'customer-dashboard/shared/customer-runtime-assistant-profile.js',
  status: 'customer-dashboard/shared/customer-runtime-assistant-status.js',
  menu: 'customer-dashboard/shared/customer-runtime-assistant-business-menu.js',
  operational: 'customer-dashboard/shared/customer-runtime-operational-updates.js'
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);

for (const [key, path] of Object.entries(files)) {
  new vm.Script(source[key], { filename: path });
}

for (const token of [
  "desktop: 'nav-dashboard'",
  "mobile: 'mnav-dashboard'",
  "desktop: 'nav-anrufe'",
  "mobile: 'mnav-anrufe'",
  "desktop: 'nav-assistent'",
  "mobile: 'mnav-assistent'",
  "desktop: 'nav-auswertung'",
  "mobile: 'mnav-auswertung'",
  "desktop: 'nav-mehr'",
  "mobile: 'mnav-mehr'",
  "label: 'Assistent'",
  "label: 'Einstellungen'",
  '#nav-assistent.nav-item,#mnav-assistent.mobile-nav-btn{display:flex!important}',
  'dedupeAndOrderMobileNavigation',
  'vxDuplicateRootNav',
  "document.getElementById('tab-assistent')",
  "document.getElementById('mehr-sub-assistant-profile')",
  "document.getElementById('mehr-sub-betriebsinfos')",
  "document.getElementById('vx-assistant-profile-entry')?.remove()",
  "document.getElementById('vx-operational-entry')?.remove()",
  "section.textContent = 'Geschäft'",
  'vx-assistant-root-switch',
  'Aktuelle Infos',
  'vxOperationalUpdatesOpen',
  'restoreSettingsRoot',
  'Zum Assistent-Bereich',
  'Andere Stimme wählen',
  'weitere Fähigkeiten anzeigen',
  'Technische Details',
  'MutationObserver',
  '/\\/activate(?:\\.html)?$/'
]) {
  assert.ok(source.navigation.includes(token), `navigation missing: ${token}`);
}

assert.match(source.navigation, /ROOT_NAV\.forEach\(\(item\) => \{[\s\S]*container\.appendChild\(node\)/);
assert.match(source.navigation, /assistantTab\.appendChild\(operationalPage\)/);
assert.match(source.navigation, /showAssistantView\('profile', false\)/);
assert.match(source.loader, /customer-runtime-unified-navigation\.js\?v=20260802-2/);
assert.match(source.assistant, /mehr-sub-assistant-profile/);
assert.match(source.assistant, /vx-assistant-profile-entry/);
assert.match(source.status, /vx-assistant-status-extension/);
assert.match(source.menu, /vx-assistant-business-section/);
assert.match(source.operational, /mehr-sub-betriebsinfos/);
assert.match(source.operational, /root\.vxOperationalUpdatesOpen=open/);

assert.doesNotMatch(source.navigation, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source.navigation, /ELEVENLABS_API_KEY/);
assert.doesNotMatch(source.navigation, /ai_instructions/);
assert.doesNotMatch(source.navigation, /innerHTML\s*=\s*document\.documentElement/);
assert.doesNotMatch(source.navigation, /localStorage/);

console.log('Unified customer dashboard navigation verification passed.');
