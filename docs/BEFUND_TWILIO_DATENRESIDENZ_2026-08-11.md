# Befund — Twilio speichert SMS-Inhalte 400 Tage in den USA

**Datum:** 2026-08-11
**Art:** Befund zur Weitergabe (Datenresidenz-Strang). Keine Entscheidung, keine Umsetzung.
**Herkunft:** Twilio-Konsole, geprüft im Zuge der Absenderfreigabe für die SMS-Benachrichtigung.
**Betrifft:** `docs/SMS_BENACHRICHTIGUNG_DIAGNOSE_2026-08-11.md` — der Kanal ist gebaut, aber noch nicht scharfgeschaltet.

---

## Der Befund

Twilio bewahrt **Message Records 400 Tage** auf. Diese Records enthalten nicht nur Metadaten, sondern den **vollständigen Nachrichtentext** und die **Empfängernummer**.

Dem steht die eigene Frist gegenüber. `customer-dashboard/netlify/functions/enforce-data-retention.js:12`:

```js
const TRANSCRIPT_RETENTION_DAYS = 90;
const CALL_RECORD_RETENTION_DAYS = 180;
```

Also **400 Tage bei einem US-Anbieter gegen 90 Tage** für dasselbe Gesprächsmaterial im eigenen Bestand.

## Warum das mehr ist als eine Zahlendifferenz

Der Nachrichtentext ist kein Metadatum. Was in einer Team-SMS steht, ist eine verdichtete Fassung genau der Angaben, die die 90-Tage-Frist schützen soll:

```
Voxera 03:14 Abschlepp-Anfrage
Rueckruf: +41791234567
Ort: A1 Ri. Bern, Ausf. Muri
M. Keller
PW nicht fahrbereit, eine Person wartet im Fahrzeug
```

Darin stecken: Name des Anrufers, seine Rufnummer, sein Aufenthaltsort zu einem konkreten Zeitpunkt, und seine Notlage. Bei der Anrufer-SMS kommt die Mobilnummer des Anrufers als Empfänger hinzu.

Die Empfängernummern der Team-SMS sind private Mobilnummern von Mitarbeitern.

Damit entsteht ein zweiter Bestand desselben Materials, der:

1. **länger lebt** als der eigene (400 statt 90 Tage),
2. **in einer anderen Jurisdiktion** liegt (USA),
3. von `enforce-data-retention.js` **nicht erreicht wird** — die Funktion räumt Supabase auf, nicht Twilio.

Ein Löschbegehren nach DSG/DSGVO, das im eigenen Bestand sauber erfüllt wird, bliebe im Twilio-Bestand unerfüllt.

## Zusatzbeobachtung

`enforce-data-retention.js:28` läuft nur, wenn `DATA_RETENTION_ENFORCEMENT_ENABLED === 'true'`:

```js
if (process.env.DATA_RETENTION_ENFORCEMENT_ENABLED !== 'true') {
  console.warn('[enforce-data-retention] disabled; set ... only after preflight');
}
```

Ob das Flag in Produktion gesetzt ist, habe ich **nicht geprüft** — es gehört in denselben Strang. Steht es auf `false`, greift die 90-Tage-Frist heute nirgends, und der Vergleich lautet nicht 400 gegen 90, sondern 400 gegen unbegrenzt.

## Was zu klären ist

Ich formuliere das als Fragen, nicht als Empfehlungen — die Entscheidung liegt im Datenresidenz-Strang, nicht hier.

| # | Frage |
|---|---|
| 1 | Lässt sich die Aufbewahrungsdauer der Message Records im Twilio-Konto verkürzen, oder ist sie fix? |
| 2 | Bietet Twilio eine Unterdrückung des Nachrichtentextes (Body-Redaction) an, sodass nur Metadaten bleiben? Falls ja: verträgt sich das mit der Fehlersuche? |
| 3 | Gibt es eine EU-Datenregion für Messaging, und wäre sie mit der alphanumerischen Absenderkennung nutzbar? |
| 4 | Muss der Twilio-Bestand in den Löschprozess aufgenommen werden (API-seitiges Löschen einzelner Message Records)? |
| 5 | Ist die Verarbeitung in den USA im Auftragsverarbeitungsvertrag und in der Datenschutzerklärung abgedeckt — inklusive der Mitarbeiter-Mobilnummern? |
| 6 | Steht `DATA_RETENTION_ENFORCEMENT_ENABLED` in Produktion auf `true`? |

## Gestaltungsspielraum, der bereits genutzt wird

Zwei Dinge begrenzen die Menge des Materials schon jetzt — nicht als Lösung, aber als Randbedingung für die Entscheidung:

- Die Team-SMS trägt **`call_summary_short`**, nicht das Transkript und nicht die lange Zusammenfassung. Sie ist auf 160 Zeichen begrenzt.
- Die Anrufer-SMS enthält **keine Angaben zum Anliegen**. Sie bestätigt nur den Eingang und nennt Rückruf- und Notfallnummer.

Wer die Menge weiter senken will, hätte den grössten Hebel bei der Zusammenfassung in der Team-SMS — allerdings auf Kosten genau der Information, für die der Kanal gebaut wurde.

## Status

Der SMS-Kanal ist gebaut, aber **nicht scharfgeschaltet**: Kein Kunde hat die Erweiterung gebucht (`customer_addons` ist leer), und ohne gebuchte Erweiterung sendet `call-sms.js` nichts. Es liegt also noch kein einziger Message Record vor.

Dieser Befund kann vor der Scharfschaltung entschieden werden, ohne dass etwas rückabzuwickeln wäre.
