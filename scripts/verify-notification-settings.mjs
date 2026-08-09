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
  migration: 'supabase/migrations/2026-08-09_notification_mode_gating.sql'
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

console.log(`\n${failed === 0 ? 'Benachrichtigungseinstellungen verifiziert.' : `${failed} Pruefung(en) fehlgeschlagen.`}`);
process.exit(failed === 0 ? 0 : 1);
