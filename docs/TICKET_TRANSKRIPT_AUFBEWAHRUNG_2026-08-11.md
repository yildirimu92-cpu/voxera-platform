# Ticket — Transkript-Aufbewahrung: Zusage oder Technik anpassen?

**Datum:** 11.08.2026 · **Typ:** Produktentscheidung mit Rechtsfolge ·
**Status:** ✅ **entschieden am 11.08.2026 — Weg C, mit Weg A als Sofortmassnahme** ·
**Frist:** **2. November 2026** (siehe Abschnitt 2) ·
**Grundlage:** `DATENRESIDENZ_DIAGNOSE_2026-08-11.md`, F.2

---

## 0. Entscheidung

> **Weg A jetzt, Weg C als Ziel.** §7 wird auf 90/180 Tage korrigiert und geht mit dem neuen
> Startseiten-Text live. Die Staffelung nach Plan (Weg C) folgt als Produktvorhaben.
>
> **Begründung:** Verlängern geht später problemlos — verkürzen nicht. Weg A ist damit der sichere
> Zwischenschritt, der die Frist hält, ohne eine Tür zuzuschlagen.
>
> **Die konkreten Staffelwerte für Weg C** (90 Tage / 12 Monate / 24 Monate im Vorschlag unten)
> sind **noch nicht entschieden.** Sie werden zusammen mit der Preisstruktur festgelegt, nicht
> separat — die Aufbewahrungsfrist ist ein Planmerkmal und gehört in dieselbe Rechnung wie
> Inklusivminuten und Zusatzminutenpreis.

> ### ⚠️ Ausdrücklich festgehalten: Auch Weg A verlangt eine Entscheidung vor dem 2. November
>
> Weg A ist eine **Textänderung, die aktiv vorgenommen werden muss** — kein Zustand, in den man
> hineinläuft, indem man nichts tut. Wer die Frist verstreichen lässt, hat **nicht „Weg A
> gewählt"**, sondern am 2. November eine Zusage gebrochen: §7 sichert dann noch immer die
> Vertragsdauer zu, während das erste Transkript gelöscht wird.
>
> Der Unterschied ist nicht akademisch. Im ersten Fall steht ein korrigiertes Dokument, im zweiten
> ein Dokument, das nachweislich etwas anderes sagt als die Anlage tut — und zwar zu einem
> Zeitpunkt, zu dem der ganze Strang gerade wegen genau dieses Fehlers aufgeräumt wurde.

---

## 1. Der Widerspruch

| Was zugesagt ist | Was passiert |
|---|---|
| §7 Datenschutzerklärung: Transkripte und Anruf-Metadaten werden **„während der Vertragsdauer"** gespeichert, danach 30 Tage Übergangsfrist | `enforce-data-retention.js` leert Transkripte nach **90 Tagen**, löscht Anrufsätze nach **180 Tagen** — unabhängig vom Vertrag |

Die Löschung ist seit dem 10.08.2026 scharf (`DATA_RETENTION_ENFORCEMENT_ENABLED = true`). Bis
dahin war der Widerspruch folgenlos, weil nichts gelöscht wurde. **Das ist er ab jetzt nicht mehr.**

**Das ist kein Textfehler.** Ein Kunde im zweiten Vertragsjahr sucht den Anruf aus Monat 4 und
findet ihn nicht — obwohl ihm die gesamte Vertragsdauer zugesichert ist. Das ist gleichzeitig ein
gebrochenes Versprechen, ein Supportfall und ein Produktmangel.

---

## 2. Wann es zum ersten Mal eintritt

| Ereignis | Datum |
|---|---|
| Ältester Anruf in der Produktionsdatenbank | 04.08.2026 |
| + 90 Tage → **erste Transkript-Löschung** | **02.11.2026** |
| + 180 Tage → erste Anrufsatz-Löschung | 31.01.2027 |

Der Job läuft täglich um 03:17. **Es bleiben rund zwölf Wochen** — genug, um in Ruhe zu
entscheiden, und zu wenig, um es zu vergessen. Nach dem 2. November ist die Entscheidung
unwiderruflich für alle bis dahin gelöschten Transkripte.

> **Ein Hinweis zur Dringlichkeit:** Auch Weg A (nichts an der Technik ändern) verlangt eine
> Entscheidung **vor** dem 2. November — nämlich die Textänderung. Wer die Frist verstreichen
> lässt, hat nicht „Weg A gewählt", sondern eine gebrochene Zusage.

---

## 3. Weg A — Zusage an die Technik anpassen

§7 wird auf 90/180 Tage korrigiert. Kein Code, nur Text.

**Aufwand:** eine Stunde, Wortlaut liegt fertig in `docs/DSE_KORREKTUR_2026-08-11.md`, 2.2.

| ✅ Dafür | ❌ Dagegen |
|---|---|
| Sofort umsetzbar, hält die Frist mühelos | **Das Produkt verspricht damit weniger, als es könnte** |
| Datenminimierung — passt zum eigenen §6 und zur DSFA | 90 Tage sind kurz für ein Produkt, dessen Wert im Verlauf liegt |
| Weniger Daten = weniger Risiko bei einem Vorfall | Kein Jahresvergleich, keine Saisonauswertung, kein „was hat der Kunde letztes Jahr gefragt" |
| Kein Speicherwachstum, keine Kosten | „Erweiterte Auswertungen" (in `preise.ts` für Professional geplant) hätte nur 90 Tage Datenbasis |
| Verkaufsargument gegenüber datenschutzsensiblen Branchen | Ein Kunde, der zum Jahresende seine Anrufhistorie auswerten will, kann es nicht |

**Der stärkste Einwand:** Die Zusammenfassung überlebt zwar 180 Tage — aber das **Transkript** ist
das, was bei einer Streitfrage zählt („Was genau hat der Anrufer gesagt?"). Genau dann ist es nach
drei Monaten weg.

---

## 4. Weg B — Technik an die Zusage anpassen

Transkripte bleiben für die Vertragsdauer, Löschung 30 Tage nach Vertragsende.

**Aufwand: deutlich grösser, als es klingt.** Die heutige Löschung ist rein zeitbasiert. Für Weg B
braucht es eine **ereignisbasierte** Löschung, die es noch nicht gibt:

| Was zu bauen ist | Warum |
|---|---|
| Löschlauf, der an `contracts.terminated_at` / `operational_ended_at` hängt statt an `created_at` | Die Frist beginnt am Vertragsende, nicht beim Anruf |
| Behandlung von Kunden mit mehreren Verträgen | `lifecycle-runner.js` kennt bereits `hasOtherActiveContract()` — die Logik muss dieselbe sein, sonst löscht man einem aktiven Kunden die Daten |
| Behandlung des Falls „Vertrag endet nie" | Ohne Vertragsende gibt es keine Löschung — dann wachsen Transkripte unbegrenzt |
| Abstimmung mit ElevenLabs | Dort steht die Frist für Gesprächsdaten **und Audio gemeinsam auf 90 Tagen** (G.1, bestätigt 11.08.). Eine längere Voxera-Frist als die Anbieter-Frist ist möglich — dann liegen Transkripte in Zürich länger als beim Dienstleister, was unproblematisch ist. Umgekehrt entstünde ein Widerspruch |

| ✅ Dafür | ❌ Dagegen |
|---|---|
| Hält die bestehende Zusage — kein Kunde verliert etwas | Baut Aufwand auf, bevor ein Kunde danach gefragt hat |
| Voller Verlauf als Produktwert, Grundlage für Auswertungen | **Widerspricht dem eigenen §6-Grundsatz Datenminimierung** |
| Kein Supportfall „wo sind meine Anrufe?" | Transkripte enthalten Gesundheits-, Rechts- und Finanzangaben Dritter — unbegrenzte Haltung erhöht den Schaden bei einem Vorfall spürbar |
| | Die DSFA (§12) müsste neu bewertet werden |
| | Anrufer haben nie eingewilligt, dass ihr Gespräch **Jahre** liegt — sie sind nicht Vertragspartei |

**Der stärkste Einwand:** Der Anrufer bei der Arztpraxis ist nicht Kunde von Voxera. Er hat einer
Verarbeitung „zu Servicezwecken" zugestimmt (Disclosure, §11). Eine Aufbewahrung über die gesamte,
womöglich mehrjährige Vertragsdauer des Praxisbetreibers ist etwas anderes als drei Monate — und
Voxera ist dabei Auftragsverarbeiter, nicht Herr der Entscheidung.

---

## 5. Weg C — Frist als Produktmerkmal ⭐ Empfehlung

Weder A noch B, sondern: **Die Frist wird konfigurierbar und Teil des Plans.**

| Plan | Transkript-Aufbewahrung *(Werte offen — mit der Preisstruktur zu entscheiden)* |
|---|---|
| Starter | z. B. 90 Tage |
| Business | z. B. 12 Monate |
| Professional | z. B. 24 Monate, im Dashboard einstellbar |

> **Die Zahlen oben sind Platzhalter zur Veranschaulichung der Staffelung, keine Festlegung.**
> Entschieden wird gemeinsam mit der Preisstruktur — die Aufbewahrungsfrist gehört in dieselbe
> Rechnung wie Inklusivminuten und Zusatzminutenpreis, nicht in eine eigene.

Dazu in §7: „Transkripte: entsprechend der im gebuchten Plan vereinbarten Aufbewahrungsfrist
(90 Tage bis 24 Monate), längstens bis 30 Tage nach Vertragsende."

> ### ⚠️ Was „Verlauf" bei einer Staffelung heissen darf — und was nicht
>
> **Die Audiofrist ist nicht mitstaffelbar.** ElevenLabs kennt genau einen Aufbewahrungswert für
> Gesprächsdaten und Audio gemeinsam (G.1, 90 Tage), und die Aufnahme liegt ausschliesslich dort —
> Voxera hat keine eigene Kopie (Diagnose B.3). Was Voxera verlängern kann, ist deshalb **nur, was
> in Zürich liegt: Transkript, Zusammenfassung und Metadaten.**
>
> | Was ein Kunde bekommt | 90 Tage | danach |
> |---|---|---|
> | Aufnahme anhören | ✅ | ❌ **weg, endgültig** |
> | Transkript lesen | ✅ | ✅ solange die gebuchte Frist läuft |
> | Zusammenfassung, Metadaten | ✅ | ✅ dito |
>
> **Und es ist nicht nachträglich reparierbar.** Wer nach vier Monaten merkt, dass er die Aufnahme
> gebraucht hätte, kann sie nicht zurückholen — auch nicht durch ein Upgrade. Eine höhere
> Aufbewahrungsstufe wirkt immer nur nach vorne.
>
> **Folge für den Verkaufstext:** „12 Monate Verlauf" muss ausgeschrieben werden als **12 Monate
> Transkript und Zusammenfassung, 90 Tage Aufnahme.** Ein Kunde, der „Verlauf" hört, denkt an das
> Gespräch — und meint damit im Zweifel das Anhörbare.
>
> Das ist derselbe Fehlertyp, den dieser ganze Strang aufräumt: etwas verkaufen, das anders
> geliefert wird, als es verstanden wurde. Er gehört an **drei** Stellen gleich formuliert —
> Preistabelle, §7 und die Beschreibung im Dashboard —, nicht nur ins Kleingedruckte.
>
> **Ein Nebeneffekt, der für die Staffelung spricht:** Die 90-Tage-Aufnahme ist bei *jedem* Plan
> gleich. Die Staffelung verkauft also nicht „mehr Gespräch", sondern **mehr Nachvollziehbarkeit** —
> und das ist gegenüber datenschutzsensiblen Branchen sogar das bessere Argument, weil die
> Aufnahme, das heikelste Datum, in allen Plänen gleich kurz liegt.

**Warum das die bessere Antwort ist:**

- Es beantwortet die Frage „wie lange ist ein Gespräch etwas wert?" **nicht pauschal**, sondern
  überlässt sie dem, der es weiss — dem Kunden.
- Es macht aus einem Rechtsproblem ein **Verkaufsargument**. „Erweiterte Auswertungen" steht in
  `preise.ts` bereits als geplantes Professional-Merkmal; eine längere Datenbasis ist genau das,
  was sie braucht.
- Datenschutzsensible Kunden (Arztpraxis, Anwaltskanzlei) können auf **90 Tage** bleiben oder
  kürzer gehen — für sie ist die kurze Frist ein Vorteil, kein Mangel.
- Der Grundsatz der Datenminimierung bleibt gewahrt, weil die Frist **begründet gewählt** und nicht
  unbegrenzt ist.

**Aufwand:** grösser als A, kleiner als B — die ereignisbasierte Löschung aus Weg B entfällt, weil
weiterhin zeitbasiert gelöscht wird, nur mit einem Wert je Kunde statt einer Konstanten. Konkret:
eine Spalte `transcript_retention_days` auf `customers` (Default 90), gefüllt aus dem Plan, und
`enforce-data-retention.js` liest sie statt der Konstanten `TRANSCRIPT_RETENTION_DAYS`.

**Zwischenlösung, falls die Zeit bis zum 2. November knapp wird:** Weg A umsetzen (Text auf 90/180)
und Weg C als Produktvorhaben einplanen. Die Frist lässt sich später **verlängern**, ohne dass
jemandem etwas fehlt — verkürzen dagegen nicht. **A ist deshalb der sichere Zwischenschritt, C das
Ziel.**

---

## 6. Was ebenfalls zu klären ist

- ~~**Prüfpunkt G.1**~~ ✅ **erledigt 11.08.2026: 90 Tage**, nicht der Default von zwei Jahren.
  Anbieterfrist und eigene Löschung stehen auf demselben Wert — kein Widerspruch. **Relevant für
  Weg B und C:** Wird die Voxera-Frist verlängert, liegen Transkripte in Zürich künftig **länger**
  als beim Dienstleister. Das ist unproblematisch, aber es heisst, dass ein Gespräch nach 90 Tagen
  nur noch als Transkript existiert — das Audio ist dann beim Anbieter weg und lässt sich nicht
  nachträglich verlängern.
- ~~**Audio-Frist**~~ ✅ **geklärt: keine eigene Frist vorhanden.** Audio und Transkript hängen bei
  ElevenLabs an demselben Wert; eine getrennte Steuerung gibt es nicht. §7 zieht die Audiozeile
  deshalb auf 90 — siehe `DSE_KORREKTUR_2026-08-11.md`, 2.1.
- **Datenexport — inzwischen geprüft, Befund bestätigt.** Es gibt einen CSV-Export, aber er enthält
  **das Transkript nicht** und deckt **nur archivierte Anrufe** ab. Er liefert also genau das, was
  nach 90 Tagen noch da ist, und genau das nicht, was verschwindet. Vollständig in
  `docs/TICKET_DATENEXPORT_2026-08-11.md`.
  **Folge:** Am 2. November brechen ohne Gegenmaßnahme **zwei** Zusagen gleichzeitig — §7 und §10.
  §7 lässt sich durch Weg A heilen, §10 nicht: Datenübertragbarkeit ist ein gesetzliches Recht und
  lässt sich nicht wegformulieren, nur erfüllen. Die Transkript-Spalte im Export ist deshalb
  **keine Nebensache, sondern Teil derselben Frist** — Aufwand rund eine Stunde.

---

## 7. Entscheidungsvorlage

| | Weg A | Weg B | Weg C |
|---|---|---|---|
| Aufwand | 1 Std. | mehrere Tage | 1–2 Tage |
| Hält Frist 02.11. | ✅ | ⚠️ knapp | ⚠️ knapp |
| Produktwert Verlauf | ❌ | ✅ | ✅ |
| Datenminimierung | ✅ | ❌ | ✅ |
| Verkaufsargument | teilweise | ❌ | ✅ |
| Umkehrbar | ✅ verlängerbar | schwer | ✅ |

**Zu entscheiden:** A, B oder C — und ob die Audio-Frist auf 90 gehoben oder ElevenLabs auf 30
gestellt wird.
