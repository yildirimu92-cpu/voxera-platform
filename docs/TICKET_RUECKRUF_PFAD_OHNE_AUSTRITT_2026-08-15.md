# Ticket — Der Rückruf-Pfad greift pauschal, auch wenn die Frage beantwortet ist

**Datum:** 2026-08-15
**Art:** Prompt (L1). Keine Migration, kein Code.
**Gefunden:** Testanruf `d2fb8f53`, 2026-08-15, 24 Sekunden
**Betrifft:** jede Branche mit vielen einfachen Auskunftsfragen — Coiffeur, Praxis, Restaurant, Bäckerei

---

## Der Fall

Vollständiges Transkript, es ist nur ein Austausch:

```
agent: Grüezi, hier spricht Lara, die digitale Assistentin von E2E Test AG,
       das Gespräch wird aufgezeichnet. Wie kann ich Ihnen helfen?
user:  Grüezi, ich wollte fragen, wenn Sie am Samstag off haben.
agent: Samstags haben wir geschlossen. Wann passt es Ihnen denn am besten
       für einen Rückruf, damit wir Ihr Anliegen besprechen können?
```

Der Anrufer legte danach auf.

**Die Frage war beantwortet.** Es gab kein Anliegen mehr zu besprechen. Trotzdem verlangt der Assistent im selben Atemzug einen Rückruftermin.

Im Datensatz steht:

| Feld | Wert |
|---|---|
| `category` | `informationsanfrage` |
| `callback_requested` | `false` |
| **`next_action`** | **`Rückruf vereinbaren`** |

Der Datensatz widerspricht sich selbst: Kein Rückruf gewünscht — und trotzdem lautet die nächste Aktion, einen zu vereinbaren. Im Dashboard erscheint damit ein offener Posten, der keiner ist.

## Die Wurzel: zwei Stellen in L1, beide ohne Bedingung

**`## GESPRÄCHSZIEL`, Zeile 144–147:**

```
**PFLICHT in dieser Reihenfolge:**
1. Name (falls nicht selbst vorgestellt)
2. Anliegen
3. Rückruf-Zeitpunkt
```

Der Rückruf-Zeitpunkt steht als **Pflichtziel jedes Gesprächs** — nicht als Ziel für den Fall, dass ein Rückruf nötig ist.

**`## RÜCKRUF-HANDLING`, Zeile 155–173:**

```
**Schritt 1 — Anliegen zusammenfassen:** ...
**Schritt 2 — Zeitpunkt erfragen:** „Wann passt es Ihnen am besten für einen Rückruf?"
**Schritt 3 — Loop-Breaker:** ...
**Schritt 4 — Nummer bestätigen:** ...
**Commitment:** Immer ein konkretes Zeitfenster nennen.
```

Vier Schritte, ein Commitment — und **keine Austrittsbedingung**. Nirgends steht, wann dieser Block *nicht* gilt. Er liest sich als unbedingte Abfolge, und genau so wird er ausgeführt.

Im Testanruf hat der Assistent sogar Schritt 1 übersprungen (das Anliegen war ja erledigt) und ist direkt zu Schritt 2 gegangen. Er hat die Bedingung selbst als nicht vorhanden behandelt.

## Dieselbe Fehlerform wie bei der Dringlichkeit

Beim `urgency`-Befund stand die Regel an drei Stellen und war jedes Mal an ein Signal des Anrufers gebunden — das Modell tat exakt, was dastand, und liess das Feld auf 58 % der Anrufe leer.

Hier ist es die Umkehrung: Die Regel steht an zwei Stellen und ist an **gar nichts** gebunden. Das Modell tut wieder exakt, was dasteht.

Beide Male ist die Ursache nicht ein fehlendes Kriterium, sondern ein **falsch quantifiziertes**: einmal zu eng („nur wenn der Anrufer Hinweise gibt"), einmal zu weit („immer").

## Warum das teuer wird

**Im Dashboard:** Bei einem Coiffeur erzeugt jede Öffnungszeiten-Frage einen offenen Posten. Der Kunde räumt Einträge weg, die nie Anliegen waren — und gewöhnt sich daran, die Liste zu ignorieren. Danach übersieht er den einen, der zählt.

**In der SMS:** `sms_notify_trigger` steht ab Werk auf `all`. Ein Team mit fünf Empfängern bekäme für „Haben Sie samstags offen?" fünf SMS. Bei einer Frage, die der Assistent bereits vollständig beantwortet hat.

**Im Gespräch:** Der Anrufer hat seine Auskunft und wird trotzdem nach einem Termin gefragt. Das wirkt, als hätte der Assistent nicht zugehört — bei einem Produkt, dessen Versprechen genau das Gegenteil ist.

## Was fehlt

Eine **Austrittsbedingung** vor dem Rückruf-Block, sinngemäss:

> Ein Rückruf ist nur nötig, wenn das Anliegen im Gespräch **nicht abschliessend beantwortet** werden konnte. Ist die Frage beantwortet, bestätige das und beende das Gespräch — frage nicht nach einem Rückruftermin.

Und im `GESPRÄCHSZIEL`-Block muss der Rückruf-Zeitpunkt aus der Pflichtliste heraus: Er ist Pflicht, **wenn** ein Rückruf ansteht, nicht immer.

Beides ist Prompt-Arbeit an derselben Datei wie der zurückgestellte Dringlichkeits-Eingriff (`TICKET_DRINGLICHKEIT_PFLICHTFELD_2026-08-11.md`) — **dieselben zwei Blöcke liegen 10 Zeilen auseinander.** Wer beide getrennt anfasst, öffnet `prompt_master_l1` zweimal, und das ist ohne Versionierung (#929) einmal zu oft.

## Abgrenzung

**Kein Ersatz für die Kategorie-Logik.** `category = informationsanfrage` war korrekt, `callback_requested = false` war korrekt. Falsch war nur `next_action` — und das Gesprächsverhalten davor.

**Nicht dasselbe wie #987** (Terminbuchung löst die falsche E-Mail-Vorlage aus). Dort wählt eine nachgelagerte Ebene falsch. Hier erzeugt der Assistent im Gespräch einen Zustand, den es nicht geben sollte.

## Zu entscheiden

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Zusammen mit dem Dringlichkeits-Eingriff in einer Migration? | **Ja** — dieselbe Datei, benachbarte Blöcke, ohne Versionierung ist jeder zusätzliche Zugriff ein Risiko |
| 2 | Soll der Assistent bei beantworteter Frage aktiv anbieten („Falls doch noch etwas offen ist, melden Sie sich gern")? | Ja, aber ohne Terminfrage |
| 3 | Gilt die Ausnahme branchenabhängig? | Nein — sie ist allgemeiner als jede Branche. Der Notdienst braucht sie genauso: „Wie lange dauert ein Abschleppvorgang?" ist auch dort eine reine Auskunft. |
