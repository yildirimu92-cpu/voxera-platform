// Guard fuer N6 (2026-08-09): Die Weiterleitungs-Selbstbearbeitung im
// Kundendashboard loest wieder einen ElevenLabs-Sync aus.
//
// Der eigentliche Fund war keine vergessene Codezeile, sondern eine falsche
// Klassifikation: `customer-update-assistant.js` entschied anhand einer Liste
// von Feldnamen (FORWARDING_FIELDS), ob gesynct wird, und schloss dabei genau
// die sieben Spalten aus, die im Prompt als Abschnitte WEITERLEITUNGEN und
// NOTFALLNUMMER stehen. `customers` traegt zwei verschiedene Dinge mit dem Wort
// "forwarding": die Rufumleitung des Telefonanbieters (nicht prompt-relevant)
// und die Weiterverbindungsziele des Assistenten (prompt-relevant).
//
// Dieser Test prueft deshalb nicht auf Feldnamen, sondern auf die Fehlerklasse:
// Er liest aus prompt-builder-v2.js, welche `customers`-Spalten der Prompt
// tatsaechlich verwendet, aus customer-update-assistant.js, welche dieser
// Spalten der Kunde schreiben kann — und laesst den Test scheitern, sobald eine
// Spalte in beiden Mengen liegt, aber nicht als sync-ausloesend gilt. Ein
// kuenftiges neues Prompt-Feld ohne Sync faellt damit auf, egal wie es heisst.

import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const paths = {
  policy: 'customer-dashboard/netlify/functions/_lib/assistant-write-policy.js',
  update: 'customer-dashboard/netlify/functions/customer-update-assistant.js',
  profile: 'customer-dashboard/netlify/functions/customer-assistant-profile.js',
  builder: 'admin-panel/netlify/functions/_lib/prompt-builder-v2.js',
  trigger: 'admin-panel/netlify/functions/trigger-elevenlabs-sync.js',
  dashboard: 'customer-dashboard/index.html'
};
const src = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);

let failed = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

// ── Die Dateien sind syntaktisch gueltig ─────────────────────────────────────
for (const [key, path] of Object.entries(paths)) {
  if (path.endsWith('.html')) continue;
  try {
    new vm.Script(src[key], { filename: path });
    check(`${key} ist syntaktisch gueltig`, true);
  } catch (error) {
    check(`${key} ist syntaktisch gueltig`, false, error.message);
  }
}

const policy = require(`../${paths.policy}`);

// ── Fehlerklasse: prompt-relevant geschrieben, aber nicht sync-ausloesend ────
const builderReads = new Set(
  [...src.builder.matchAll(/\bcustomer\.([a-zA-Z0-9_]+)/g)].map((match) => match[1])
);
// voice_id liest nicht der Builder, sondern der Sync selbst (TTS-Stimme und
// {{ASSISTANT_ROLE}} ueber voxera_voices.gender).
for (const match of src.trigger.matchAll(/\bcustomer\.(voice_id)\b/g)) builderReads.add(match[1]);

const customerWrites = new Set(
  [...src.update.matchAll(/\bpatch\.([a-zA-Z0-9_]+)\s*=/g)].map((match) => match[1])
);
customerWrites.delete('updated_at');

check('Prompt-Builder-Lesezugriffe gefunden', builderReads.size > 10, `${builderReads.size} Spalten`);
check('Schreibbare Spalten gefunden', customerWrites.size > 10, `${customerWrites.size} Spalten`);

const promptRelevantWrites = [...customerWrites].filter((field) => builderReads.has(field)).sort();
const notCoveredBySync = promptRelevantWrites.filter((field) => !policy.PROMPT_RELEVANT_FIELDS.has(field));
check(
  'jede prompt-relevante Spalte, die der Kunde schreiben kann, loest einen Sync aus',
  notCoveredBySync.length === 0,
  notCoveredBySync.length ? `ohne Sync: ${notCoveredBySync.join(', ')}` : `${promptRelevantWrites.length} Spalten geprueft`
);

// Die Gegenrichtung: kein Eintrag in der Liste, den niemand liest. Sonst
// wuerde die Liste mit der Zeit zu einem "sicherheitshalber alles"-Katalog und
// verlöre ihre Aussage.
const unreadEntries = [...policy.PROMPT_RELEVANT_FIELDS].filter((field) => !builderReads.has(field));
check(
  'kein toter Eintrag in PROMPT_RELEVANT_FIELDS',
  unreadEntries.length === 0,
  unreadEntries.length ? `nicht gelesen: ${unreadEntries.join(', ')}` : ''
);

// Die sieben Weiterleitungsspalten namentlich — der konkrete Fund, nicht nur
// die Fehlerklasse.
for (const field of policy.FORWARDING_FIELDS) {
  check(`${field} ist sync-ausloesend`, policy.PROMPT_RELEVANT_FIELDS.has(field));
  check(`${field} steht im Prompt-Builder`, builderReads.has(field));
}

// ── needsPromptSync() mit den echten Kombinationen ──────────────────────────
check('reine Weiterleitungsaenderung loest einen Sync aus',
  policy.needsPromptSync(['ai_forwarding_1_name', 'ai_forwarding_1_number', 'ai_forwarding_1_trigger']));
check('reine Notfallnummer-Aenderung loest einen Sync aus',
  policy.needsPromptSync(['ai_emergency_number']));
check('Weiterleitung zusammen mit Geschaeftswissen loest einen Sync aus',
  policy.needsPromptSync(['ai_forwarding_1_number', 'ai_services']));
// Die Kehrseite derselben Klassifikation (S11): SMS- und
// Benachrichtigungseinstellungen stehen in keinem Prompt und loesen deshalb
// keinen vollen Prompt-Rebuild samt ElevenLabs-PATCH mehr aus.
check('reine SMS-/Benachrichtigungseinstellung loest keinen Sync aus',
  !policy.needsPromptSync(['notification_mode', 'sms_notify_enabled', 'sms_notify_number', 'sms_caller_template']));
check('leere Aenderungsliste loest keinen Sync aus', !policy.needsPromptSync([]));
check('unbekanntes Feld loest keinen Sync aus', !policy.needsPromptSync(['irgendwas_neues']));

// ── Der Workaround ist weg, nicht nur umgangen ──────────────────────────────
// Gesucht ist der Status als Wert, nicht das Wort: in index.html steht er
// weiterhin in einem Kommentar, der erklaert, was dort frueher stand.
const forwardingOnlyStatus = /['"]skipped_forwarding_only['"]/;
check('der Status skipped_forwarding_only wird nirgends mehr erzeugt oder ausgewertet',
  !forwardingOnlyStatus.test(src.update) && !forwardingOnlyStatus.test(src.dashboard));
check('keine hasNonForwardingChange-Weiche mehr', !/hasNonForwardingChange/.test(src.update));
check('Sync-Entscheidung laeuft ueber needsPromptSync', /needsPromptSync\(patchKeys\)/.test(src.update));

// ── Der Kunden-Speicherpfad meldet dem Sync, was sich geaendert hat ─────────
// Ohne prev_values steht im elevenlabs_sync_log nur, DASS ein Sync lief. Fuer
// den Nachweis, dass eine Weiterleitungsaenderung ihn ausgeloest hat, braucht
// es changed_fields (S9).
check('customer_self_edit schickt prev_values mit',
  /triggered_by:\s*'customer_self_edit',\s*\n\s*prev_values:\s*prevValues/.test(src.update));
check('prev_values wird vor dem Patch aus dem alten Stand gebildet',
  /patchKeys\.forEach\(\(key\)\s*=>\s*\{\s*prevValues\[key\]\s*=\s*customer\[key\]/.test(src.update));

// ── Plan-Sperre: abgewiesen heisst abgewiesen ───────────────────────────────
check('Weiterleitung ohne Plan wird mit 403 abgewiesen, nicht als Teilerfolg quittiert',
  /return response\(403, buildContractPayload\(\{ error: 'forwarding_not_allowed_on_plan'/.test(src.update));
check('kein Plan-Name im Endpoint verdrahtet',
  !/planCode === 'professional'/.test(src.update));
check('Plan-Regel steht genau einmal, in der Policy-Datei',
  /=== 'professional'/.test(src.policy)
  && !/=== 'professional'/.test(src.profile));

// ── Weiterleitungsnummern erreichen den Prompt waehlbar ─────────────────────
check('Weiterleitungsnummern werden normalisiert', /normalizePhoneE164/.test(src.update));
check('unbrauchbare Nummer wird abgewiesen', /forwarding_number_invalid/.test(src.update));
check('Notfallnummer wird nicht durch die E.164-Pruefung geschickt',
  /ai_emergency_number = text\(ai_emergency_number, 40\) \|\| '144'/.test(src.update));

// ── Das Frontend erfaehrt die Berechtigung, statt sie zu raten ──────────────
check('Profil-Endpoint liefert can_change_forwarding',
  /can_change_forwarding: canEditForwarding\(planCode\)/.test(src.profile));
check('Profil-Endpoint liefert die Rohwerte beider Weiterleitungsziele',
  /slots: \[1, 2\]\.map/.test(src.profile));

// ── Das Sync-Log verliert changed_fields nicht mehr an eine fehlende Spalte ─
// Der erste Fallback warf bei jedem Insert-Fehler changed_fields gleich mit
// weg — also genau die Spalte, wegen der der S9-Fix gebaut wurde.
check('Sync-Log faellt stufenweise zurueck, nicht alles-oder-nichts',
  /const logAttempts = \[/.test(src.trigger)
  && /\{ \.\.\.bareRow, changed_fields: syncLogRow\.changed_fields \}/.test(src.trigger));
check('Objekt-Spalten erzeugen kein Phantom-Diff',
  /typeof value === 'object'\) return JSON\.stringify\(value\)/.test(src.trigger));

if (failed) process.exit(1);
console.log('Weiterleitungs-Selbstbearbeitung / Sync verified.');
