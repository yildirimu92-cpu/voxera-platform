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

## Warum das teuer wird — fünf SMS für „Haben Sie samstags offen?"

**Das ist das Argument, das die Dringlichkeit dieses Tickets trägt.**

`sms_notify_trigger` steht ab Werk auf `all`. Ein Team mit fünf Empfängern bekommt also für jede Auskunftsfrage **fünf SMS** — für eine Frage, die der Assistent bereits vollständig beantwortet hat.

Gerechnet bei CHF 0.07–0.10 je Segment:

| | |
|---|---|
| Kosten je überflüssigem Anruf | **CHF 0.35 – 0.50** |
| Bei 300 Anrufen/Monat, davon 30 % reine Auskunft (90) | **CHF 32 – 45 pro Monat** |
| Erlös aus `sms_notify` | **CHF 9 pro Monat** |

**Der Kanal zahlt bei einem Coiffeur drauf, bevor ein einziger echter Notfall durchgeht.** Und das Ticket zum Preismodell (`TICKET_SMS_KOSTEN_PAKETMERKMAL_2026-08-11.md`) rechnet mit *echten* Anfragen — diese hier kommen obendrauf.

Der Anteil ist geschätzt, nicht gemessen; die Grössenordnung hängt nicht daran. Bei einer Bäckerei oder einem Restaurant dürfte er höher liegen als 30 %.

**Im Dashboard** kommt dasselbe nochmal an: Jede Öffnungszeiten-Frage erzeugt einen offenen Posten. Der Kunde räumt Einträge weg, die nie Anliegen waren — und gewöhnt sich daran, die Liste zu ignorieren. Danach übersieht er den einen, der zählt. Das ist der teurere der beiden Schäden, nur ohne Rechnung.

**Im Gespräch** hat der Anrufer seine Auskunft und wird trotzdem nach einem Termin gefragt. Das wirkt, als hätte der Assistent nicht zugehört — bei einem Produkt, dessen Versprechen genau das Gegenteil ist.

## Was fehlt

Eine **Austrittsbedingung** vor dem Rückruf-Block, sinngemäss:

> Ein Rückruf ist nur nötig, wenn das Anliegen im Gespräch **nicht abschliessend beantwortet** werden konnte. Ist die Frage beantwortet, bestätige das und beende das Gespräch — frage nicht nach einem Rückruftermin.

Und im `GESPRÄCHSZIEL`-Block muss der Rückruf-Zeitpunkt aus der Pflichtliste heraus: Er ist Pflicht, **wenn** ein Rückruf ansteht, nicht immer.

Beides ist Prompt-Arbeit an derselben Datei wie der zurückgestellte Dringlichkeits-Eingriff (`TICKET_DRINGLICHKEIT_PFLICHTFELD_2026-08-11.md`) — **dieselben zwei Blöcke liegen 10 Zeilen auseinander.** Wer beide getrennt anfasst, öffnet `prompt_master_l1` zweimal, und das ist ohne Versionierung (#929) einmal zu oft.

## Abgrenzung

**Kein Ersatz für die Kategorie-Logik.** `category = informationsanfrage` war korrekt, `callback_requested = false` war korrekt. Falsch war nur `next_action` — und das Gesprächsverhalten davor.

**Nicht dasselbe wie #987** (Terminbuchung löst die falsche E-Mail-Vorlage aus). Dort wählt eine nachgelagerte Ebene falsch. Hier erzeugt der Assistent im Gespräch einen Zustand, den es nicht geben sollte.

## Entschieden am 2026-08-15: eine Migration für beide L1-Blöcke

Der Rückruf-Block und der Dringlichkeits-Block liegen in `prompt_master_l1` **zehn Zeilen auseinander**. Sie werden zusammen geändert, nicht nacheinander.

Das weicht bewusst von „eine Änderung pro Testanruf" ab. Begründung: Ohne Versionierung (#929) ist jeder zusätzliche Schreibzugriff auf diesen Text ein Risiko — und die beiden Regeln lassen sich im Testanruf trotzdem trennen. Wie, steht im nächsten Abschnitt; es hängt nicht daran, dass sich später jemand erinnert.

## Wie ein Testanruf die beiden Regeln trennt

**Sie werden in verschiedenen Artefakten sichtbar, erzeugt von verschiedenen Modellen.** Eine Verwechslung ist damit ausgeschlossen, nicht bloss unwahrscheinlich:

| | Wo abzulesen | Erzeugt von | Zeitpunkt |
|---|---|---|---|
| **Dringlichkeitsregel** | `calls.urgency` im Datensatz | Auswertungsmodell (`analysis_llm`) | **nach** dem Gespräch, aus dem Transkript |
| **Rückruf-Austritt** | Gesprächsverlauf im Transkript, dazu `next_action` | Gesprächsmodell (`agent.prompt.llm`) | **im** Gespräch |

Die eine Regel wird *gehört*, die andere *gelesen*. Selbst ein einzelner Anruf zeigt beide unabhängig.

### Zwei Anrufe, damit beide Regeln in beide Richtungen geprüft sind

Ein einzelner Anruf prüft je Regel nur eine Richtung. Erst das Paar macht ein Ausbleiben deutbar:

**Anruf A — reine Auskunft, abschliessend beantwortet**
> „Wann haben Sie am Samstag offen?" — Antwort abwarten, nichts weiter sagen.

| Regel | Erwartung | Wenn nicht |
|---|---|---|
| Rückruf-Austritt | Assistent bestätigt und **beendet** — **keine** Terminfrage | Austrittsbedingung greift nicht |
| Dringlichkeit | `urgency = niedrig` | Rückfallregel trägt nicht |

**Anruf B — offenes Anliegen, Ort zunächst verschwiegen**
> „Mein Auto springt nicht mehr an." — **nicht** sagen wo. Auf die Rückfrage antworten: „auf der Autobahn."

| Regel | Erwartung | Wenn nicht |
|---|---|---|
| Nachfrage-Anweisung | Assistent **fragt nach dem Standort** | die Nachfrage ist nicht angekommen |
| Dringlichkeit | `urgency = hoch` | der Folgen-Massstab greift nicht — „Autobahn" ist das wörtliche `hoch`-Beispiel |
| Rückruf-Austritt | Terminfrage **kommt** | Austrittsbedingung ist zu weit und unterdrückt nötige Rückrufe |

**A prüft, dass der Rückruf-Austritt greift, B prüft, dass er nicht zu weit greift.** Dasselbe für die Dringlichkeit: A prüft die untere Stufe, B die obere. Ein Ergebnis, bei dem beide Anrufe dasselbe zeigen, wäre nach eurer eigenen Regel zuerst ein Verdacht auf den Test, nicht auf die Wirklichkeit.

### Vorher, noch ohne die Migration

**Anruf 0 — kein Anliegen** *(prüft allein die Feldbeschreibung, siehe `TICKET_DRINGLICHKEIT_PFLICHTFELD_2026-08-11.md`)*
> „Sind Sie ein Mensch?" — Antwort abwarten, auflegen.

Erwartung: `urgency = niedrig`. Bleibt es leer, trägt die Rückfallregel den Fall „kein Anliegen" nicht, und es braucht eine andere Formulierung oder doch ein `enum`.

Der Vergleichswert liegt vor: Derselbe Anruf am 14.08. um 21:38:40 (`05841c4e`) ergab **LEER** — bestätigt **unter der alten Feldbeschreibung**, die erst danach ersetzt wurde. Der Fall ist damit ungetestet, nicht widerlegt.

## Zu entscheiden

| # | Frage | Empfehlung |
|---|---|---|
| ~~1~~ | ~~Zusammen mit dem Dringlichkeits-Eingriff in einer Migration?~~ | **Ja, entschieden am 2026-08-15** |
| 2 | Soll der Assistent bei beantworteter Frage aktiv anbieten („Falls doch noch etwas offen ist, melden Sie sich gern")? | Ja, aber ohne Terminfrage |
| 3 | Gilt die Ausnahme branchenabhängig? | Nein — sie ist allgemeiner als jede Branche. Der Notdienst braucht sie genauso: „Wie lange dauert ein Abschleppvorgang?" ist auch dort eine reine Auskunft. |
