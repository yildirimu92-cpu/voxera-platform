# `customers.agent_runtime_config` — Skizze, nicht gebaut

**Stand 2026-08-11, im Rahmen von #932.** Ausdrücklich eine Skizze: Erst die
Regel, dann die Ausnahme. Die Regel steht seit #932 — dieses Dokument hält fest,
wie die Ausnahme aussähe, damit sie später nicht neu erfunden wird.

## Warum es die Ausnahme überhaupt braucht

Seit #932 ist `_lib/elevenlabs-agent-config.js` der Sollzustand für **alle**
Agenten. Kundenspezifisch sind genau vier Felder plus die dynamischen
`tool_ids`:

| Pfad | Quelle |
|---|---|
| `conversation_config.agent.prompt.prompt` | `buildPromptV2()` + Kalenderblock |
| `conversation_config.agent.first_message` | `customers.ai_greeting` bzw. generiert |
| `conversation_config.tts.voice_id` | `customers.voice_id` |
| `conversation_config.agent.language` | `customers.ai_language` |
| `conversation_config.agent.prompt.tool_ids` | Kalender-Provisionierung |

Alles andere ist bewusst für alle gleich. Das ist die beabsichtigte Wirkung:
Handeinstellungen in der ElevenLabs-Oberfläche halten nicht mehr.

Der Bedarf entsteht erst, wenn ein einzelner Kunde nachweislich einen anderen
Wert braucht — etwa ein höheres `max_duration_seconds` für eine Hotline mit
langen Gesprächen, oder ein anderes `llm` für einen Kunden mit einer Sprache,
in der das Standardmodell schlecht ist. Bis so ein Fall belegt vorliegt, ist
jede Überschreibung eine Lösung ohne Problem.

## Form

Eine `jsonb`-Spalte auf `customers`, die **nur Blätter** überschreibt, die in
`AGENT_DEFINITION` bereits existieren:

```json
{
  "conversation_config.conversation.max_duration_seconds": 1800,
  "conversation_config.agent.prompt.thinking_budget": 2048
}
```

Flache dotted paths, keine verschachtelten Teilobjekte. Grund: Genau die
Verschachtelung war der Befund von #932 — ein Teilobjekt, das ein ganzes
ersetzt. Eine flache Blattliste kann diesen Fehler baulich nicht wiederholen.

## Die vier Regeln, an denen es hängt

1. **Allowlist gegen die Definition.** Ein Pfad, der in `AGENT_DEFINITION` nicht
   vorkommt, wird abgelehnt — nicht durchgereicht. Sonst wäre die Spalte ein
   offener Kanal in die Anbieter-API, und der nächste Feldname mit Tippfehler
   landete stillschweigend im Agenten. `expectedLeaves(AGENT_DEFINITION)`
   liefert die Allowlist bereits, ohne sie ein zweites Mal aufzuzählen.

2. **Die kundenspezifischen Pfade sind gesperrt.** `CUSTOMER_SPECIFIC_PATHS`
   darf die Spalte nicht anfassen — für Prompt, Begrüssung, Stimme und Sprache
   gibt es eigene Felder mit eigener Validierung. Zwei Wege auf denselben Wert
   sind genau die Doppelquelle, die #932 aufgelöst hat.

3. **Die Rückleseprüfung gilt weiter.** Sie leitet ihre Erwartung aus dem
   gesendeten Körper ab, nicht aus der Definition — überschriebene Werte sind
   damit automatisch gegen den überschriebenen Sollzustand geprüft, ohne
   Zusatzarbeit. Das ist der Grund, die Überschreibung *vor* dem Senden
   anzuwenden und nicht danach.

4. **Sichtbar im Diff.** Die Spalte gehört in `prev_values`/`changed_fields` des
   Sync-Logs, wie jedes andere prompt-relevante Feld. Eine Überschreibung, die
   in keinem Log auftaucht, hätte denselben Mangel wie die Handeinstellung, die
   #932 abgeschafft hat: sie stünde nirgends und fiele niemandem auf.

## Einbau

Ein Aufruf in `buildAgentConfig()`, nach dem Setzen der kundenspezifischen
Felder:

```js
applyOverrides(body, customer.agent_runtime_config);  // validiert gegen AGENT_DEFINITION
```

Beide Schreibpfade — Sync und Provisionierung — bekommen die Überschreibung
damit ohne weiteres Zutun, weil beide durch dieselbe Funktion gehen. Das ist der
Grund, warum diese Skizze überhaupt kurz sein kann: #932 hat die Stelle
geschaffen, an der so etwas genau einmal steht.

## Was zuerst zu klären wäre

- **Wer darf schreiben?** Vermutlich `customer:write` wie der Rest, aber ein
  falsch gesetztes `llm` wirkt auf jeden Anruf. Ein eigener Capability-Check
  wäre vertretbar.
- **Was passiert bei einem Wert, den der Anbieter ablehnt?** Heute schlägt der
  ganze PATCH fehl. Eine Überschreibung könnte damit den Sync eines Kunden
  dauerhaft blockieren — die Warteschlange würde ihn bis `dead` wiederholen.
  Ein Vorabtest gegen einen Agenten oder ein Rückfall auf den Standardwert nach
  dem ersten Fehlschlag wäre zu entscheiden.
- **Gehört die Spalte in den Fingerprint?** Ja, sonst hielte der Fan-out einen
  Kunden für aktuell, dessen Überschreibung sich geändert hat — dieselbe Lücke
  wie bei `industry_required_information` (J8).
