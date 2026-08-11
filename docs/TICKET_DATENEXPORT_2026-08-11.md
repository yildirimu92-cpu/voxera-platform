# Ticket — Datenexport vor der Löschung: geprüft, Lücke bestätigt

**Datum:** 11.08.2026 · **Status:** geprüft, **Befund am 11.08. korrigiert — siehe 2** · **Typ:** Rechtszusage ohne Deckung ·
**Frist:** **2. November 2026** (gekoppelt an `TICKET_TRANSKRIPT_AUFBEWAHRUNG_2026-08-11.md`) ·
**Auslöser:** offener Punkt aus dem Datenresidenz-Strang

---

## 1. Die Frage

§10 der Datenschutzerklärung sagt **Datenübertragbarkeit** zu (Art. 28 revDSG / Art. 20 DSGVO):

> „Sie haben das Recht, Ihre Daten in einem strukturierten, maschinenlesbaren Format zu erhalten."

Ab dem 2. November löscht `enforce-data-retention.js` Transkripte nach 90 Tagen. **Gibt es einen
Weg, sie vorher herauszubekommen?**

## 2. Die Antwort: es gibt gar keinen erreichbaren Export

> **Korrektur zum ersten Befund vom 11.08.2026.** Zuerst war berichtet worden, es gebe einen
> CSV-Export, dem das Transkript fehle. Die genauere Prüfung zeigt: **Die Funktion existiert, ist
> aber von nirgendwo aus erreichbar.** Das ändert den Auftrag — es ist keine zusätzliche Spalte,
> sondern ein Export, der gebaut werden muss.

### 2.1 `exportArchiv()` wird nie aufgerufen

Die Funktion steht in `customer-dashboard/index.html:23585`. Im gesamten Repository kommt ihr Name
**genau einmal vor** — in ihrer eigenen Definition:

```
exportArchiv: 1 Treffer     (nur die Definition)
renderArchiv: 7 Treffer     (3 echte Aufrufstellen)
filterArchiv: 4 Treffer     (3 echte Aufrufstellen)
```

Kein `onclick`, kein `addEventListener`, und — anders als die Nachbarfunktion `vxArchivRestore`
zwei Zeilen darüber — **auch keine Zuweisung an `window`**. Sie ist von der Oberfläche aus nicht
aufrufbar.

### 2.2 Der Schaltknopf existiert nicht

`archiv-export-btn` kommt in **keiner Datei des Repositories als Element** vor. Es gibt:

- CSS dafür (`index.html:4509`, `:4520`, plus ein Kommentar „W7.4 — #archiv-export-btn (CSV Export
  Verlauf)"),
- eine Zeile, die ihn ein- und ausblenden würde (`:23515`),
- **aber kein `<button id="archiv-export-btn">`.**

`document.getElementById('archiv-export-btn')` liefert also immer `null`. Die Einblendlogik ist
durch `if (exportBtn)` abgesichert und tut still nichts.

**Ergebnis: Ein Kunde hat heute keinerlei Möglichkeit, seine Anrufdaten zu exportieren.**

### 2.3 Was der Export enthalten hätte, wenn er erreichbar wäre

Der Vollständigkeit halber — die beiden ursprünglich berichteten Einschränkungen stimmen und
gelten für den Code, so wie er dasteht:

- **Kein Transkript.** Die Spalten sind `['Name','Telefon','Kategorie','Datum','Uhrzeit',
  'Zusammenfassung','Nachfassen','Notiz']` — exportiert würde `call_summary`, nicht `transcript`.
- **Nur archivierte Anrufe**, gefiltert über `dashboard_status === CALL_STATUS.ARCHIVED`.

### 2.4 Die gute Nachricht: die Daten sind bereits im Browser

`loadCallRecords()` (`index.html:12931`) liest mit **`select('*')`** und `toDashboardRecord()`
reicht die Zeile unverändert als `fields` weiter (`:11632`). **`transcript` und `transcript_json`
liegen also bereits vollständig im Browser** — es gibt keine Datenlücke, nur eine fehlende
Oberfläche.

Ebenso ist die Beschränkung auf archivierte Anrufe **keine technische Grenze**: `allRecords` hält
alle Anrufe des Kunden. Der Export filtert freiwillig. **Die Erweiterung auf nicht-archivierte
Anrufe ist damit machbar und billig** — die von Ihnen gestellte Prüffrage ist mit „ja" beantwortet.

Eine echte Grenze gibt es: `loadCallRecords()` hat ein **`limit(500)`**. Ein Kunde mit mehr als 500
Anrufen bekäme über diesen Weg nie alles. Für §10 ist das mittelfristig zu wenig.

### 2.5 ⚠️ Offene Frage, die über dieses Ticket hinausgeht

Nicht nur der Schaltknopf fehlt — **auch `archiv-list`, `archiv-stat-count` und `archiv-stats-sub`
sind in keiner Datei als Element zu finden**, obwohl `renderArchiv()` sie befüllt und drei echte
Aufrufstellen hat. Entweder wird die Archiv-Ansicht zur Laufzeit aus einer Quelle erzeugt, die ich
nicht gefunden habe, oder ein Teil dieser Ansicht läuft ebenfalls ins Leere.

**Das ist hier nicht abschliessend geklärt und sollte vor dem Bau geprüft werden** — es entscheidet,
wohin der Schaltknopf gehört. Ich habe bewusst nichts implementiert, statt ihn an eine geratene
Stelle zu setzen.

### 2.6 Was es sonst nicht gibt

- **Keinen Export im Admin-Panel** — dort existiert keine CSV-Funktion.
- **Keinen Auskunfts- oder Portabilitätsendpunkt.** Keine Function bedient einen
  Datenauskunftsantrag; eine Anfrage nach Art. 25 revDSG müsste heute von Hand in der Datenbank
  beantwortet werden.
- **Keinen Hinweis an den Kunden**, dass Daten ablaufen. Es gibt keine Warnung vor der Löschung.

## 3. Was das bedeutet

Am 2. November treffen **zwei** Zusagen gleichzeitig auf die Realität:

| Zusage | Realität ab 02.11. |
|---|---|
| §7: Transkripte „während der Vertragsdauer" | werden nach 90 Tagen gelöscht |
| §10: Daten „in strukturiertem, maschinenlesbarem Format" erhalten | für Transkripte **nicht möglich**, für nicht-archivierte Anrufe gar nicht |

Die zweite ist die unangenehmere: Bei §7 kann man den Text korrigieren und die Sache ist sauber.
**§10 ist ein gesetzliches Recht — das lässt sich nicht wegformulieren.** Es lässt sich nur
erfüllen.

Die Löschung ist zudem **endgültig**: `enforce-data-retention.js` setzt `transcript` und
`transcript_json` auf `null`. Es gibt kein Papierkorb-Konzept und keine Sicherung, aus der ein
einzelnes Transkript zurückgeholt werden könnte.

## 4. Was zu tun ist

### 4.1 Mindestens — vor dem 2. November

| # | Massnahme | Aufwand | Status |
|---|---|---|---|
| 1 | **Schaltknopf bauen und verdrahten.** Ohne ihn ist alles Weitere wirkungslos. Setzt 2.5 voraus | klein, sobald der Ort feststeht | freigegeben |
| 2 | **Transkript-Spalte** in `exportArchiv()` aufnehmen — `f.transcript` mit Zeilenumbruch-Ersetzung, wie bei `call_summary` | ~1 Std. | ✅ freigegeben |
| 3 | **Exportbereich erweitern:** alle Anrufe statt nur archivierte | klein — die Daten liegen bereits im Browser (2.4) | ✅ freigegeben, Machbarkeit bestätigt |

Punkte 1–3 gehören in einen Arbeitsgang; einzeln ergibt keiner davon einen benutzbaren Export.

**Ohne Punkt 1 ist der Rest wirkungslos** — das ist die Änderung gegenüber der ersten Einschätzung.

### 4.2 Hinweis vor Ablauf — eigener Punkt

> Aufgenommen als eigenständige Massnahme, nicht als Beiwerk zum Export.

**Die Begründung steht unabhängig von §7 und §10:** Ein Kunde, der am 2. November Transkripte
verliert, ohne vorher gefragt worden zu sein, hat einen berechtigten Vorwurf — selbst wenn in der
Datenschutzerklärung alles korrekt steht und der Export tadellos funktioniert. Eine Frist, die
formal angekündigt ist, aber im Moment des Zugriffs nicht sichtbar wird, ist für den Betroffenen
keine Ankündigung.

**Was zu bauen ist:**

| # | Element | Anmerkung |
|---|---|---|
| 1 | Hinweis im Verlauf: „12 Anrufe werden in 14 Tagen gelöscht" | mit direktem Weg zum Export |
| 2 | Vorlaufzeit festlegen | Vorschlag **30 Tage**, damit ein Kunde, der monatlich ins Dashboard schaut, den Hinweis mindestens einmal sieht. 14 Tage sind für einen KMU-Rhythmus zu knapp |
| 3 | Der Hinweis muss aus den Daten kommen, nicht aus einer festen Zahl | Sonst läuft er nach der Umstellung auf Weg C (Staffelung je Plan) auf einen falschen Wert — genau der Fehler aus Content-Audit C1, wo ein hartkodiertes Ablaufdatum zwei Monate lang falsch angezeigt wurde |

**Punkt 3 ist der eigentliche Bauhinweis.** Die Frist gehört einmal an einer Stelle definiert und
von Löschlauf, Hinweis und Datenschutzerklärung gemeinsam gelesen — sonst driften die drei
auseinander, und genau das ist der Fehler, den dieser ganze Strang aufräumt.

**Aufwand:** halber Tag, wenn Punkt 3 ernst genommen wird.

### 4.3 Zusammenhang mit Weg C

Ist die Aufbewahrungsfrist nach Plan gestaffelt (Weg C im Transkript-Ticket), wird der Export
**wichtiger**, nicht unwichtiger: Ein Starter-Kunde mit 90 Tagen braucht einen verlässlichen Weg,
seine Daten zu sichern, bevor sie ablaufen — sonst ist die kurze Frist ein Produktmangel statt eines
Datenschutzmerkmals.

**Der Hinweis aus Punkt 3 ist dann kein Beiwerk, sondern das, was die Staffelung verkaufbar macht.**

## 5. Empfehlung und nächster Schritt

**Zuerst 2.5 klären** — wo die Archiv-Ansicht ihr Markup herbekommt. Das ist eine halbe Stunde und
entscheidet, wohin der Schaltknopf gehört. Ohne diese Antwort wäre jede Umsetzung geraten, deshalb
ist hier bewusst noch nichts gebaut.

**Danach 4.1 in einem Zug** — Schaltknopf, Transkript-Spalte, voller Umfang. Einzeln ergibt keiner
der drei Punkte einen benutzbaren Export.

**4.2 (Hinweis vor Ablauf) parallel**, mit dem Bauhinweis aus Punkt 3: die Frist einmal definieren,
von allen dreien lesen lassen.

**4.4 (Vollexport für Auskunftsanträge), wenn der erste Antrag kommt** — vorher Vorratsarbeit. Er
sollte aber bekannt sein, damit die Antwort dann nicht improvisiert wird.

## 6. Erledigt, wenn

- [ ] Es gibt überhaupt einen erreichbaren Export — Schaltknopf vorhanden und verdrahtet
- [ ] Der Export enthält das Transkript
- [ ] Der Export ist nicht mehr auf archivierte Anrufe beschränkt
- [ ] Ein Kunde wird vor dem Ablauf gewarnt, aus den Daten und nicht aus einer festen Zahl
- [ ] Für §10 existiert ein Weg, der nicht Handarbeit in der Datenbank ist
- [ ] Das `limit(500)` ist bewertet — für §10 mittelfristig zu wenig (2.4)
