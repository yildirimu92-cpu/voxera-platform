import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  navigation: 'customer-dashboard/shared/customer-runtime-unified-navigation.js',
  loader: 'customer-dashboard/shared/offer-brand.js',
  assistant: 'customer-dashboard/shared/customer-runtime-assistant-profile.js',
  operational: 'customer-dashboard/shared/customer-runtime-operational-updates.js',
  css: 'customer-dashboard/shared/customer-navigation-components.css'
};
const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]));
for (const [key, path] of Object.entries(files)) {
  if (path.endsWith('.js')) new vm.Script(source[key], { filename: path });
}

for (const token of [
  "desktop: 'nav-dashboard'", "mobile: 'mnav-dashboard'",
  "desktop: 'nav-anrufe'", "mobile: 'mnav-anrufe'",
  "desktop: 'nav-assistent'", "mobile: 'mnav-assistent'",
  "desktop: 'nav-auswertung'", "mobile: 'mnav-auswertung'",
  "desktop: 'nav-mehr'", "mobile: 'mnav-mehr'",
  "pageId: 'mehr-sub-assistant-profile'",
  "pageId: 'mehr-sub-business-profile'",
  "pageId: 'mehr-sub-betriebsinfos'",
  'vx-assistant-root-host', 'data-vx-assistant-view',
  'hideArchiveRootNavigation', 'dedupeAndOrderMobileNavigation',
  'installShowTabBridge', 'setStableRootActive',
  'installAssistantObserver', "root.vxAssistantProfileOpen?.(view)",
  "showAssistantView('business', true)", 'root.vxShowAssistantView = showAssistantView',
  'page.hidden = !active'
]) assert.ok(source.navigation.includes(token), 'navigation missing: ' + token);

for (const forbidden of [
  'function addStyles', "createElement('style')", 'style.textContent',
  'managedObserver', 'settingsObserver', 'installObservers',
  'findSettingsEntryByTitle', 'cleanupSettingsEntries',
  'vx-assistant-profile-entry', 'vx-business-profile-entry', 'vx-operational-entry',
  "showAssistantView('business', false)", 'SUPABASE_SERVICE_ROLE_KEY',
  'ELEVENLABS_API_KEY', 'localStorage',
  "root.setTimeout(() => showAssistantView('profile', true), 0)",
  "root.requestAnimationFrame?.(() => {\n      mountManagedPages();"
]) assert.ok(!source.navigation.includes(forbidden), 'navigation still contains legacy token: ' + forbidden);

for (const token of [
  "document.getElementById('tab-assistent')", 'root.vxAssistantProfileOpen = open',
  "root.vxShowAssistantView?.('business', true)", "page.setAttribute('aria-label', label)",
  'let loadPromise = null', 'let loadSequence = 0', 'if (loadPromise) return loadPromise'
]) assert.ok(source.assistant.includes(token), 'assistant runtime missing: ' + token);
for (const forbidden of ['function listContainer', 'function createEntry', 'function showPage', 'function back()', 'vx-settings-entry']) {
  assert.ok(!source.assistant.includes(forbidden), 'assistant runtime still contains settings bridge: ' + forbidden);
}

assert.match(source.navigation, /ASSISTANT_VIEWS[\s\S]*profile[\s\S]*business[\s\S]*updates/);
assert.match(source.navigation, /shell\.host\.appendChild\(page\)/);
assert.match(source.navigation, /page\.hidden = !active[\s\S]*page\.style\.display = active \? 'block' : 'none'/);
assert.match(source.navigation, /function showAssistantView[\s\S]*mountManagedPages\(\)[\s\S]*applyAssistantView\(selected\)[\s\S]*triggerViewLoad\(selected\)/);
assert.match(source.operational, /root\.vxOperationalUpdatesOpen=open/);
assert.match(source.loader, /customer-runtime-calendar-settings\.js\?v=20260803-2/);
assert.match(source.loader, /customer-runtime-operational-updates\.js\?v=20260803-1/);
assert.match(source.loader, /customer-runtime-assistant-profile\.js\?v=20260802-4/);
assert.match(source.loader, /customer-runtime-assistant-status\.js\?v=20260803-1/);
assert.match(source.loader, /customer-runtime-unified-navigation\.js\?v=20260802-5/);
assert.match(source.loader, /customer-runtime-design-foundation\.js\?v=20260803-4/);
assert.match(source.css, /#tab-assistent > :not\(#vx-assistant-root-switch\):not\(#vx-assistant-root-host\)/);
assert.match(source.css, /#vx-assistant-root-host > \[data-vx-assistant-managed-page\]:not\(\[hidden\]\)/);
assert.match(source.css, /vx-nav-voice-details/);
assert.doesNotMatch(source.css, /vx-nav-status-details|vx-nav-status-summary|vx-as-capability-toggle|vx-as-capabilities-simple/);
assert.doesNotMatch(source.css, /!important/);

console.log('Unified customer dashboard navigation verification passed.');
