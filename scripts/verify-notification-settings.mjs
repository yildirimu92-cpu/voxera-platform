// Guard fuer die Benachrichtigungseinstellungen (2026-08-09).
//
// Der Fund, den dieser Test festhaelt, war keine kaputte Funktion, sondern eine
// unterbrochene Wirkkette: die Einstellungsseite schrieb notification_mode,
// der Versand gatete auf notification_active / new_log_email_active. Jede
// einzelne Stelle war fuer sich korrekt, die Kette dazwischen fehlte -- der
// Schalter quittierte Erfolg und blieb wirkungslos.
//
// Deshalb prueft dieser Test die Kette, nicht die Stellen:
//   1. Welchen Modus erzeugt die Oberflaeche aus ihren Schaltern?
//   2. Schreibt sie ihn ueber die Function, die ihn validiert?
//   3. Laesst die Function ihn durch?
//   4. Gatet der Versand auf demselben Wert?
// Faellt ein Glied aus, faellt der Test -- auch wenn alle Dateien einzeln
// weiterhin fehlerfrei sind.

import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const paths = {
  dashboard: 'customer-dashboard/index.html',
  settings: 'customer-dashboard/netlify/functions/customer-update-settings.js',
  callNotification: 'customer-dashboard/netlify/functions/_lib/call-notification.js',
  profile: 'customer-dashboard/netlify/functions/customer-assistant-profile.js',
  migration: 'supabase/migrations/20260809172815_notification_mode_gating.sql',
  adminEvents: 'admin-panel/netlify/functions/_lib/admin-notification-events.js',
  adminEventsCopy: 'customer-dashboard/netlify/functions/_lib/admin-notification-events.js',
  adminSettings: 'admin-panel/netlify/functions/admin-notification-settings.js',
  adminMigration: 'supabase/migrations/20260809172215_admin_notification_settings.sql',
  adminPanel: 'admin-panel/index.html',
  notificationBridge: 'customer-dashboard/shared/customer-runtime-notifications.js',
  aiChangeRequest: 'customer-dashboard/netlify/functions/ai-change-request-create.js'
};
const src = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);

let failed = 0;
// Der Hinweistext erscheint nur im Fehlerfall: er erklaert, warum die Pruefung
// existiert, und liest sich hinter einem PASS wie ein Widerspruch.
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${!passed && detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

// ─── Glied 1: die Oberflaeche ───────────────────────────────────────────────
//
// vxNotifModeFromSwitches() und vxNotifSyncDependentRows() werden aus dem
// Dashboard herausgeschnitten und wirklich ausgefuehrt -- nachgebaute Logik
// wuerde genau den Fehler nicht finden, um den es hier geht.

function extractFunction(name) {
  const start = src.dashboard.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name}() nicht in index.html gefunden`);
  let depth = 0;
  let seenBrace = false;
  for (let i = start; i < src.dashboard.length; i += 1) {
    const char = src.dashboard[i];
    if (char === '{') { depth += 1; seenBrace = true; }
    else if (char === '}') {
      depth -= 1;
      if (seenBrace && depth === 0) return src.dashboard.slice(start, i + 1);
    }
  }
  throw new Error(`${name}() ist unvollstaendig`);
}

// Minimaler DOM-Stub: nur, was die beiden Funktionen anfassen. Bewusst kein
// jsdom -- die uebrigen Verify-Skripte laufen ohne Abhaengigkeiten, und ein
// Test, der nicht laeuft, prueft nichts.
function makeElement(id) {
  const classes = new Set();
  const element = {
    id,
    checked: false,
    disabled: false,
    textContent: '',
    classList: {
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name)
    },
    closest: () => element
  };
  return element;
}

const elements = {
  'notif-switch-callback': makeElement('notif-switch-callback'),
  'notif-switch-all-calls': makeElement('notif-switch-all-calls'),
  'notif-all-calls-hint': makeElement('notif-all-calls-hint')
};

const sandbox = {
  document: { getElementById: (id) => elements[id] || null },
  console
};
vm.createContext(sandbox);
try {
  vm.runInContext(
    `${extractFunction('vxNotifModeFromSwitches')}\n${extractFunction('vxNotifSyncDependentRows')}`,
    sandbox
  );
  check('vxNotifModeFromSwitches/vxNotifSyncDependentRows laden aus index.html', true);
} catch (error) {
  check('vxNotifModeFromSwitches/vxNotifSyncDependentRows laden aus index.html', false, error.message);
}

const modeFromSwitches = sandbox.vxNotifModeFromSwitches;
const uiModes = [
  [false, false, 'none'],
  [false, true, 'none'],
  [true, false, 'callback_only'],
  [true, true, 'all_calls']
];
for (const [callbackOn, allCallsOn, expected] of uiModes) {
  check(
    `Schalter (Rueckruf=${callbackOn}, jeder Anruf=${allCallsOn}) -> ${expected}`,
    modeFromSwitches(callbackOn, allCallsOn) === expected,
    `war ${modeFromSwitches(callbackOn, allCallsOn)}`
  );
}

// Der Unterschalter darf nicht bedienbar bleiben, wenn er nichts bedeutet:
// "keine E-Mails, aber Zusammenfassung nach jedem Anruf" ist kein Zustand, den
// notification_mode kennt.
elements['notif-switch-callback'].checked = false;
sandbox.vxNotifSyncDependentRows();
check(
  'Unterschalter wird gesperrt, wenn der Hauptschalter aus ist',
  elements['notif-switch-all-calls'].disabled === true
);
check(
  'Die gesperrte Zeile sagt auch, warum',
  /Nicht verfügbar/.test(elements['notif-all-calls-hint'].textContent),
  elements['notif-all-calls-hint'].textContent
);
elements['notif-switch-callback'].checked = true;
sandbox.vxNotifSyncDependentRows();
check(
  'Unterschalter wird wieder freigegeben',
  elements['notif-switch-all-calls'].disabled === false
);

// ─── Glied 2: der Schreibweg ────────────────────────────────────────────────
check(
  'Die Seite speichert ueber customer-update-settings, nicht per PostgREST',
  /customer-update-settings[\s\S]{0,400}in_app_notification_settings/.test(src.dashboard)
    && !/from\('customers'\)\.update\(\{\s*in_app_notification_settings/.test(src.dashboard),
  'in_app_notification_settings darf nicht mehr direkt aus dem Browser geschrieben werden'
);

check(
  'Es gibt keinen zweiten Schreibweg auf notification_mode im Dashboard mehr',
  !src.dashboard.includes('function saveNotifSettings') && !src.dashboard.includes('function selectNotifCard'),
  'saveNotifSettings()/selectNotifCard() schrieben notification_mode am Endpoint vorbei'
);

// ─── Glied 3: die Function laesst den Wert durch ────────────────────────────
for (const field of ['notification_mode', 'in_app_notification_settings']) {
  check(
    `customer-update-settings akzeptiert ${field}`,
    new RegExp(`CANONICAL_ALLOWED_FIELDS[\\s\\S]{0,600}'${field}'`).test(src.settings)
  );
}
check(
  'Systemhinweise koennen ueber den Endpoint nicht abgeschaltet werden',
  /system:\s*true/.test(src.settings),
  'sonst schaltet ein Kunde die Erreichbarkeits-Warnungen ab'
);

// ─── Glied 4: der Versand gatet auf demselben Wert ──────────────────────────
const { decideMail, DEFAULT_NOTIFICATION_MODE } = require(`../${paths.callNotification}`);
const customer = { id: 'cust_x', email: 'kunde@example.invalid' };

const gating = [
  ['none', true, null],
  ['none', false, null],
  ['callback_only', true, 'callback_request_email'],
  ['callback_only', false, null],
  ['all_calls', true, 'callback_request_email'],
  ['all_calls', false, 'call_notification_email']
];
for (const [mode, callbackRequested, expected] of gating) {
  const result = decideMail({ ...customer, notification_mode: mode }, callbackRequested);
  check(
    `Versand ${mode} + ${callbackRequested ? 'Rueckruf' : 'normaler Anruf'} -> ${expected || 'keine Mail'}`,
    result.mailType === expected,
    `war ${result.mailType}`
  );
}

// Die Kette geschlossen: was die Oberflaeche erzeugt, muss der Versand kennen.
for (const [callbackOn, allCallsOn] of uiModes.map(([a, b]) => [a, b])) {
  const mode = modeFromSwitches(callbackOn, allCallsOn);
  const decided = decideMail({ ...customer, notification_mode: mode }, false);
  check(
    `Kette geschlossen fuer Modus ${mode}`,
    decided.reason !== 'notification_mode_unknown' && ['notifications_off', 'callback_only_mode', null].includes(decided.reason),
    `unerwarteter Grund ${decided.reason}`
  );
}

// ─── Der Werksstandard ist ueberall derselbe ────────────────────────────────
check(
  'call-notification.js kennt callback_only als Werksstandard',
  DEFAULT_NOTIFICATION_MODE === 'callback_only',
  DEFAULT_NOTIFICATION_MODE
);
check(
  'Das Dashboard faellt auf denselben Werksstandard zurueck',
  /VX_NOTIFICATION_MODE_DEFAULT\s*=\s*'callback_only'/.test(src.dashboard)
    && !/notificationMode:\s*'none'/.test(src.dashboard),
  'index.html fiel frueher auf none zurueck, waehrend die DB callback_only vergab'
);
check(
  'Die Migration setzt denselben Spalten-Default',
  /alter column notification_mode set default 'callback_only'/.test(src.migration)
);

// ─── Die alte Fehlerklasse kann nicht zurueckkommen ─────────────────────────
const executable = src.callNotification
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
for (const column of ['notification_active', 'new_log_email_active', 'missed_call_email_active']) {
  check(
    `Der Versand liest ${column} nicht mehr`,
    !executable.includes(column),
    'genau diese Spalte hat die Kundeneinstellung ueberstimmt'
  );
}

// ─── Die Faehigkeiten-Karte nennt den Kanal aus der lebenden Quelle ─────────
const profileExecutable = src.profile
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
check(
  'notificationDetail() leitet den Kanal nicht aus den toten Spalten ab',
  !/notificationDetail[\s\S]{0,900}new_log_email_active/.test(profileExecutable),
  'sonst verschwindet "E-Mail" fuer jeden Kunden, der seine Einstellung geaendert hat'
);
check(
  'Die Karte behauptet keinen SMS-Kanal, solange es keinen Versand gibt',
  !profileExecutable.includes('Telefon/SMS'),
  'phone_notification_to hat keinen Versandpfad'
);

// ─── Keine doppelten IDs auf der Einstellungsseite ──────────────────────────
const ids = [...src.dashboard.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
for (const id of ['notif-switch-callback', 'notif-switch-all-calls', 'notif-switch-bell', 'notif-all-calls-hint']) {
  check(`ID ${id} existiert genau einmal`, !duplicates.includes(id) && ids.includes(id));
}
check(
  'Die alten inapp-setting-*-Duplikate sind weg',
  !src.dashboard.includes('id="inapp-setting-'),
  'getElementById traf immer die erste Kopie, die zweite speicherte nie'
);


// ─── Admin-Portal ───────────────────────────────────────────────────────────
//
// Dieselbe Fehlerklasse, andere Seite: die Diagnose fand fuenf beschlossene
// Events, von denen genau eines zustellt. Ein Schalter fuer die uebrigen vier
// waere ein Schalter ohne Wirkung -- deshalb pruefen die naechsten Zeilen, dass
// die Oberflaeche nur anbietet, was das Backend auch versenden kann.
const adminEvents = require(`../${paths.adminEvents}`);

check(
  'Beide Kopien von admin-notification-events.js sind identisch',
  src.adminEvents === src.adminEventsCopy,
  'Netlify bundelt pro Site - die Kopien duerfen nicht auseinanderlaufen'
);

const EXPECTED_EVENTS = [
  'ai_change_request',
  'countersign_pending',
  'contract_start_confirmed',
  'billing_delivery_failure',
  'cancellation_submitted'
];
check(
  'Die fuenf beschlossenen Admin-Events sind definiert',
  EXPECTED_EVENTS.every(key => adminEvents.EVENT_KEYS.includes(key))
    && adminEvents.EVENT_KEYS.length === EXPECTED_EVENTS.length,
  adminEvents.EVENT_KEYS.join(', ')
);

for (const key of EXPECTED_EVENTS) {
  check(
    `Die Migration kennt ${key}`,
    new RegExp(`'${key}'`).test(src.adminMigration)
  );
}

// Der Werksstandard aus dem Zielbild: 1, 2, 4, 5 an -- 3 aus.
const defaults = Object.fromEntries(
  adminEvents.ADMIN_NOTIFICATION_EVENTS.map(event => [event.key, event.defaultEmail])
);
check('Werksstandard: KI-Aenderungsanfrage an', defaults.ai_change_request === true);
check('Werksstandard: Gegenzeichnung ausstehend an', defaults.countersign_pending === true);
check('Werksstandard: Vertragsstart bestaetigt aus', defaults.contract_start_confirmed === false);
check('Werksstandard: Billing-/Zustellfehler an', defaults.billing_delivery_failure === true);
check('Werksstandard: Kuendigung eingereicht an', defaults.cancellation_submitted === true);

// Genau ein Event hat heute einen Versandweg. Faellt diese Pruefung, weil ein
// weiterer mailType gesetzt wurde, gehoert die passende Route in Make dazu --
// sonst verspricht die Oberflaeche einen Versand, den es nicht gibt.
const withMailType = adminEvents.ADMIN_NOTIFICATION_EVENTS.filter(event => event.mailType);
check(
  'Nur Events mit mailType gelten als verfuegbar',
  withMailType.length === 1 && withMailType[0].key === 'ai_change_request',
  `mit mailType: ${withMailType.map(event => event.key).join(', ') || '(keins)'}`
);
for (const event of adminEvents.ADMIN_NOTIFICATION_EVENTS.filter(item => !item.mailType)) {
  check(
    `${event.key} nennt seine kuenftige Ausloesestelle`,
    Boolean(event.plannedTrigger),
    'sonst ist beim Nachbauen nicht auffindbar, wo der Emitter hingehoert'
  );
}
check(
  'Die Oberflaeche zeigt nicht versendbare Events als Zustand statt als Schalter',
  /available\s*:\s*Boolean\(event\.mailType\)/.test(src.adminSettings)
    && /Noch nicht aktiv/.test(src.adminPanel),
  'ein Schalter ohne Versandweg ist genau der Fehler, den die Diagnose gefunden hat'
);

// B9: der Empfaenger kommt aus der Einstellung, nicht aus dem Sammelpostfach.
check(
  'ai_change_request loest die Empfaenger aus admin_notification_settings auf',
  /resolveAdminRecipients\(sbAdmin,\s*'ai_change_request'\)/.test(src.aiChangeRequest)
    && /recipient:\s*\{\s*email:/.test(src.aiChangeRequest),
  'der Payload trug bis 2026-08-09 keinen Empfaenger'
);
check(
  'Ohne Empfaenger wird kein Erfolg behauptet',
  /skipped:\s*true/.test(src.aiChangeRequest) && /accepted:\s*false/.test(src.aiChangeRequest),
  'ein abgeschaltetes Event darf nicht wie ein zugestelltes aussehen'
);
check(
  '"Niemand will das" und "Abfrage gescheitert" sind unterscheidbar',
  /no_recipients_enabled/.test(src.adminEvents) && /lookup_failed/.test(src.adminEvents)
);

// Die Tabelle ist nicht aus dem Browser erreichbar.
check(
  'admin_notification_settings ist gegen Browser-Zugriff gesperrt',
  /enable row level security/.test(src.adminMigration)
    && /revoke all on public\.admin_notification_settings from anon/.test(src.adminMigration)
    && /revoke all on public\.admin_notification_settings from authenticated/.test(src.adminMigration),
  'dieselbe Annahme hat 2026-08-08 bei public.notifications nicht gehalten'
);
check(
  'Die Einstellungs-Function laeuft nur fuer eingeloggte Admins',
  /requireAdminCaller/.test(src.adminSettings)
);
check(
  'Ein Admin aendert nur die eigenen Einstellungen',
  /\.eq\('admin_id',\s*adminId\)/.test(src.adminSettings)
    && !/body\.admin_id/.test(src.adminSettings),
  'sonst kann ein Admin die Benachrichtigungen eines anderen abschalten'
);



// ─── Der globale Glocken-Abfaenger ──────────────────────────────────────────
//
// customer-runtime-notifications.js haengt vier Listener in der Capture-Phase
// an document und schliesst mit preventDefault() + stopImmediatePropagation()
// ab. Solange die Erkennung heuristisch war -- jedes Element mit einer
// Glocken-Glyphe oder "Benachrichtigung" in aria-label/title --, hat sie damit
// jeden korrekten Handler darunter ueberstimmt. Getroffen hat es die Zeile
// "Benachrichtigungen" in der Einstellungsliste: Klick aufs Icon oeffnete den
// globalen Feed, Klick auf den Titeltext daneben die Einstellungsseite.
//
// Die Pruefungen hier halten die Umkehrung fest: nur ausdruecklich
// gekennzeichnete Elemente sind Ausloeser.
const bridgeExecutable = src.notificationBridge
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

check(
  'Die Glyphen-Erkennung ist zurueckgebaut',
  !bridgeExecutable.includes('BELL_ICON_SELECTOR'),
  'jede kuenftige ph-bell-Glyphe wuerde sonst wieder zum Ausloeser'
);
for (const heuristic of ['aria-label*="Benachrichtigung"', 'title*="Benachrichtigung"', 'aria-label*="notification"']) {
  check(
    `Die Textheuristik ${heuristic} ist zurueckgebaut`,
    !bridgeExecutable.includes(heuristic),
    'bindTrigger() setzt selbst aria-label -- die Heuristik war selbstverstaerkend'
  );
}
check(
  'bindTrigger() haertet nichts, was in einem Bedienelement liegt',
  /isInsideInteractiveControl/.test(bridgeExecutable),
  'sonst bekommt ein Icon-span in einem <button> role=button und einen eigenen Tab-Stopp'
);

// Genau zwei echte Glocken, beide mit eigenem Bell-Handler.
const markedBells = [...src.dashboard.matchAll(/<[^>]*data-notifications-trigger[^>]*>/g)].map(match => match[0]);
check(
  'Genau zwei Elemente sind als Glocke gekennzeichnet',
  markedBells.length === 2,
  `gefunden: ${markedBells.length}`
);
check(
  'Beide gekennzeichneten Glocken tragen ihren eigenen vxBellToggle-Handler',
  markedBells.every(tag => tag.includes('vxBellToggle')),
  markedBells.join(' | ')
);
check(
  'Die Einstellungszeile ist nicht als Glocke gekennzeichnet',
  !/vx-settings-entry[^>]*data-notifications-trigger/.test(src.dashboard)
    && !/data-notifications-trigger[^>]*vx-settings-entry/.test(src.dashboard),
  'sie oeffnet die Einstellungsseite, nicht den Feed'
);


console.log(`\n${failed === 0 ? 'Benachrichtigungseinstellungen verifiziert (Kunden-Dashboard und Admin-Portal).' : `${failed} Pruefung(en) fehlgeschlagen.`}`);
process.exit(failed === 0 ? 0 : 1);
