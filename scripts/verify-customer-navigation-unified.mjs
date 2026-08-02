import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  navigation: 'customer-dashboard/shared/customer-runtime-unified-navigation.js',
  loader: 'customer-dashboard/shared/offer-brand.js',
  assistant: 'customer-dashboard/shared/customer-runtime-assistant-profile.js',
  status: 'customer-dashboard/shared/customer-runtime-assistant-status.js',
  operational: 'customer-dashboard/shared/customer-runtime-operational-updates.js',
  helpRoute: 'customer-dashboard/shared/customer-runtime-help-route.js'
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
  "pageId: 'mehr-sub-assistant-profile'",
  "pageId: 'mehr-sub-business-profile'",
  "pageId: 'mehr-sub-betriebsinfos'",
  "label: 'Geschäftsprofil'",
  '#tab-assistent.vx-unified-assistant-root>:not(#vx-assistant-root-switch):not(#vx-assistant-root-host)',
  '#vx-assistant-root-host>[data-vx-assistant-managed-page]{display:none!important}',
  'vx-assistant-root-host',
  'data-vx-assistant-view',
  'hideArchiveRootNavigation',
  "findSettingsEntryByTitle('Bericht')",
  "textLabel(heading) !== 'Verbindungen'",
  'vx-unified-hidden-entry',
  'dedupeAndOrderMobileNavigation',
  'currentOrder.join',
  'desiredOrder.join',
  'vx-root-nav-active',
  'installShowTabBridge',
  'setStableRootActive',
  'Andere Stimme wählen',
  'weitere Fähigkeiten anzeigen',
  'Technische Details',
  'businessProfileShortcut',
  "closest?.('#vx-open-business-profile')",
  "showAssistantView('business', false)",
  'MutationObserver',
  '/\\/activate(?:\\.html)?$/'
]) {
  assert.ok(source.navigation.includes(token), `navigation missing: ${token}`);
}

assert.match(source.navigation, /ASSISTANT_VIEWS[\s\S]*profile[\s\S]*business[\s\S]*updates/);
assert.match(source.navigation, /shell\.host\.appendChild\(page\)/);
assert.match(source.navigation, /page\.style\.display = item\.key === selected \? 'block' : 'none'/);
assert.match(source.navigation, /triggerViewLoad\(selected\)/);
assert.match(source.navigation, /root\.vxOperationalUpdatesOpen\(\)/);
assert.match(source.navigation, /entry\.click\(\)/);
assert.match(source.navigation, /document\.addEventListener\('click',[\s\S]*true\)/);
assert.match(source.navigation, /businessProfileShortcut[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)[\s\S]*showAssistantView\('business', false\)/);
assert.match(source.navigation, /#nav-archiv,#mnav-archiv/);
assert.match(source.loader, /customer-runtime-unified-navigation\.js\?v=20260802-3/);
assert.match(source.loader, /customer-runtime-help-route\.js\?v=20260802-1/);
assert.match(source.loader, /__vxCustomerHelpRouteLoaderInstalled/);
assert.doesNotMatch(source.loader, /customer-runtime-assistant-business-menu\.js/);

assert.match(source.assistant, /mehr-sub-assistant-profile/);
assert.match(source.assistant, /mehr-sub-business-profile/);
assert.match(source.assistant, /vx-business-profile-entry/);
assert.match(source.assistant, /id=\"vx-open-business-profile\"/);
assert.match(source.status, /vx-assistant-status-extension/);
assert.match(source.operational, /mehr-sub-betriebsinfos/);
assert.match(source.operational, /root\.vxOperationalUpdatesOpen=open/);
assert.doesNotMatch(source.operational, /vx-operational-entry/);
assert.doesNotMatch(source.operational, /data-ops-back/);
assert.doesNotMatch(source.operational, /function back\(/);

assert.match(source.helpRoute, /findSettingsHelpEntry/);
assert.match(source.helpRoute, /textLabel\(node\) !== 'Hilfe'/);
assert.match(source.helpRoute, /node\.closest\('#tab-mehr'\)/);
assert.match(source.helpRoute, /root\.showTab\('mehr'\)/);
assert.match(source.helpRoute, /entry\.click\(\)/);
assert.match(source.helpRoute, /root\.requestSupport\(\)/);
assert.match(source.helpRoute, /event\.preventDefault\(\)/);
assert.match(source.helpRoute, /event\.stopImmediatePropagation\(\)/);
assert.match(source.helpRoute, /document\.addEventListener\('click', interceptHelpClick, true\)/);

assert.doesNotMatch(source.navigation, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source.navigation, /ELEVENLABS_API_KEY/);
assert.doesNotMatch(source.navigation, /ai_instructions/);
assert.doesNotMatch(source.navigation, /innerHTML\s*=\s*document\.documentElement/);
assert.doesNotMatch(source.navigation, /localStorage/);
assert.doesNotMatch(source.navigation, /assistantTab\.appendChild\(operationalPage\)/);
assert.doesNotMatch(source.helpRoute, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source.helpRoute, /ELEVENLABS_API_KEY/);
assert.doesNotMatch(source.helpRoute, /localStorage/);

console.log('Unified customer dashboard navigation verification passed.');
