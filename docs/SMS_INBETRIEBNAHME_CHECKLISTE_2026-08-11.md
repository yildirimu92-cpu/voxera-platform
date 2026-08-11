# SMS-Benachrichtigung — Inbetriebnahme

**Datum:** 2026-08-11
**Stand:** Der Kanal ist gebaut und getestet, aber **nicht scharfgeschaltet**.
**Bezug:** `docs/SMS_BENACHRICHTIGUNG_DIAGNOSE_2026-08-11.md`

---

## Warum heute nichts versendet wird

Drei Sperren, alle bewusst:

1. **Keine gebuchte Erweiterung.** `customer_addons` ist leer. `call-sms.js` prüft auf `sms_notify` bzw. `sms_endkunde` und überspringt ohne sie den gesamten Versand.
2. **Keine Empfänger.** `customer_notification_recipients` ist nach der Migration leer (in Produktion war `sms_notify_number` bei allen vier Kunden ungesetzt, es gab nichts zu übernehmen).
3. **Schalter aus.** `sms_notify_enabled` und `sms_caller_enabled` stehen bei allen Kunden auf `false`.

Der Deploy dieses Standes ändert für keinen Bestandskunden etwas. Das ist Absicht: Der Kanal geht bewusst nicht mit dem Merge live, sondern mit einer Entscheidung.

---

## Vor der Scharfschaltung

### Zwingend

| # | Punkt | Warum |
|---|---|---|
| 1 | **Twilio-Guthaben aufladen** | Stand bei der Freigabe auf **3.67 USD**. Bei sechs SMS je Anruf ist das im niedrigen zweistelligen Anrufbereich aufgebraucht. Ein leeres Guthaben ist im Code als *wiederholbarer* Fehler eingestuft (nicht endgültig) — die Nachricht geht also nicht verloren, sie kommt nur zu spät. Bei einem Notfall ist das dasselbe wie verloren. |
| 2 | **SMS Pumping Protection aktivieren** | Steht auf **deaktiviert**. Der Anrufer-Versand nimmt die Nummer entgegen, die der Anrufer selbst mitbringt — also eine automatisch verwendete, nicht kuratierte Zielnummer. Genau das ist das Muster, gegen das die Schutzfunktion gebaut ist. Ohne sie ist eine Serie manipulierter Anrufe ein direkter Kostenhebel. |
| ~~3~~ | ~~`DATA_RETENTION_ENFORCEMENT_ENABLED` prüfen~~ | **Erledigt:** steht auf `true` (Netlify, 2026-08-10). Die 90-Tage-Frist greift. |
| 4 | **Preisentscheid** | `TICKET_SMS_KOSTEN_PAKETMERKMAL_2026-08-11.md`. `sms_notify` zu CHF 9 trägt fünf Empfänger nicht (Break-even ≈ 18–26 Anrufe/Monat). |

### Empfohlen

| # | Punkt | Warum |
|---|---|---|
| 5 | **Datenresidenz: Rest klären** | Teilweise entschieden — die Team-SMS trägt kein Anliegen mehr, damit entsteht bei Twilio kein Inhaltsdatum. Offen bleibt vor allem, ob die **privaten Mobilnummern der Mitarbeiter** im Auftragsverarbeitungsvertrag und in der Datenschutzerklärung abgedeckt sind. Sie sind der einzige wirklich neue personenbezogene Bestand, den der Kanal bei Twilio erzeugt — Rufnummer und Zeitpunkt des Anrufers liegen dort ohnehin schon aus dem Sprachanruf. |
| 6 | **Ortsfeld bauen** | `TICKET_ORT_UND_RUECKRUFNUMMER_2026-08-11.md`. **Nicht mehr für die SMS** — der Ort gehört seit der Datenresidenz-Entscheidung ohnehin nicht in die Nachricht. Für **Dashboard und E-Mail** unverändert wichtig: Wer dem Link aus der SMS folgt, soll dort den Ort finden. Damit rückt das Ticket sogar näher an den Piloten, nicht weiter weg. |
| 7 | **Zustellbelege** | Heute wird `accepted` (Twilio hat angenommen) protokolliert, nicht `delivered`. Für einen belastbaren Nachweis je Nachricht braucht es Status-Callbacks. |

---

## Scharfschaltung für einen Kunden

Alles über Service-Role, es gibt noch keine Oberfläche dafür (bewusst — siehe Diagnose, Position 16).

```sql
-- 1. Erweiterung buchen (Team und/oder Anrufer)
insert into public.customer_addons (customer_id, addon_code, status, billing_cycle, price_chf)
values ('<customer_id>', 'sms_notify',   'active', 'monthly',  9.00),
       ('<customer_id>', 'sms_endkunde', 'active', 'monthly', 19.00);

-- 2. Empfänger eintragen (E.164, eine Zeile je Nummer)
insert into public.customer_notification_recipients (customer_id, phone_e164, name, sort_order)
values ('<customer_id>', '+41791111111', 'Ruedi', 0),
       ('<customer_id>', '+41792222222', 'Anna',  1);

-- 3. Schalter setzen
update public.customers
   set sms_notify_enabled = true,  sms_notify_trigger = 'all',
       sms_caller_enabled = true,  sms_caller_trigger = 'all'
 where id = '<customer_id>';
```

**Reihenfolge einhalten.** Wer Schritt 3 vor Schritt 2 ausführt, hat einen Kunden mit aktivem Team-Versand ohne Empfänger. Das scheitert nicht — es protokolliert `sms_team_ohne_empfaenger` und sendet nichts —, sieht aber im Log aus wie ein Fehler.

### Auslöser

| Wert | Wirkung |
|---|---|
| `all` | jeder Anruf |
| `callback_only` | nur bei Rückrufwunsch |
| `none` | aus |

Ein unbekannter Wert fällt auf `callback_only` zurück, nicht auf `all` — im Zweifel eine SMS zu wenig statt fünf zu viel. Der Fall wird als `sms_trigger_unbekannt` protokolliert.

---

## Umgebungsvariablen

| Variable | Pflicht | Vorgabe | Anmerkung |
|---|---|---|---|
| `TWILIO_ACCOUNT_SID` | ja | — | vorhanden, wird bereits für Sprache benutzt |
| `TWILIO_AUTH_TOKEN` | ja | — | vorhanden |
| `TWILIO_SMS_FROM` | nein | `Voxera` | alphanumerische Absenderkennung, höchstens 11 Zeichen. Eine rein numerische Angabe wird als Telefonnummer behandelt — so lässt sich später auf eine SMS-fähige Nummer wechseln, ohne Code zu ändern. |
| `SMS_MAX_TEAM_EMPFAENGER` | nein | `10` | Kostenbremse je Anruf. Wird sie erreicht, protokolliert `sms_empfaenger_gekappt` — es wird nicht still abgeschnitten. |

Die Variablen müssen auf **beiden** Netlify-Sites gesetzt sein: Der Erstversand läuft auf der Dashboard-Site, der Retry-Worker auf der Admin-Site.

---

## Der Absender ist einweg

Versendet wird unter der alphanumerischen Kennung **„Voxera"** — im Konto freigeschaltet, ohne Registrierung, sofort verfügbar.

Der Preis: **niemand kann antworten**, und das **STOP-Schlüsselwort wirkt nicht**.

Beide Vorlagen tragen dem Rechnung, und die Testsuite hält es fest:

- Keine Nachricht bittet um eine Antwort.
- Keine Nachricht bietet STOP an — das wäre ein Versprechen, das die Technik bricht.
- Die Anrufer-SMS **trägt eine Rückrufnummer im Text**, weil sie sonst eine Sackgasse wäre.

Wird später doch eine SMS-fähige Nummer beschafft, ist das mehr als ein Wechsel von `TWILIO_SMS_FROM`: Dann sind Antworten möglich, und beide Texte sollten daraufhin nochmals angesehen werden.

---

## Was im Betrieb zu beobachten ist

Alle Ereignisse sind JSON-Zeilen in den Function-Logs.

| Ereignis | Stufe | Bedeutung |
|---|---|---|
| `sms_call_notification_ergebnis` | info | Abschlusszeile je Anruf, mit allen Zählern |
| `sms_anrufer_unterdrueckt` | **error** | Team komplett nicht erreicht, Anrufer-SMS bewusst unterdrückt. **Das ist die wichtigste Zeile** — sie heisst: niemand weiss von diesem Notfall. |
| `sms_mehrere_segmente` | warn | Eine Nachricht überschreitet 160 Zeichen. Kostet bei fünf Empfängern fünffach. |
| `sms_empfaenger_gekappt` | warn | Mehr Empfänger als die Obergrenze |
| `sms_team_ohne_empfaenger` | warn | Versand aktiv, Liste leer |
| `sms_skipped_permanent` | info | Festnetz o. Ä. — Regelfall beim Anrufer, kein Alarm |
| `sms_send_failed` | error | Wiederholbarer Fehlschlag, Retry-Worker übernimmt |
| `retry_permanent_no_further_attempts` | warn | Retry-Worker hat endgültig aufgegeben (permanenter Fehler) |

Für die Alarmierung ist `sms_anrufer_unterdrueckt` der eine Kandidat: Er bedeutet, dass eine Notfallanfrage niemanden erreicht hat.

---

## Was `calls.sms_sent` nicht kann

Die Spalte bleibt **absichtlich ungeschrieben**.

Sie ist ein einzelnes Boolean für bis zu sechs Empfänger. „4 von 5 zugestellt" lässt sich darin nicht ausdrücken, und ein `true`, das auch bei zwei Fehlschlägen steht, ist schlechter als kein Wert — es sähe im Dashboard aus wie ein vollständiger Versand.

Die Wahrheit steht je Empfänger in `outbox_events` (`event_type` = `sms_team_notification` / `sms_caller_confirmation`, `dedupe_key` trägt Anruf und Nummer).

Wer die Spalte später füllen will, sollte sie vorher ersetzen — nicht befüllen.
