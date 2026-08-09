'use strict';

// Etappe 6 / S2 — welcher Begruessungssatz gilt fuer die Anzeige im Dashboard.
//
// Erzeugt wird die Begruessung bewusst NICHT hier: kanonisch ist buildGreeting()
// im Prompt-Builder des Admin-Panels, und trigger-elevenlabs-sync legt das
// Ergebnis nach jedem erfolgreichen Sync in customers.ai_effective_greeting ab.
// Dieses Modul waehlt nur zwischen den bekannten Werten aus — eine zweite
// Erzeugungslogik im Dashboard waere genau die doppelte Quelle, die schon in
// Etappe 4/5 Fehler produziert hat.
//
//   effective — zuletzt tatsaechlich an den Agenten uebertragen
//   custom    — vom Kunden gesetzt, aber noch nie synchronisiert
//   none      — noch nichts vorhanden (Regelfall ohne eingerichteten Agenten)

const text = (value) => String(value == null ? '' : value).trim();

// A4 / E11 — der Satz, den Anrufende hoeren, kann den Namen des Assistenten
// ueberleben: buildPromptV2 bevorzugt eine gespeicherte ai_greeting gegenueber
// der erzeugten, und eine Umbenennung zieht dort nicht mit (Befund N7).
// Erkannt wird das ueber den Namen, nicht ueber ein zweites Erzeugen des
// Satzes — eine zweite Erzeugungslogik im Dashboard waere genau die doppelte
// Quelle, die dieses Modul vermeidet. Faellt der Name im Satz, ist der Satz alt.
function hasStaleName(sentence, assistantName) {
  const name = text(assistantName);
  const value = text(sentence);
  if (!name || !value) return false;
  return !new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu').test(value);
}

function buildGreetingView(customer) {
  const assistantName = text(customer?.assistant_name);
  const custom = text(customer?.ai_greeting);
  const effective = text(customer?.ai_effective_greeting);
  // Der Hinweis haengt an der gespeicherten Begruessung, nicht an der
  // uebertragenen: nur die erste ist eingefroren, die zweite wird bei jedem
  // Sync neu geschrieben und darf hier keinen Alarm ausloesen.
  const staleName = Boolean(custom) && hasStaleName(custom, assistantName);
  if (effective) return { text: effective, source: 'effective', stale_name: staleName };
  if (custom) return { text: custom, source: 'custom', stale_name: staleName };
  return { text: null, source: 'none', stale_name: false };
}

module.exports = { buildGreetingView, hasStaleName };
