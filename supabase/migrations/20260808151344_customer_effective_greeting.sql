BEGIN;

-- Etappe 6 / S2 — Kopfbereich "So meldet sich Ihr Assistent".
--
-- Der Satz, mit dem sich der Assistent bei Anrufenden meldet, entsteht heute
-- erst im Prompt-Builder (buildGreeting() in prompt-builder-v2.js) und wird
-- nirgends gespeichert: 3 von 4 Kunden haben ein leeres ai_greeting. Das
-- Kunden-Dashboard konnte den Satz deshalb nicht anzeigen.
--
-- ai_effective_greeting haelt den Satz, den der Agent zuletzt tatsaechlich
-- erhalten hat. Geschrieben wird die Spalte ausschliesslich von
-- trigger-elevenlabs-sync nach einem ERFOLGREICHEN Sync. Damit ist per
-- Konstruktion ausgeschlossen, dass das Dashboard eine Begruessung anzeigt,
-- die der Agent nie bekommen hat.
--
-- ABGELEITETE SPALTE — NICHT MANUELL PFLEGEN.
-- Die frei waehlbare Begruessung des Kunden bleibt ai_greeting; sie wird von
-- diesem Mechanismus nie ueberschrieben.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS ai_effective_greeting text;

COMMENT ON COLUMN public.customers.ai_effective_greeting IS
  'Abgeleitet: erste Nachricht, die beim letzten erfolgreichen ElevenLabs-Sync an den Agenten uebertragen wurde. Wird nur von trigger-elevenlabs-sync geschrieben, nie manuell gepflegt. Kundeneigene Begruessung steht in ai_greeting.';

COMMIT;
