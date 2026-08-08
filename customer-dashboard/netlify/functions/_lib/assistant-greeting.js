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

function buildGreetingView(customer) {
  const effective = text(customer?.ai_effective_greeting);
  if (effective) return { text: effective, source: 'effective' };
  const custom = text(customer?.ai_greeting);
  if (custom) return { text: custom, source: 'custom' };
  return { text: null, source: 'none' };
}

module.exports = { buildGreetingView };
