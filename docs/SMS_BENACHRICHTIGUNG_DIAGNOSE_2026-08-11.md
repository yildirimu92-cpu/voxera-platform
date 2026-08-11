# SMS-Benachrichtigung — Diagnose und Lückenliste

**Datum:** 2026-08-11
**Anlass:** Erster Pilotkunde ist ein Abschleppdienst. Anrufe kommen ausserhalb der Bürozeiten und tagsüber bei Besetzt, überwiegend Notfälle. Nach jedem Anruf soll unmittelbar eine Benachrichtigung raus — E-Mail *und* SMS. E-Mail allein reicht nicht; um drei Uhr nachts liest sie niemand.
**Auftrag:** Bestandsaufnahme. Keine Umsetzung.
**Quellen:** Repository `voxera-platform` (Stand `10262ef`), Produktions-Datenbank `ulcofbgrovgcvowdjrge` und Staging `hzqiyyqfchvfcmmbemvd` (beide ausschliesslich lesend abgefragt).

> Hinweis zur Quellenlage: Das Repository `voxera-dashboard` enthält die Versandlogik **nicht** — es ist ein Altstand vom 24.05. Der lebende Code liegt in `voxera-platform`. Wer diese Diagnose nachvollzieht, muss dort nachsehen.

---

## Kurzfassung

Der SMS-Versand **existiert nicht** — weder ganz noch teilweise. Was existiert, ist das Datenmodell und die gesamte Kette davor: Auslösepunkt, Kundenauflösung, Gating, Doppelversand-Sperre, Outbox-Protokoll und Retry-Worker. Diese Kette läuft produktiv für E-Mail.

Der fehlende Teil ist ein Geschwisterzweig zu den letzten zwei Schritten. Das ist überschaubare Arbeit — **5–8 Arbeitstage**.

Der eigentliche Blocker liegt nicht im Code: **die Schweizer Twilio-Nummern des Kontos können keine SMS versenden.** Das ist zuerst mit Twilio zu klären, und die Antwort verändert den Entwurf.

---

## Nachtrag vom 2026-08-11 — Blocker aufgelöst, Kanal gebaut

Die Absenderfrage aus Abschnitt 5.1 ist beantwortet. Alles darunter bleibt unverändert stehen: Es beschreibt den Stand **vor** dieser Auskunft und ist der Beleg, auf dem die Entscheidung beruht.

**Was sich geändert hat:**

- **Alphanumerische Absenderkennung ist im Twilio-Konto freigeschaltet.** Keine Registrierung nötig, die Schweiz unterstützt sie dynamisch, sofort verfügbar. Absender ist `Voxera` — 6 von höchstens 11 Zeichen.
- **Der Preis dafür ist Einwegbetrieb.** Empfänger können nicht antworten, das STOP-Schlüsselwort wirkt nicht. Beide Vorlagen tragen dem Rechnung; insbesondere trägt die Anrufer-SMS jetzt eine **Rückrufnummer im Text**, weil sie sonst eine Sackgasse wäre.
- **Festnetznummern können keine SMS empfangen** (Twilio 21614). Beim Anrufer ist das kein Randfall, sondern Alltag: Wer von zu Hause, aus dem Büro oder aus einer Werkstatt anruft, ruft vom Festnetz an. Der Versand überspringt ihn, statt zu scheitern.

**Damit ist der Bau freigegeben und ausgeführt** — Empfängermodell, Versand, Vorlagen. Das Ortsfeld bleibt separat (`TICKET_ORT_UND_RUECKRUFNUMMER_2026-08-11.md`), ebenso die Kundenoberfläche.

**Neue Befunde aus der Twilio-Konsole:**

| Befund | Folge |
|---|---|
| Guthaben **3.67 USD** | Vor dem Piloten aufladen. Ein leeres Guthaben ist im Code als *wiederholbarer* Fehler eingestuft — die Nachricht geht nicht verloren, kommt aber zu spät, und bei einem Notfall ist das dasselbe. |
| **SMS Pumping Protection deaktiviert** | Vor dem Livegang aktivieren. Der Anrufer-Versand nutzt eine automatisch übernommene Zielnummer — genau das Muster, gegen das die Funktion schützt. |
| **Message Records 400 Tage** Aufbewahrung (USA) | Gegen 90 Tage im eigenen Bestand. Eigener Befund zur Weitergabe: `BEFUND_TWILIO_DATENRESIDENZ_2026-08-11.md` |

**Der Kanal ist gebaut, aber nicht scharfgeschaltet.** Ohne gebuchte Erweiterung, ohne eingetragene Empfänger und mit ausgeschalteten Schaltern versendet er nichts — der Merge ändert für keinen Bestandskunden etwas. Die Schritte zur Scharfschaltung stehen in `SMS_INBETRIEBNAHME_CHECKLISTE_2026-08-11.md`.

---

## 1 — Was heute existiert

### 1.1 Felder (Produktion verifiziert)

| Tabelle | Spalte | Typ / Default | Zweck |
|---|---|---|---|
| `customers` | `sms_notify_enabled` | bool, `false` | Team-SMS an/aus |
| `customers` | `sms_notify_trigger` | text, `'all'` | Auslöser Team |
| `customers` | `sms_notify_number` | text | **eine** Nummer |
| `customers` | `sms_caller_enabled` | bool, `false` | Anrufer-SMS an/aus |
| `customers` | `sms_caller_trigger` | text, `'callback_only'` | Auslöser Anrufer |
| `customers` | `sms_caller_template` | text | Vorlage Anrufer |
| `calls` | `sms_sent` | bool, `false` | Versandvermerk |

Dazu `customers.phone_notification_to` (text) — Altbestand, in Produktion überall leer, ohne Leser.

### 1.2 Die beiden Addon-Codes bilden die zwei Empfängergruppen ab

Die Vermutung, dass hinter `sms_notify` und `sms_endkunde` genau die Unterscheidung Team/Anrufer steht, bestätigt sich wörtlich im Katalog (`voxera_addons`, Produktion):

| Code | Anzeigename | Preis | Beschreibung |
|---|---|---|---|
| `sms_notify` | SMS Benachrichtigung | CHF 9/Mt. | „SMS an dich nach jedem Anruf" → **Team** |
| `sms_endkunde` | Endkunden-SMS | CHF 19/Mt. | „Lara schickt dem Anrufer eine Bestätigung" → **Anrufer** |

Die Feldnamen folgen derselben Trennung: `sms_notify_*` für das Team, `sms_caller_*` für den Anrufer. Das Datenmodell bildet die Unterscheidung sauber ab — sie war so gedacht.

**Aber:** `sms_notify_number` ist Einzahl. Die Trennung der *Gruppen* ist modelliert, die *Mehrzahl* innerhalb der Team-Gruppe nicht. Siehe Abschnitt 3.

### 1.3 Ein Schreibpfad existiert

`customer-update-assistant.js:87–88` führt alle sechs SMS-Felder in der Allowlist, `:351–356` schreibt sie. Es gibt nur keine Oberfläche, die sie sendet, und keinen Leser.

### 1.4 Was nachweislich nicht läuft

- `calls`: 31 Zeilen, `sms_sent = true` bei **0**.
- `outbox_events`: 42 Zeilen in 8 Ereignistypen — **ausnahmslos E-Mail**. Nie ein SMS-Ereignis.
- `customer_addons`: **0 Zeilen** in beiden Umgebungen. Kein Kunde hat je ein Addon gebucht.
- Die Twilio-Messages-API (`/Messages.json`) wird im gesamten Repository **an keiner Stelle** aufgerufen.

Der Vorbefund steht bereits in `BENACHRICHTIGUNGSEINSTELLUNGEN_DIAGNOSE_UND_ZIELBILD_2026-08-09.md`, Punkt **B7**: *„SMS: Datenmodell vollständig, alles andere fehlt."* Diese Diagnose bestätigt ihn und ergänzt Messwerte, Twilio-Befund und Mehrempfänger-Frage.

### 1.5 Nebenbefund: ein Fehler, der beim Bauen zur Falle wird

`customer-dashboard/index.html` prüft die Addon-Codes `sms_notify_kunde` und `sms_confirm_caller`. Im Katalog heissen sie `sms_notify` und `sms_endkunde`. Die Prüfung kann nie zutreffen; beide Flags sind konstant `false`.

Harmlos wäre das, gäbe es nicht das grüne **„✓ SMS"**-Abzeichen in der Anfragenliste, gesteuert von genau diesem Flag. Wer die Codes korrigiert, ohne den Versand zu bauen, lässt das Dashboard behaupten, der Anrufer habe eine Bestätigung erhalten — für einen Versand, den es nicht gibt. Bei einem Abschleppdienst heisst das: jemand am Strassenrand gilt als benachrichtigt, ohne es zu sein.

Zweiter, unabhängiger Fehler: Das Abzeichen liest ein **Addon**, keinen **Zustellbeleg**. Auch mit gebautem Versand wäre es falsch — es erschiene an jedem Anruf, sobald das Addon gebucht ist, auch bei unterdrückter Rufnummer und auch bei fehlgeschlagenem Versand.

→ An beiden Codestellen steht seit dieser Diagnose ein Kommentar mit der Regel: **Codes und Anzeige erst zusammen mit dem Versand korrigieren.**

---

## 2 — Der Pfad vom Gesprächsende zum Versand

Er existiert bis zum vorletzten Schritt und ist dort produktiv im Einsatz — für E-Mail.

```
Anrufbeginn   → twilio-inbound-router.js:262-276
                legt calls-Zeile an (live_status='incoming')

Gesprächsende → ElevenLabs Post-Call-Webhook (HMAC-geprüft)
              → elevenlabs-post-call.js
                matcht Zeile, pollt auf die Analyse,
                schreibt Zusammenfassung/Transkript/Kategorie
              → sendCallNotification()      _lib/call-notification.js
                Kunde auflösen, decideMail() gatet auf notification_mode,
                Doppelversand-Sperre über dedupe_key
              → deliverMail()               _lib/mail-delivery.js
                schreibt outbox_events + POST an MAKE_MAIL_WEBHOOK
                (Make-Szenario 09, Central Mail Engine)

Retry         → outbox-retry-worker.js (admin-panel), alle 5 Min,
                exponentielles Backoff
```

**Fehlend ist ausschliesslich ein Geschwisterzweig zu den letzten beiden Schritten:** ein `sendCallSms()` neben `sendCallNotification()`, und ein `_lib/sms-delivery.js` neben `mail-delivery.js`, das statt an Make an Twilio geht.

Zwei bekannte Erweiterungspunkte auf dem Weg:

- `mail-delivery.js:31–48` — `MAIL_ENGINE_TYPES` ist eine harte Whitelist mit 16 E-Mail-Typen. Ein SMS-Typ wird dort **abgewiesen**, nicht durchgereicht.
- `outbox-retry-worker.js:168` — verzweigt über `event_type` und würde einen SMS-Typ mit `unsupported event_type` liegen lassen.

Beides sind kleine, absichtlich gebaute Erweiterungsstellen — keine Umbauten.

---

## 3 — Mehrere Empfänger

**Heute: nein.** `sms_notify_number` ist eine einzelne `text`-Spalte. `customer-update-assistant.js:353` kappt sie zusätzlich bei 40 Zeichen — genug für eine E.164-Nummer, nicht für fünf.

Das ist der eigentliche Aufwand, nicht der Versand.

### 3.1 Zwei Wege

| Weg | Bewertung |
|---|---|
| Kommaliste in der bestehenden Spalte | Billigste Änderung, aber kein Zustand je Empfänger. „Hat Ruedi seine SMS bekommen?" ist nicht beantwortbar. Für ein verkauftes Produkt zu wenig. |
| **Eigene Tabelle** `customer_notification_recipients` (`customer_id`, `phone_e164`, `name`, `kanal`, `aktiv`) | Das ehrliche Modell. Für ein 4–5-köpfiges Team ohnehin nötig, sobald jemand ein- oder aussteigt. **Empfehlung.** |

### 3.2 Der Fehlerfall ist der Kern

Twilio kennt keine echte Mehrfachadressierung — fünf Empfänger sind fünf API-Aufrufe. Daraus folgt zwingend:

**Jeder Empfänger ist ein eigener Versuch mit eigenem Zustand.** Ein Fehlschlag bei Nummer zwei darf die Schleife nicht abbrechen; er wird protokolliert, und die Schleife läuft weiter. Ein Versand, der bei der zweiten von fünf Nummern abbricht, wäre schlimmer als keiner.

Konkret: **eine `outbox_events`-Zeile je Empfänger**, `dedupe_key = 'sms_team:<call_id>:<nummer>'`. Das ist die kleinere Änderung und liefert Retry je Empfänger aus dem bestehenden Worker gratis.

**`calls.sms_sent` darf nicht die Wahrheitsquelle sein.** Ein einzelnes Boolean kann „4 von 5 zugestellt" nicht ausdrücken — es stünde „gesendet" im Dashboard, während einer der fünf nie etwas bekommen hat.

---

## 4 — Latenz: gemessen, nicht geschätzt

16 echte Anrufe aus der Produktion (09.–10.08.2026). Gemessen vom rechnerischen Auflegen (Anrufbeginn + `duration_seconds`) bis zum Schreiben der Outbox-Zeile:

| | Sekunden |
|---|---|
| Minimum | 21,3 |
| **Median** | **≈ 36** |
| Mittel | ≈ 40 |
| Maximum | 85,1 |

### Der Engpass ist die Zusammenfassung

`elevenlabs-post-call.js:27–29` wartet bewusst:

```js
const POLL_MAX_ATTEMPTS   = 5;
const POLL_INTERVAL_MS    = 3000;
const POLL_INITIAL_DELAY_MS = 2000;   // Worst-Case 17s reines Warten
```

Dazu kommt ElevenLabs' eigene Zustellverzögerung des Post-Call-Webhooks. Für SMS kämen Twilio-Annahme (1–2s) und Netzzustellung obendrauf.

**„Unmittelbar" heisst hier realistisch 25–90 Sekunden nach dem Auflegen**, dominiert vom Warten auf das Modell.

### Bewertung

Die Rufnummer des Anrufers und die angerufene Nummer stehen bereits beim *Anrufbeginn* fest. Eine „es ruft gerade jemand an"-SMS wäre in ein bis zwei Sekunden möglich — aber ohne Inhalt, und sie verdoppelt Kosten und Lärm für 35 gewonnene Sekunden.

**Empfehlung: bei einer SMS nach dem Gespräch bleiben.** Für jemanden am Strassenrand ist nicht die halbe Minute das Problem, sondern dass um drei Uhr nachts niemand die E-Mail liest.

---

## 5 — Twilio-Seite

### 5.1 Die Schweizer Nummer kann keine SMS versenden

Aus `telephony_numbers.capabilities`, das `admin-twilio-number-assignment.js:10,12` unverändert aus Twilios `IncomingPhoneNumbers`-API übernimmt — also Twilios eigene Auskunft:

| Nummer | Fähigkeiten |
|---|---|
| **+41 44 505 2800** (dem Pilotkunden zugewiesen) | `voice: true`, **`sms: false`** |
| +41 44 505 3662 | `voice: true`, **`sms: false`** |
| +41 44 505 3817 | `voice: true`, **`sms: false`** |
| +1 350 900 6176 | `voice: true`, `sms: true` |

Die einzige SMS-fähige Nummer im Konto ist die amerikanische. Schweizer Festnetznummern (+41 44) tragen in aller Regel keine SMS-Fähigkeit.

**Das ist vor allem anderen zu klären, und es ist keine Programmieraufgabe, sondern eine Beschaffungsfrage.** Sie entscheidet auch über den Inhalt: bei alphanumerischer Absenderkennung sind **keine Antworten möglich** — dann müssen beide Nachrichtentexte das sagen.

### 5.2 Zugangsdaten sind vorhanden

`TWILIO_ACCOUNT_SID` und `TWILIO_AUTH_TOKEN` sind gesetzt und werden serverseitig benutzt (`twilio-inbound-router.js:56–57`; `activation-start-system-test-call.js:92–93` ruft bereits die Twilio-REST-API für ausgehende Anrufe auf). Kein neues Konto, kein neues Geheimnis — nur ein neuer Endpunkt.

### 5.3 Kosten

Der Segmentpreis ist an Twilios aktueller Preisliste zu verifizieren; hier als Grössenordnung. Bei **6 SMS pro Anruf** (5 Team + 1 Anrufer) und CHF 0.07–0.10 je Segment:

- ≈ **CHF 0.42–0.60 pro Anruf**
- bei 10 Anrufen/Tag ≈ **CHF 125–180/Monat**
- Addon-Erlös: 9 + 19 = **CHF 28/Monat**

→ Eigenes Ticket: `TICKET_SMS_KOSTEN_PAKETMERKMAL_2026-08-11.md`

**Segment-Falle:** über 160 Zeichen = 2 Segmente = doppelter Preis. Umlaute sind in GSM-7 enthalten, aber **ein einziges typografisches Zeichen** („ " – …) oder Emoji kippt die Nachricht auf UCS-2 — dann ist bei **70 Zeichen** Schluss. Bei deutschem Text ein realer Kostentreiber, der in der Vorlage abzufangen ist.

---

## 6 — Inhalt

### 6.1 Team (4–5 Empfänger)

Rückrufnummer und Ort zuerst — auf dem Sperrbildschirm um drei Uhr nachts ist nur der Anfang sichtbar. Die Zusammenfassung zuletzt, weil sie der Teil ist, den man abschneiden darf.

```
Voxera 03:14 | Abschlepp-Anfrage
Rueckruf: +41791234567
Ort: A1 Ri. Bern, Ausf. Muri
PW nicht fahrbereit, 1 Person
```

≈ 105 Zeichen, ein Segment.

Für die letzte Zeile ist **`call_summary_short`** das richtige Feld (auf allen 16 geprüften Anrufen befüllt), nicht `call_summary` — das lag zwischen 74 und 329 Zeichen und sprengt jede SMS.

**Was die Vorlage nicht lösen kann:** Es gibt auf `calls` **kein Feld für den Ort**. „Ort zuerst" ist heute nicht lieferbar. → eigenes Ticket, siehe 8.2.

### 6.2 Anrufer (1 Empfänger)

Nichts versprechen, was nicht gedeckt ist — kein Zeitpunkt, keine Zusage:

```
Ihre Anfrage ist bei [Firma] eingegangen (03:14).
Das Team ist informiert und meldet sich bei Ihnen.
Bei Lebensgefahr: 144.
```

≈ 130 Zeichen.

Bewusst kein „in X Minuten": Der Assistent weiss es nicht, und eine gerissene Zusage ist schlimmer als keine. „Das Team ist informiert" ist zudem *nachweisbar wahr*, wenn die Reihenfolge aus 7.2 eingehalten wird. Die 144-Zeile lässt sich aus `customers.notfallnummer_lebensgefahr` speisen (existiert, Default `'144'`), statt sie fest zu verdrahten.

---

## 7 — Die zweite Empfängergruppe

### 7.1 Woher kommt die Nummer des Anrufers

Aus Twilios `From`, erfasst beim Anrufbeginn — `twilio-inbound-router.js:263`:

```js
caller_phone: fromNormalized || null,
```

Bei unterdrückter Nummer liefert Twilio `anonymous` o. ä.; `normalizePhoneE164()` entfernt Nicht-Ziffern, die Prüfung schlägt fehl, `caller_phone` wird **NULL**. Der Fall ist im Datenmodell also bereits sauber dargestellt. Die Abbruchbedingung heisst schlicht:

> `caller_phone IS NULL` → Anrufer-SMS überspringen, Grund protokollieren, **nicht scheitern**.

Gemessen: **30 von 31 Anrufen** tragen eine `caller_phone`, einer nicht (~3 %).

### 7.2 Soll der Assistent nachfragen

Ja — und weiter als „nur wenn sie fehlt". Zwei Gründe:

1. Für die bedingte Variante müsste der Assistent überhaupt wissen, dass die Nummer fehlt (dynamische Variable im Prompt — machbar, aber Zusatzaufwand).
2. Wichtiger: **die Nummer, unter der jemand erreichbar sein will, ist nicht immer die, von der er anruft.** Beim Abschleppdienst ruft nicht selten ein Passant oder die Polizei vom eigenen Telefon an.

Der Assistent sollte die Rückrufnummer für diesen Kunden also *immer* mündlich bestätigen lassen. Dafür fehlt heute das Feld — `caller_phone` ist die Twilio-Herkunft, nicht der geäusserte Wunsch. → eigenes Ticket, siehe 8.2.

### 7.3 Reihenfolge und Fehlerfall bei zwei Nachrichten

1. **Team zuerst.** Alle 4–5 Empfänger, unabhängig voneinander, Ergebnisse gesammelt.
2. **Anrufer nur, wenn mindestens eine Team-SMS von Twilio angenommen wurde.**
3. **Null Annahmen → keine Anrufer-SMS.** Stattdessen eskalieren (E-Mail an den Kunden, interner Alarm); der Retry-Worker versucht das Team weiter.

Begründung: Eine Bestätigung an jemanden am Strassenrand, die niemand erhalten hat, ist schlimmer als gar keine — sie beendet die Suche nach anderer Hilfe.

**Ehrlichkeitsanmerkung:** „von Twilio angenommen" ist nicht „auf dem Handy angekommen". Echte Zustellbelege brauchen Twilio-Status-Callbacks je Nachricht. Das Muster existiert bereits (`twilio-status-callback.js` für Sprache) und liesse sich auf Nachrichten erweitern. Für den Piloten ist „angenommen" als Bedingung vertretbar — man sollte nur wissen, dass sie schwächer ist, als sie klingt.

---

## 8 — WhatsApp: ausgeschlossen

Nicht geprüft, auf ausdrückliche Vorgabe. Damit die Frage nicht wiederkehrt, hier festgehalten:

- Die **offizielle WhatsApp Business API kann nicht in Gruppen schreiben** — sie ist für Eins-zu-eins-Konversationen gebaut. Der Kundennutzen wäre aber genau die Team-Gruppe.
- **Inoffizielle Wege verstossen gegen Metas Bedingungen** und riskieren die Sperrung der Nummer. Bei einem verkauften Produkt keine Option.

**Handlungsbedarf, der sich daraus ergab:** `wa_notify` (CHF 12/Mt.) und `wa_endkunde` (CHF 25/Mt.) standen in Produktion auf `coming_soon = false` — heute buchbar, für eine Funktion, die auf dem vorgesehenen Weg nicht entstehen kann.

→ Behoben in `supabase/migrations/20260811200000_whatsapp_addons_coming_soon.sql` (mit Ausgangsmessung und Nachweis).

**Offen zur Entscheidung:** `sms_notify` und `sms_endkunde` sind heute nach derselben Logik buchbar und unlieferbar. Anders als bei WhatsApp ist der Weg baubar — blockiert ist allein die Absenderfrage. Sobald feststeht, dass der Absender nicht kurzfristig zu beschaffen ist, gehören auch sie auf `coming_soon = true`.

---

## 9 — Lückenliste

| # | Punkt | Status | Aufwand |
|---|---|---|---|
| 1 | DB-Felder `sms_notify_*` / `sms_caller_*` | **existiert** | — |
| 2 | Addon-Katalog `sms_notify` / `sms_endkunde` | **existiert** | — |
| 3 | Schreibpfad für die SMS-Felder | **existiert** | — |
| 4 | Auslösepunkt nach Gesprächsende | **existiert** | — |
| 5 | Outbox + Retry-Worker | **existiert**, kanal-erweiterbar | — |
| 6 | Twilio-Zugangsdaten serverseitig | **existiert** | — |
| 7 | **SMS-fähiger Absender für CH** | **erledigt** — alphanumerisch `Voxera`, einweg | — |
| 8 | Empfängermodell für 4–5 Nummern | **gebaut** — `customer_notification_recipients` | — |
| 9 | `_lib/sms-delivery.js` + `sms-transport.js` | **gebaut** | — |
| 10 | `sendCallSms()` + Gating + Reihenfolge Team→Anrufer | **gebaut** | — |
| 11 | Vorlagen + Segment-/Encoding-Behandlung | **gebaut** — beide 1 Segment | — |
| 12 | Addon-Code-Fehler + „✓ SMS"-Abzeichen | **weiterhin offen**, kommentiert | ~0,5 Tag |
| 13 | Ortsfeld + Prompt-Anpassung | **fehlt** | ~1 Tag + Entscheid |
| 14 | Rückrufnummer als eigenes Feld | **fehlt** | ~0,5 Tag |
| 15 | Zustellbelege (Status-Callback je Nachricht) | **fehlt** | ~1 Tag, aufschiebbar |
| 16 | Kundenoberfläche für die Einstellungen | **fehlt** — Scharfschaltung per SQL | 1–2 Tage |
| 17 | Addon-Preis deckt 5 Empfänger nicht | **kaufmännische Lücke** | Entscheid |

---

## 10 — Einschätzung: machbar vor einem Piloten?

**Ja — mit einer Einschränkung, die nicht im Code liegt.**

Der Bau ist ordentliche, überschaubare Arbeit: **rund 5–8 Arbeitstage** für die Positionen 8–12 und 14, auf einem Fundament, das für E-Mail nachweislich funktioniert. Das ist kein Neubau, sondern ein zweiter Kanal an einer bestehenden, protokollierten, wiederholbaren Versandkette.

Das Risiko ist **Position 7**. Die Schweizer Nummer des Pilotkunden kann heute keine SMS versenden, und das lässt sich nicht wegprogrammieren. **Mit dem Code sollte nicht begonnen werden, bevor diese Frage beantwortet ist** — die Antwort verändert den Entwurf: bei alphanumerischer Absenderkennung sind keine Antworten möglich, was den Text beider Nachrichten und die Erwartung des Anrufers verändert.

Unabhängig davon vorzuziehen, weil sie den Piloten sonst beschädigen:

- **Position 12** — sonst behauptet das Dashboard einen Versand, den es nicht gibt. *(Kommentare gesetzt; Korrektur bleibt am Versand hängen.)*
- **Position 17** — bei fünf Empfängern trägt CHF 9 nicht. *(Eigenes Ticket.)*
- **Positionen 13 und 14** — Ort und Rückrufnummer treffen beim Abschleppdienst den Kern und fehlen auch im Dashboard und in der E-Mail, nicht nur in der SMS. *(Eigenes Ticket.)*

**Vorgeschlagene Reihenfolge:** Twilio-Absender klären → Preis entscheiden → Empfängermodell → Versand → Vorlagen → Ortsfeld. Assistent-Prompt und Kundenoberfläche können nach dem Piloten kommen.

---

## Anhang — Belege

**Produktionsdaten** (`ulcofbgrovgcvowdjrge`, lesend abgefragt am 2026-08-11):

- `calls`: 31 Zeilen. `sms_sent = true` bei 0. `caller_phone` befüllt bei 30 von 31.
- `outbox_events`: 42 Zeilen, 8 Typen — `call_notification_email` (10), `callback_request_email` (6), `offer_email` (8), `invoice_email` (7), `reminder_email` (5), `reminder_final_email` (3), `customer_welcome_access_email` (2), `setup_fee_email` (1). Alle `sent`. Kein SMS-Typ.
- `customer_addons`: 0 Zeilen. `voxera_addons`: 8 Zeilen.
- `telephony_numbers`: 4 Zeilen, Fähigkeiten wie in 5.1.
- Latenzmessung: 16 Paare aus `calls` × `outbox_events` über `dedupe_key`.

**Codestellen:** siehe Datei:Zeile-Angaben in den jeweiligen Befunden.

**Zugehörige Tickets:**

- `docs/TICKET_SMS_KOSTEN_PAKETMERKMAL_2026-08-11.md`
- `docs/TICKET_ORT_UND_RUECKRUFNUMMER_2026-08-11.md`
