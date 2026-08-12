# Befund — Twilio speichert SMS-Inhalte 400 Tage in den USA

**Datum:** 2026-08-11
**Art:** Befund zur Weitergabe (Datenresidenz-Strang) — **mit einer bereits getroffenen Entscheidung**, siehe Abschnitt „Entscheidung".
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

## Zusatzbeobachtung — geklärt

`enforce-data-retention.js:28` läuft nur, wenn `DATA_RETENTION_ENFORCEMENT_ENABLED === 'true'`:

```js
if (process.env.DATA_RETENTION_ENFORCEMENT_ENABLED !== 'true') {
  console.warn('[enforce-data-retention] disabled; set ... only after preflight');
}
```

**Das Flag steht in Produktion auf `true`** (in Netlify geprüft am 2026-08-10). Die 90-Tage-Frist greift also tatsächlich. Der Vergleich lautet **400 gegen 90**, nicht 400 gegen unbegrenzt.

---

## Entscheidung vom 2026-08-11: Die Team-SMS trägt kein Anliegen

Aus diesem Befund ist eine Konsequenz bereits gezogen und umgesetzt.

**Vorher** hätte die Team-SMS so ausgesehen:

```
Voxera 03:14 Abschlepp-Anfrage
Rueckruf: +41791234567
Ort: A1 Ri. Bern, Ausf. Muri
M. Keller
PW nicht fahrbereit, eine Person wartet im Fahrzeug
```

**Jetzt sieht sie so aus:**

```
Voxera 03:14 Neuer Anruf
Dringlichkeit: hoch
Rueckruf: +41791234567
Details: https://dashboard.voxera.ch/#call/8c101866-94bb-4081-8b75-f879e3d46744
```

Entfallen sind: **Name des Anrufers, Anliegen, Zusammenfassung, Kategorie, Ort.** Wer wissen will, worum es geht, öffnet das Dashboard — dort greift die eigene 90-Tage-Frist.

`buildTeamSms()` nimmt diese Felder nicht mehr entgegen. Wer sie wieder hineinschreiben will, muss die Signatur ändern und stösst dabei auf die Begründung. Ein Test (`sms-notification.test.cjs`) prüft zusätzlich am fertig versendeten Text, dass kein Inhaltsdatum durchrutscht.

**Der Preis ist real:** Um drei Uhr nachts einen Link zu öffnen ist mehr Aufwand als eine SMS zu lesen. Der Nutzenverlust ist bewusst in Kauf genommen, nicht übersehen.

Die **Anrufer-SMS** bleibt unverändert — sie enthielt nie ein Anliegen, sondern nur die Eingangsbestätigung, die Rückrufnummer des Betriebs und die Notfallnummer.

---

## Was nach der Entscheidung noch bei Twilio liegt

Wichtig für die Beurteilung: Die Änderung reduziert, sie beseitigt nicht.

| Datum | Wo | Anmerkung |
|---|---|---|
| Private Mobilnummern der Mitarbeiter | Empfänger der Team-SMS | **neu durch SMS** |
| Grobe Dringlichkeitsstufe | Text der Team-SMS | **neu durch SMS** |
| Anruf-UUID im Link | Text der Team-SMS | **neu durch SMS**, siehe unten |
| Rufnummer des Anrufers | Text der Team-SMS **und** Empfänger der Anrufer-SMS | siehe unten |
| Zeitpunkt des Anrufs | beide Nachrichten | siehe unten |
| Firmenname des Kunden | Text der Anrufer-SMS | öffentlich |

**Der entscheidende Punkt:** Rufnummer und Zeitpunkt des Anrufers liegen **ohnehin schon bei Twilio** — der Anruf selbst läuft über Twilio (`twilio-inbound-router.js`), und die Call Records tragen `From`, `To` und Zeitstempel unabhängig von jeder SMS.

Der marginale Zuwachs durch die SMS beschränkt sich damit im Wesentlichen auf **die Mobilnummern der Mitarbeiter** und **eine dreistufige Dringlichkeitsangabe**.

### Zur UUID im Link

Der Link zeigt seit dem 2026-08-11 auf **genau diesen Anruf** (`#call/<uuid>`), nicht mehr auf die Anfragenliste. Begründung: Seit die Nachricht kein Anliegen mehr trägt, ist der Link der einzige Weg dorthin — und um drei Uhr nachts ist der Unterschied zwischen einem Klick und einer Suche der ganze Unterschied. Er ist der Ausgleich für den Komfort, den der Verzicht kostet.

Datenschutzrechtlich ist das ein Zuwachs, aber ein kleiner:

- Die UUID ist **ohne Anmeldung am Dashboard nicht auflösbar** und trägt selbst kein Inhaltsdatum. Für sich genommen ist sie eine Zufallszahl.
- Sie steht im selben Text wie die **Rufnummer des Anrufers** — die Verknüpfung „dieser Vorgang gehört zu dieser Person" entsteht also nicht erst durch sie.
- Dieselbe Verknüpfung erzeugt der **Sprachanruf ohnehin** in den Call Records.

Was sie hinzufügt, ist ein dauerhafter, eindeutiger Verweis auf einen bestimmten Vorgang im fremden Bestand — also die Möglichkeit, zwei Twilio-Records sicher demselben Fall zuzuordnen. Das ist der ehrliche Preis; er wurde bewusst bezahlt.

Was durch die Entscheidung *nicht* mehr entsteht, ist der eigentliche Kern: eine Beschreibung der Lage einer identifizierbaren Person zu einem konkreten Zeitpunkt an einem konkreten Ort.

## Was zu klären ist

Ich formuliere das als Fragen, nicht als Empfehlungen — die Entscheidung liegt im Datenresidenz-Strang, nicht hier.

| # | Frage |
|---|---|
| 1 | Lässt sich die Aufbewahrungsdauer der Message Records im Twilio-Konto verkürzen, oder ist sie fix? |
| 2 | Bietet Twilio eine Unterdrückung des Nachrichtentextes (Body-Redaction) an, sodass nur Metadaten bleiben? Falls ja: verträgt sich das mit der Fehlersuche? |
| 3 | Gibt es eine EU-Datenregion für Messaging, und wäre sie mit der alphanumerischen Absenderkennung nutzbar? |
| 4 | Muss der Twilio-Bestand in den Löschprozess aufgenommen werden (API-seitiges Löschen einzelner Message Records)? |
| 5 | Ist die Verarbeitung in den USA im Auftragsverarbeitungsvertrag und in der Datenschutzerklärung abgedeckt — insbesondere die **Mitarbeiter-Mobilnummern**? Nach der Entscheidung oben ist das die verbleibende Hauptfrage. |
| ~~6~~ | ~~Steht `DATA_RETENTION_ENFORCEMENT_ENABLED` in Produktion auf `true`?~~ **Beantwortet: ja**, in Netlify geprüft am 2026-08-10. |

Die Fragen 1 bis 4 bleiben offen, verlieren durch die Entscheidung aber an Schärfe: Ohne Inhaltsdatum im Text ist eine Body-Redaction (Frage 2) weniger dringlich, und der Löschprozess (Frage 4) hätte weniger einzusammeln.

**Frage 5 gewinnt dagegen an Gewicht.** Die Mitarbeiter-Mobilnummern sind der einzige wirklich neue personenbezogene Bestand, den der Kanal bei Twilio erzeugt — und Mitarbeiter haben der Verarbeitung ihrer privaten Nummer nicht schon dadurch zugestimmt, dass ihr Arbeitgeber ein Produkt bucht.

## Status

Der SMS-Kanal ist gebaut, aber **nicht scharfgeschaltet**: Kein Kunde hat die Erweiterung gebucht (`customer_addons` ist leer), und ohne gebuchte Erweiterung sendet `call-sms.js` nichts. Es liegt also noch kein einziger Message Record vor.

Dieser Befund kann vor der Scharfschaltung entschieden werden, ohne dass etwas rückabzuwickeln wäre.
