# Ticket — Datenexport vor der Löschung: geprüft, Lücke bestätigt

**Datum:** 11.08.2026 · **Status:** geprüft, Befund steht · **Typ:** Rechtszusage ohne Deckung ·
**Frist:** **2. November 2026** (gekoppelt an `TICKET_TRANSKRIPT_AUFBEWAHRUNG_2026-08-11.md`) ·
**Auslöser:** offener Punkt aus dem Datenresidenz-Strang

---

## 1. Die Frage

§10 der Datenschutzerklärung sagt **Datenübertragbarkeit** zu (Art. 28 revDSG / Art. 20 DSGVO):

> „Sie haben das Recht, Ihre Daten in einem strukturierten, maschinenlesbaren Format zu erhalten."

Ab dem 2. November löscht `enforce-data-retention.js` Transkripte nach 90 Tagen. **Gibt es einen
Weg, sie vorher herauszubekommen?**

## 2. Die Antwort: es gibt einen Export — aber nicht für die Daten, die gelöscht werden

**Ein CSV-Export existiert** (`customer-dashboard/index.html:23585`, `exportArchiv()`, Schaltfläche
`#archiv-export-btn`). Er hat zwei Einschränkungen, und beide treffen genau den kritischen Fall.

### 2.1 Das Transkript ist nicht dabei

Die exportierten Spalten sind vollständig:

```js
var rows = [['Name','Telefon','Kategorie','Datum','Uhrzeit','Zusammenfassung','Nachfassen','Notiz']];
```

Es gibt **keine Transkript-Spalte.** Exportiert wird `call_summary` — die Zusammenfassung.

> **Das ist der Kern des Problems:** Nach 90 Tagen werden `transcript` und `transcript_json`
> geleert, die Zusammenfassung bleibt bis Tag 180 bestehen. **Der Export liefert also genau das,
> was noch da ist, und genau das nicht, was verschwindet.**
>
> Und das Transkript ist das, worauf es bei einer Streitfrage ankommt — „was genau hat der Anrufer
> gesagt?". Die Zusammenfassung ist eine Interpretation der KI, kein Beleg.

### 2.2 Nur archivierte Anrufe

```js
var done = _archivAllDone.length ? _archivAllDone :
  (allRecords||[]).filter(function(r){ return normalizeStatus((r.fields||{}).dashboard_status) === CALL_STATUS.ARCHIVED; });
```

Exportiert wird ausschliesslich, was der Kunde **selbst ins Archiv verschoben** hat. Anrufe in
`neu`, `in Bearbeitung` oder `erledigt` sind nicht enthalten. Ein Kunde, der nicht archiviert, kann
gar nichts exportieren — die Löschung nach Zeit fragt aber nicht nach dem Status.

### 2.3 Was es sonst nicht gibt

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

| # | Massnahme | Aufwand |
|---|---|---|
| 1 | **Transkript-Spalte in den CSV-Export aufnehmen** | klein — `f.transcript` in `rows.push()`, wie bei `call_summary` mit Zeilenumbruch-Ersetzung |
| 2 | **Exportbereich erweitern:** alle Anrufe statt nur archivierte, mit Zeitraumwahl | mittel — der Export liest heute aus dem bereits geladenen Archivbestand, nicht aus einer Abfrage |

Punkt 1 allein schliesst die eigentliche Lücke und ist in einer Stunde erledigt. **Er sollte
unabhängig von jeder anderen Entscheidung gemacht werden.**

### 4.2 Besser — im Zug der Transkript-Entscheidung

| # | Massnahme |
|---|---|
| 3 | **Hinweis vor Ablauf:** „12 Anrufe werden in 14 Tagen gelöscht — jetzt exportieren." Das macht die Frist zu einer Funktion statt zu einer Überraschung |
| 4 | **Vollexport je Kunde** (JSON, alle Felder), als Antwort auf Auskunfts- und Portabilitätsanfragen — deckt §10 sauber ab statt nur den Anrufverlauf |

### 4.3 Zusammenhang mit Weg C

Ist die Aufbewahrungsfrist nach Plan gestaffelt (Weg C im Transkript-Ticket), wird der Export
**wichtiger**, nicht unwichtiger: Ein Starter-Kunde mit 90 Tagen braucht einen verlässlichen Weg,
seine Daten zu sichern, bevor sie ablaufen — sonst ist die kurze Frist ein Produktmangel statt eines
Datenschutzmerkmals.

**Der Hinweis aus Punkt 3 ist dann kein Beiwerk, sondern das, was die Staffelung verkaufbar macht.**

## 5. Empfehlung

**Punkt 1 sofort** — eine Stunde, unabhängig von allem anderen, schliesst die §10-Lücke für den
kritischen Fall.

**Punkte 2 und 3 zusammen mit der Transkript-Entscheidung**, weil sie dieselbe Frist teilen und
dieselbe Frage beantworten: Was passiert mit einem Gespräch, wenn seine Zeit abläuft?

**Punkt 4, wenn der erste Auskunftsantrag kommt** — vorher ist es Vorratsarbeit. Er sollte aber
bekannt sein, damit die Antwort dann nicht improvisiert wird.

## 6. Erledigt, wenn

- [ ] Der CSV-Export enthält das Transkript
- [ ] Der Export ist nicht mehr auf archivierte Anrufe beschränkt
- [ ] Ein Kunde wird vor dem Ablauf gewarnt
- [ ] Für §10 existiert ein Weg, der nicht Handarbeit in der Datenbank ist
