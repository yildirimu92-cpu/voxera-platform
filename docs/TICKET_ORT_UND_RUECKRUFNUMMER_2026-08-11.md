# Ticket — Einsatzort und gesprochene Rückrufnummer sind nicht erfassbar

**Datum:** 2026-08-11
**Art:** Bau (Datenmodell + Erfassung + Anzeige)
**Unabhängig von:** SMS. Die beiden Felder fehlen **auch im Dashboard und in der E-Mail** — SMS macht die Lücke nur besonders sichtbar.
**Herkunft:** `docs/SMS_BENACHRICHTIGUNG_DIAGNOSE_2026-08-11.md`, Abschnitte 6.1 und 7.2

---

## Das Problem

Bei einem Notfall sind zwei Angaben wichtiger als die Zusammenfassung:

1. **Wo ist der Anrufer?**
2. **Unter welcher Nummer ist er erreichbar?**

Beide sind heute nicht erfassbar.

### Ort

`calls` hat **kein Feld für den Einsatzort** — weder eine Spalte noch eine strukturierte Ablage. Was der Anrufer über seinen Standort sagt, landet allenfalls im Fliesstext von `call_summary`. Von dort ist es nicht zuverlässig herauszulösen, nicht sortierbar, nicht in eine Kartenanwendung übergebbar und nicht an den Anfang einer Nachricht zu stellen.

Für einen Abschleppdienst ist das kein Nebenpunkt: Ohne Ort ist die Anfrage nicht bearbeitbar.

### Rückrufnummer

`calls.caller_phone` trägt Twilios `From` — also die Nummer, **von der** angerufen wurde. Das ist nicht dasselbe wie die Nummer, **unter der** jemand erreichbar sein will.

Beim Abschleppdienst ruft nicht selten ein Passant, ein Mitfahrer oder die Polizei vom eigenen Telefon an. Wer zurückruft, erreicht dann nicht den Havarierten. Bei unterdrückter Rufnummer (gemessen: 1 von 31 Anrufen) gibt es überhaupt keine Nummer — dann steht im Dashboard nichts, obwohl der Anrufer sie im Gespräch womöglich genannt hat.

### Warum das jetzt auffällt

Die SMS-Vorlage für das Team soll **Rückrufnummer und Ort zuerst** nennen — auf dem Sperrbildschirm um drei Uhr nachts ist nur der Anfang sichtbar. Genau diese beiden Angaben sind die, die es nicht gibt.

Dieselbe Lücke besteht aber unabhängig davon:

- **Dashboard:** Die Anrufkarte zeigt Telefonnummer (= Twilio-Herkunft), Kategorie, Dauer und Zusammenfassung. Kein Ort, keine bestätigte Rückrufnummer.
- **E-Mail:** `buildPayload()` in `_lib/call-notification.js:261–286` führt `caller_phone`, `call_summary`, `next_action`, `category`, `lead_quality` — ebenfalls keinen Ort und keine bestätigte Rückrufnummer.

---

## Die gute Nachricht: der Erfassungsweg existiert

ElevenLabs' **Data Collection** ist bereits angebunden und wird produktiv ausgewertet. `elevenlabs-post-call.js:206–226` (`pickDC()`) liest strukturierte Felder aus `analysis.data_collection_results`, mit defensivem Abgleich über Schreibweisen und mehreren Rückfallquellen.

Der Mechanismus wird heute schon für `caller_name`, `call_summary`, `call_summary_short`, `callback_requested`, `category`, `urgency` u. a. benutzt. Ein neues Feld folgt einem etablierten, mehrfach wiederholten Muster — kein neues Bauteil.

---

## Vorgeschlagene Umsetzung

### 1. Datenmodell

```
alter table public.calls
  add column if not exists caller_location   text,   -- Einsatzort, wie genannt
  add column if not exists callback_number   text;   -- bestätigte Rückrufnummer, E.164
```

`callback_number` bewusst **getrennt** von `caller_phone`: Herkunft und Wunsch sind zwei verschiedene Aussagen, und beide sind wertvoll. Wer sie in einer Spalte zusammenführt, verliert die Information, ob zurückgerufen werden kann, wenn der Wunsch fehlt.

`caller_location` bewusst als Freitext, nicht als Koordinaten: Was am Telefon gesagt wird („A1 Richtung Bern, kurz nach der Ausfahrt Muri"), ist selten eine Adresse. Eine Geokodierung kann später darauf aufsetzen; sie vorher zu erzwingen, würde Angaben verwerfen, die für einen Menschen völlig ausreichen.

### 2. Erfassung im Gespräch

Zwei Data-Collection-Felder im ElevenLabs-Agenten, plus Prompt-Anweisung:

- **Ort** — nur für Branchen, in denen er zählt. Über `industry_templates` steuerbar, nicht global.
- **Rückrufnummer** — der Assistent lässt sie **immer** mündlich bestätigen, nicht nur bei unterdrückter Nummer. Begründung: die bedingte Variante bräuchte eine dynamische Variable im Prompt, und sie löst den häufigeren Fall nicht — der Passant, der vom eigenen Telefon anruft.

### 3. Auswertung

In `extractCallFields()` (`elevenlabs-post-call.js`, ab Zeile ~256) zwei Blöcke nach bestehendem Muster ergänzen:

```js
const callerLocation = pickFirstString([
  pickDC(dc, 'caller_location'), pickDC(dc, 'location'), pickDC(dc, 'einsatzort'),
  extractedData.caller_location, collectedData.caller_location, /* ... */
]);
if (callerLocation) updatePayload.caller_location = callerLocation;
```

Für `callback_number` zusätzlich durch `normalizePhoneE164()` (`_lib/phone-normalize.js`), damit gesprochene Formate („null sieben neun …") sauber landen — und **nicht** übernehmen, wenn die Normalisierung fehlschlägt.

### 4. Anzeige

- **Dashboard:** Anrufkarte und Detailansicht. Ort prominent, Rückrufnummer als Wähl-Link (`tel:`), wenn vorhanden — sonst Rückfall auf `caller_phone` mit erkennbarem Unterschied.
- **E-Mail:** `buildPayload()` um beide Felder erweitern; Vorlagen in Make-Szenario 09 entsprechend. **Achtung:** Erfordert Anfassen von `call-notification.js` — nach aktueller Zuständigkeitsregel nicht ohne Freigabe.
- **SMS:** ergibt sich, sobald der Kanal existiert.

---

## Aufwand

| Schritt | Aufwand |
|---|---|
| Migration (zwei Spalten) | ~0,5 Tag |
| Data Collection + Prompt (inkl. Branchensteuerung) | ~1 Tag |
| Auswertung in `extractCallFields()` | ~0,5 Tag |
| Anzeige Dashboard | ~0,5 Tag |
| Anzeige E-Mail (Payload + Make-Vorlagen) | ~0,5 Tag |
| **Summe** | **≈ 3 Tage** |

---

## Zu entscheiden

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Ort für alle Branchen erfassen oder über `industry_templates` steuern? | Steuern — ein Zahnarzt braucht keinen Einsatzort, und jede überflüssige Frage verlängert das Gespräch. |
| 2 | Rückrufnummer immer bestätigen lassen oder nur bei fehlender Übermittlung? | Immer — siehe Begründung oben. |
| 3 | `callback_number` getrennt von `caller_phone` oder überschreibend? | Getrennt. |
| 4 | Ort später geokodieren? | Nicht jetzt. Erst wenn eine Kartenanwendung existiert, die davon profitiert. |
| 5 | Zieht dieses Ticket vor den SMS-Bau? | Ja — es steht nicht unter dem Twilio-Blocker und verbessert Dashboard und E-Mail sofort. |

---

## Abgrenzung

Dieses Ticket baut **keinen SMS-Versand**. Es schliesst eine Datenlücke, die unabhängig vom Kanal besteht — und die dem SMS-Bau ohnehin vorausgehen muss, weil die Team-Vorlage sonst zwei ihrer drei wichtigsten Zeilen nicht füllen kann.
